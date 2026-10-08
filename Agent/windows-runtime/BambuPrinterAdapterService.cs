using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using FluentFTP;
using MQTTnet;
using MQTTnet.Formatter;
using MQTTnet.Protocol;

namespace FilaAgent.Runtime;

public sealed record BambuPrinterDescriptor(
    string Ip,
    string Serial,
    int Port = 8883,
    int FtpsPort = 990,
    string? Name = null,
    string? BambuRemoteDirectory = null,
    bool Mock = false);

public sealed record BambuMqttConnectionOptions(
    string Ip,
    int Port,
    string Serial,
    string AccessCode,
    string ClientId,
    TimeSpan ConnectTimeout,
    TimeSpan KeepAlive);

public sealed record BambuMqttMessage(string Topic, ReadOnlyMemory<byte> Payload);

public interface IBambuMqttClient : IAsyncDisposable
{
    bool IsConnected { get; }
    event Action<BambuMqttMessage>? MessageReceived;
    event Action? Disconnected;
    Task ConnectAsync(BambuMqttConnectionOptions options, CancellationToken cancellationToken = default);
    Task SubscribeAsync(string topic, int qos, CancellationToken cancellationToken = default);
    Task PublishAsync(string topic, string payload, int qos, CancellationToken cancellationToken = default);
}

public interface IBambuMqttClientFactory
{
    IBambuMqttClient Create();
}

public interface IBambuFtpsUploader
{
    Task UploadAsync(string ip, int port, string accessCode, string localPath, string remotePath, CancellationToken cancellationToken = default);
}

public sealed record BambuPrintFile(string LocalPath, string? Name = null, string? Format = null);

public sealed record BambuPrintJob(
    BambuPrintFile? PrintFile = null,
    string? LocalPath = null,
    string? Title = null,
    string? ProductName = null,
    JsonElement? PrintProfile = null);

public sealed record BambuPrinterStatus(
    bool Connected,
    string Protocol,
    string Manufacturer,
    string Name,
    string Serial,
    string Ip,
    string State,
    double? Progress,
    double? RemainingMinutes,
    double? ActualPrintSeconds,
    double? ActualFilamentGrams,
    double? ActualFilamentMillimeters,
    double? CurrentLayer,
    double? TotalLayers,
    double? NozzleTemperature,
    double? NozzleTargetTemperature,
    double? BedTemperature,
    double? BedTargetTemperature,
    string? File,
    JsonElement Raw);

public sealed record BambuPrintResult(bool Success, bool Started, bool Uploaded, string RemotePath, string Command, bool Mock = false);

public sealed class BambuPrinterConnection
{
    internal BambuPrinterConnection(BambuPrinterDescriptor printer, IBambuMqttClient? client, string accessCode, bool mock)
    {
        Printer = printer;
        Client = client;
        AccessCode = accessCode;
        Mock = mock;
        Connected = true;
    }

    public BambuPrinterDescriptor Printer { get; }
    public bool Connected { get; internal set; }
    public bool Mock { get; }
    public DateTimeOffset ConnectedAtUtc { get; } = DateTimeOffset.UtcNow;
    public BambuPrinterStatus? LastStatus { get; internal set; }
    internal IBambuMqttClient? Client { get; }
    internal string AccessCode { get; }
    internal string MockState { get; set; } = "IDLE";
    internal Action<BambuMqttMessage>? MessageHandler { get; set; }
    internal Action<BambuPrinterStatus>? StatusUpdated;
    internal string ReportTopic => $"device/{Printer.Serial}/report";
    internal string RequestTopic => $"device/{Printer.Serial}/request";

    internal void NotifyStatus(BambuPrinterStatus status)
    {
        LastStatus = status;
        var handlers = StatusUpdated;
        if (handlers is null) return;
        foreach (Action<BambuPrinterStatus> handler in handlers.GetInvocationList())
        {
            try { handler(status); }
            catch { }
        }
    }
}

public sealed class MqttNetBambuClientFactory : IBambuMqttClientFactory
{
    public IBambuMqttClient Create() => new MqttNetBambuClient();
}

internal sealed class MqttNetBambuClient : IBambuMqttClient
{
    private readonly IMqttClient _client = new MqttClientFactory().CreateMqttClient();

    public MqttNetBambuClient()
    {
        _client.ApplicationMessageReceivedAsync += args =>
        {
            var message = args.ApplicationMessage;
            MessageReceived?.Invoke(new BambuMqttMessage(message.Topic, message.Payload.ToArray()));
            return Task.CompletedTask;
        };
        _client.DisconnectedAsync += _ =>
        {
            Disconnected?.Invoke();
            return Task.CompletedTask;
        };
    }

    public bool IsConnected => _client.IsConnected;
    public event Action<BambuMqttMessage>? MessageReceived;
    public event Action? Disconnected;

    public async Task ConnectAsync(BambuMqttConnectionOptions options, CancellationToken cancellationToken = default)
    {
        var clientOptions = new MqttClientOptionsBuilder()
            .WithClientId(options.ClientId)
            .WithTcpServer(options.Ip, options.Port)
            .WithCredentials("bblp", options.AccessCode)
            .WithProtocolVersion(MqttProtocolVersion.V311)
            .WithKeepAlivePeriod(options.KeepAlive)
            .WithCleanSession(true)
            .WithTimeout(options.ConnectTimeout)
            // Bambu LAN firmware presents a self-signed certificate. This callback belongs only to this
            // MQTT client connected to the configured printer IP; no process-wide TLS validation is changed.
            .WithTlsOptions(tls => tls.WithCertificateValidationHandler(_ => true))
            .Build();
        await _client.ConnectAsync(clientOptions, cancellationToken);
    }

    public async Task SubscribeAsync(string topic, int qos, CancellationToken cancellationToken = default)
    {
        var quality = ToQualityOfService(qos);
        var subscription = new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter(filter => filter.WithTopic(topic).WithQualityOfServiceLevel(quality))
            .Build();
        await _client.SubscribeAsync(subscription, cancellationToken);
    }

    public async Task PublishAsync(string topic, string payload, int qos, CancellationToken cancellationToken = default)
    {
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(payload)
            .WithQualityOfServiceLevel(ToQualityOfService(qos))
            .Build();
        await _client.PublishAsync(message, cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_client.IsConnected)
            {
                await _client.DisconnectAsync(new MqttClientDisconnectOptionsBuilder().Build());
            }
        }
        catch { }
        _client.Dispose();
    }

    private static MqttQualityOfServiceLevel ToQualityOfService(int qos) => qos switch
    {
        0 => MqttQualityOfServiceLevel.AtMostOnce,
        1 => MqttQualityOfServiceLevel.AtLeastOnce,
        _ => throw new ArgumentOutOfRangeException(nameof(qos), "Bambu MQTT aceita QoS 0 ou 1 neste contrato.")
    };
}

public sealed class FluentFtpBambuUploader : IBambuFtpsUploader
{
    private static readonly TimeSpan TransferTimeout = TimeSpan.FromSeconds(120);
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(20);

    public async Task UploadAsync(string ip, int port, string accessCode, string localPath, string remotePath, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(localPath)) throw new FileNotFoundException("Arquivo 3MF local da Bambu não encontrado.", localPath);

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(TransferTimeout);
        var config = new FtpConfig
        {
            EncryptionMode = FtpEncryptionMode.Implicit,
            DataConnectionEncryption = true,
            DataConnectionType = FtpDataConnectionType.AutoPassive,
            ConnectTimeout = (int)ConnectTimeout.TotalMilliseconds,
            ReadTimeout = (int)TransferTimeout.TotalMilliseconds,
            WriteTimeout = (int)TransferTimeout.TotalMilliseconds,
            DataConnectionConnectTimeout = (int)ConnectTimeout.TotalMilliseconds,
            DataConnectionReadTimeout = (int)TransferTimeout.TotalMilliseconds,
            DataConnectionWriteTimeout = (int)TransferTimeout.TotalMilliseconds,
            LogPassword = false,
            LogUserName = false
        };

        await using var client = new AsyncFtpClient(ip, "bblp", accessCode, port, config);
        // As with the MQTT callback, this exception is limited to one FTPS client and the local Bambu endpoint.
        client.ValidateCertificate += (_, validation) => validation.Accept = true;
        try
        {
            await client.Connect(timeoutSource.Token);
            var uploaded = await client.UploadFile(localPath, remotePath, FtpRemoteExists.Overwrite,
                createRemoteDir: false, verifyOptions: FtpVerify.None, progress: null, token: timeoutSource.Token);
            if (uploaded != FtpStatus.Success) throw new IOException("A impressora Bambu recusou o arquivo enviado por FTPS.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException error)
        {
            throw new TimeoutException("Tempo esgotado ao enviar arquivo para a Bambu via FTPS.", error);
        }
        catch (Exception error)
        {
            var message = string.IsNullOrWhiteSpace(accessCode) ? error.Message : error.Message.Replace(accessCode, "***", StringComparison.Ordinal);
            throw new InvalidOperationException($"Falha no upload FTPS para Bambu: {message}");
        }
    }
}

public sealed class BambuPrinterAdapterService
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan StatusTimeout = TimeSpan.FromSeconds(8);
    private const string MockIp = "192.168.2.250";
    private readonly IBambuMqttClientFactory _mqttFactory;
    private readonly IBambuFtpsUploader _uploader;
    private readonly bool _developmentMockEnabled;

    public BambuPrinterAdapterService(
        IBambuMqttClientFactory? mqttFactory = null,
        IBambuFtpsUploader? uploader = null,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        _mqttFactory = mqttFactory ?? new MqttNetBambuClientFactory();
        _uploader = uploader ?? new FluentFtpBambuUploader();
        environment ??= ReadEnvironment();
        var runtime = environment.GetValueOrDefault("FILA_AGENT_ENVIRONMENT") ?? environment.GetValueOrDefault("PRINTFLOW_ENVIRONMENT");
        var mock = environment.GetValueOrDefault("FILA_AGENT_DEV_MOCK_BAMBU") ?? environment.GetValueOrDefault("PRINTFLOW_DEV_MOCK_BAMBU");
        _developmentMockEnabled = runtime?.Equals("DEVELOPMENT", StringComparison.OrdinalIgnoreCase) == true &&
            mock?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
    }

    public async Task<BambuPrinterConnection> ConnectAsync(BambuPrinterDescriptor printer, string accessCode, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(printer);
        var ip = Require(printer.Ip, "IP da Bambu obrigatório.");
        var serial = Require(printer.Serial, "Número de série da Bambu obrigatório.");
        var secret = Require(accessCode, "LAN Access Code da Bambu obrigatório.");
        var normalized = printer with { Ip = ip, Serial = serial, Port = printer.Port > 0 ? printer.Port : 8883, FtpsPort = printer.FtpsPort > 0 ? printer.FtpsPort : 990 };
        var isMock = _developmentMockEnabled && (printer.Mock || ip.Equals(MockIp, StringComparison.OrdinalIgnoreCase));
        if (isMock) return new BambuPrinterConnection(normalized, null, secret, mock: true);

        var client = _mqttFactory.Create();
        var connection = new BambuPrinterConnection(normalized, client, secret, mock: false);
        connection.MessageHandler = message => HandleMessage(connection, message);
        client.MessageReceived += connection.MessageHandler;
        client.Disconnected += () => connection.Connected = false;
        try
        {
            await client.ConnectAsync(new BambuMqttConnectionOptions(ip, normalized.Port, serial, secret,
                $"fila-agent-{Guid.NewGuid():N}", ConnectTimeout, TimeSpan.FromSeconds(60)), cancellationToken);
            await client.SubscribeAsync(connection.ReportTopic, qos: 0, cancellationToken);
            return connection;
        }
        catch (Exception error)
        {
            connection.Connected = false;
            await client.DisposeAsync();
            throw NormalizeConnectionError(error, secret);
        }
    }

    public async Task DisconnectAsync(BambuPrinterConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        if (connection.Mock || connection.Client is null)
        {
            connection.Connected = false;
            return;
        }
        if (connection.MessageHandler is not null) connection.Client.MessageReceived -= connection.MessageHandler;
        await connection.Client.DisposeAsync();
        connection.Connected = false;
    }

    public async Task<BambuPrinterStatus> GetStatusAsync(BambuPrinterConnection connection, CancellationToken cancellationToken = default)
    {
        RequireConnected(connection);
        if (connection.Mock)
        {
            var rawMock = JsonSerializer.SerializeToElement(new { print = new { gcode_state = connection.MockState } });
            return NormalizeStatus(rawMock, connection.Printer, connected: true);
        }

        var completion = new TaskCompletionSource<BambuPrinterStatus>(TaskCreationOptions.RunContinuationsAsynchronously);
        Action<BambuPrinterStatus> onStatus = status => completion.TrySetResult(status);
        connection.StatusUpdated += onStatus;
        try
        {
            await PublishJsonAsync(connection, new
            {
                pushing = new
                {
                    sequence_id = SequenceId(),
                    command = "pushall",
                    version = 1,
                    push_target = 1
                }
            }, qos: 0, cancellationToken);
            return await completion.Task.WaitAsync(StatusTimeout, cancellationToken);
        }
        catch (TimeoutException)
        {
            throw new TimeoutException("A Bambu conectou, mas não enviou telemetria dentro do tempo esperado.");
        }
        finally
        {
            connection.StatusUpdated -= onStatus;
        }
    }

    public Task PauseAsync(BambuPrinterConnection connection, CancellationToken cancellationToken = default) =>
        SendPrintCommandAsync(connection, "pause", parameter: null, cancellationToken);

    public Task ResumeAsync(BambuPrinterConnection connection, CancellationToken cancellationToken = default) =>
        SendPrintCommandAsync(connection, "resume", parameter: null, cancellationToken);

    public Task CancelAsync(BambuPrinterConnection connection, CancellationToken cancellationToken = default) =>
        SendPrintCommandAsync(connection, "stop", parameter: "", cancellationToken);

    public async Task<BambuPrintResult> StartPrintAsync(BambuPrinterConnection connection, BambuPrintJob job, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(job);
        RequireConnected(connection);
        if (connection.Mock)
        {
            connection.MockState = "RUNNING";
            return new BambuPrintResult(true, true, true, string.Empty, "project_file", Mock: true);
        }

        var printFile = GetPrintFile(job);
        var remoteName = SanitizeRemoteName(printFile.Name);
        var remoteDirectory = GetText(job.PrintProfile, "bambuRemoteDirectory") ?? connection.Printer.BambuRemoteDirectory ?? "/cache";
        var remotePath = JoinRemotePath(remoteDirectory, remoteName);

        await _uploader.UploadAsync(connection.Printer.Ip, connection.Printer.FtpsPort, connection.AccessCode,
            printFile.LocalPath, remotePath, cancellationToken);

        var payload = BuildProjectFilePayload(job, remotePath, remoteName);
        await PublishJsonAsync(connection, payload, qos: 1, cancellationToken);
        return new BambuPrintResult(true, true, true, remotePath, "project_file");
    }

    public static BambuPrinterStatus NormalizeStatus(JsonElement payload, BambuPrinterDescriptor printer, bool connected)
    {
        var print = GetObject(payload, "print");
        var state = GetText(print, "gcode_state") ?? GetText(print, "print_status") ?? "unknown";
        return new BambuPrinterStatus(
            connected,
            "bambu",
            "Bambu Lab",
            string.IsNullOrWhiteSpace(printer.Name) ? "Bambu Lab" : printer.Name,
            printer.Serial,
            printer.Ip,
            state,
            GetNumber(print, "mc_percent"),
            GetNumber(print, "mc_remaining_time"),
            GetNumber(print, "print_time"),
            GetNumber(print, "filament_used_g") ?? GetNumber(print, "filament_used"),
            GetNumber(print, "filament_used_mm"),
            GetNumber(print, "layer_num"),
            GetNumber(print, "total_layer_num"),
            GetNumber(print, "nozzle_temper"),
            GetNumber(print, "nozzle_target_temper"),
            GetNumber(print, "bed_temper"),
            GetNumber(print, "bed_target_temper"),
            GetText(print, "subtask_name"),
            payload.Clone());
    }

    private async Task SendPrintCommandAsync(BambuPrinterConnection connection, string command, string? parameter, CancellationToken cancellationToken)
    {
        RequireConnected(connection);
        if (connection.Mock)
        {
            connection.MockState = command switch { "pause" => "PAUSE", "resume" => "RUNNING", _ => "CANCELLED" };
            return;
        }
        var print = new Dictionary<string, object?> { ["sequence_id"] = SequenceId(), ["command"] = command };
        if (parameter is not null) print["param"] = parameter;
        await PublishJsonAsync(connection, new Dictionary<string, object?> { ["print"] = print }, qos: 1, cancellationToken);
    }

    private async Task PublishJsonAsync(BambuPrinterConnection connection, object payload, int qos, CancellationToken cancellationToken)
    {
        RequireConnected(connection);
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        try { await connection.Client!.PublishAsync(connection.RequestTopic, json, qos, cancellationToken); }
        catch (Exception error) { throw Redact(error, connection.AccessCode); }
    }

    private static void HandleMessage(BambuPrinterConnection connection, BambuMqttMessage message)
    {
        if (!message.Topic.Equals(connection.ReportTopic, StringComparison.Ordinal)) return;
        try
        {
            using var document = JsonDocument.Parse(message.Payload);
            var status = NormalizeStatus(document.RootElement, connection.Printer, connected: connection.Connected);
            connection.NotifyStatus(status);
        }
        catch (JsonException) { }
    }

    private static JsonElement BuildProjectFilePayload(BambuPrintJob job, string remotePath, string remoteName)
    {
        var profile = job.PrintProfile;
        var plate = GetTruthyNumber(profile, "plate", "plateIndex") ?? 1;
        var plateNumber = plate > 0 && Math.Truncate(plate) == plate ? (int)plate : 1;
        var options = new Dictionary<string, object?>
        {
            ["sequence_id"] = SequenceId(),
            ["command"] = "project_file",
            ["url"] = $"ftp://{remotePath}",
            ["file"] = remotePath,
            ["param"] = GetText(profile, "param") ?? $"Metadata/plate_{plateNumber}.gcode",
            ["subtask_id"] = GetText(profile, "subtaskId") ?? GetText(profile, "subtask_id") ?? "0",
            ["subtask_name"] = FirstNonBlank(job.Title, job.ProductName, remoteName),
            ["use_ams"] = GetBoolean(profile, "useAms") ?? IsTruthy(GetProperty(profile, "use_ams")),
            ["timelapse"] = GetBoolean(profile, "timelapse") ?? false,
            ["flow_cali"] = GetBoolean(profile, "flowCalibration") ?? true,
            ["bed_leveling"] = GetBoolean(profile, "bedLeveling") ?? true,
            ["layer_inspect"] = GetBoolean(profile, "layerInspect") ?? true,
            ["vibration_cali"] = GetBoolean(profile, "vibrationCalibration") ?? false
        };
        var amsMapping = GetArray(profile, "amsMapping") ?? GetArray(profile, "ams_mapping");
        if (amsMapping is not null) options["ams_mapping"] = amsMapping.Value;
        var root = JsonSerializer.SerializeToElement(new Dictionary<string, object?> { ["print"] = options }, JsonOptions);
        return root;
    }

    private static (string LocalPath, string Name) GetPrintFile(BambuPrintJob job)
    {
        var localPath = FirstNonBlank(job.PrintFile?.LocalPath, job.LocalPath);
        if (localPath is null) throw new InvalidOperationException("Arquivo 3MF local obrigatório para impressão Bambu.");
        var name = FirstNonBlank(job.PrintFile?.Name, job.Title, Path.GetFileName(localPath))!;
        var format = (job.PrintFile?.Format ?? Path.GetExtension(name).TrimStart('.')).Trim().ToLowerInvariant();
        if (format != "3mf" && !name.EndsWith(".gcode.3mf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Bambu aceita apenas arquivo .3mf ou .gcode.3mf.");
        if (!File.Exists(localPath)) throw new FileNotFoundException("Arquivo 3MF local da Bambu não encontrado.", localPath);
        return (Path.GetFullPath(localPath), name);
    }

    private static string SanitizeRemoteName(string value)
    {
        var baseName = Path.GetFileName(value.Replace('\\', '/'));
        var safe = new string(baseName.Select(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-' ? character : '_').ToArray())
            .TrimStart('.')
            .Trim();
        if (safe.Length > 120) safe = safe[..120];
        if (string.IsNullOrWhiteSpace(safe)) safe = "fila-agent-job.gcode.3mf";
        return safe.EndsWith(".gcode.3mf", StringComparison.OrdinalIgnoreCase)
            ? safe
            : (safe.EndsWith(".3mf", StringComparison.OrdinalIgnoreCase) ? safe[..^4] : safe) + ".gcode.3mf";
    }

    private static string JoinRemotePath(string directory, string name)
    {
        var parts = directory.Trim().Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => new string(part.Where(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-').ToArray()))
            .Where(part => part.Length > 0 && part is not "." and not "..");
        var safeDirectory = string.Join('/', parts);
        return string.IsNullOrEmpty(safeDirectory) ? $"/{name}" : $"/{safeDirectory}/{name}";
    }

    private static void RequireConnected(BambuPrinterConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        if (connection.Mock && connection.Connected) return;
        if (!connection.Connected || connection.Client is null || !connection.Client.IsConnected)
            throw new InvalidOperationException("Bambu não está conectada.");
    }

    private static InvalidOperationException NormalizeConnectionError(Exception error, string accessCode)
    {
        var messages = GetExceptionMessages(error);
        if (messages.Any(message => message.Contains("not authorized", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("not authorised", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("reason code 5", StringComparison.OrdinalIgnoreCase)))
            return new InvalidOperationException("LAN Access Code da Bambu rejeitado. Confira o código em Rede > LAN Only Mode e cadastre-o novamente.");
        return new InvalidOperationException(RedactMessage(string.Join(" | ", messages), accessCode));
    }

    private static Exception Redact(Exception error, string secret) =>
        new InvalidOperationException(RedactMessage(string.Join(" | ", GetExceptionMessages(error)), secret));

    private static IReadOnlyList<string> GetExceptionMessages(Exception error)
    {
        var messages = new List<string>();
        for (var current = error; current is not null; current = current.InnerException)
        {
            if (!string.IsNullOrWhiteSpace(current.Message)) messages.Add($"{current.GetType().Name}: {current.Message} (0x{current.HResult:X8})");
        }
        return messages;
    }

    private static string RedactMessage(string message, string secret) =>
        string.IsNullOrEmpty(secret) ? message : message.Replace(secret, "***", StringComparison.Ordinal);

    private static string Require(string? value, string message) =>
        string.IsNullOrWhiteSpace(value) ? throw new InvalidOperationException(message) : value.Trim();

    private static string SequenceId() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);

    private static string? FirstNonBlank(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();

    private static JsonElement GetObject(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var result) && result.ValueKind == JsonValueKind.Object ? result : default;

    private static JsonElement GetProperty(JsonElement? value, string name)
    {
        if (value is not { ValueKind: JsonValueKind.Object } root) return default;
        return root.TryGetProperty(name, out var result) ? result : default;
    }

    private static string? GetText(JsonElement value, string name) => GetText((JsonElement?)value, name);

    private static string? GetText(JsonElement? value, string name)
    {
        var property = GetProperty(value, name);
        return property.ValueKind switch
        {
            JsonValueKind.String => property.GetString(),
            JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => property.ToString(),
            _ => null
        };
    }

    private static double? GetNumber(JsonElement value, string name)
    {
        var property = GetProperty(value, name);
        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var number) && double.IsFinite(number)) return number;
        if (property.ValueKind == JsonValueKind.String && double.TryParse(property.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number) && double.IsFinite(number)) return number;
        return null;
    }

    private static double? GetTruthyNumber(JsonElement? value, params string[] names)
    {
        foreach (var name in names)
        {
            var property = GetProperty(value, name);
            if (!IsTruthy(property)) continue;
            if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var number)) return number;
            if (property.ValueKind == JsonValueKind.String && double.TryParse(property.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return number;
        }
        return null;
    }

    private static bool? GetBoolean(JsonElement? value, string name)
    {
        var property = GetProperty(value, name);
        return property.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    private static bool IsTruthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined or JsonValueKind.Null or JsonValueKind.False => false,
        JsonValueKind.String => !string.IsNullOrEmpty(value.GetString()),
        JsonValueKind.Number => value.TryGetDouble(out var number) && number != 0 && !double.IsNaN(number),
        _ => true
    };

    private static JsonElement? GetArray(JsonElement? value, string name)
    {
        var property = GetProperty(value, name);
        return property.ValueKind == JsonValueKind.Array ? property.Clone() : null;
    }

    private static IReadOnlyDictionary<string, string?> ReadEnvironment() =>
        Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}
