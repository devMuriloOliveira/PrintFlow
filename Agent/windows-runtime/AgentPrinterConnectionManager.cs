using System.Collections.Concurrent;
using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed record AgentPrinterDescriptor(string Protocol, string ConnectionType, string? Name = null, string? Manufacturer = null,
    string? Model = null, string? Software = null, string? Ip = null, int? Port = null, int? BaudRate = null,
    string? Serial = null, string? Firmware = null, bool Mock = false, string? PortName = null)
{
    public static AgentPrinterDescriptor FromJson(JsonElement value)
    {
        var protocol = RequiredText(value, "protocol").ToLowerInvariant();
        var connectionType = Text(value, "connectionType") ?? (protocol == "marlin" ? "usb" : "network");
        var portText = Text(value, "port");
        var isUsb = connectionType.Equals("usb", StringComparison.OrdinalIgnoreCase);
        int? port = !isUsb && int.TryParse(portText, out var numericPort) ? numericPort : null;
        return new AgentPrinterDescriptor(protocol, connectionType, Text(value, "name"), Text(value, "manufacturer"),
            Text(value, "model"), Text(value, "software"), Text(value, "ip"), port,
            Integer(value, "baudRate"), Text(value, "serial"), Text(value, "firmware"), Boolean(value, "mock"), isUsb ? portText : null);
    }

    public AgentPrinterDescriptor Normalize()
    {
        var protocol = Protocol.Trim().ToLowerInvariant();
        if (protocol is not ("bambu" or "marlin" or "octoprint" or "moonraker" or "prusalink"))
            throw new NotSupportedException($"Protocolo de impressora nao suportado: {protocol}.");
        var connectionType = protocol == "marlin" ? "usb" : "network";
        var defaultPort = protocol switch { "bambu" => 8883, "moonraker" => 7125, "octoprint" or "prusalink" => 80, _ => (int?)null };
        var port = connectionType == "network" ? (Port is > 0 ? Port : defaultPort) : null;
        return this with
        {
            Protocol = protocol,
            ConnectionType = connectionType,
            Port = port,
            BaudRate = protocol == "marlin" && BaudRate is not > 0 ? 115200 : BaudRate,
            Ip = string.IsNullOrWhiteSpace(Ip) ? null : Ip.Trim(),
            PortName = string.IsNullOrWhiteSpace(PortName) ? null : PortName.Trim(),
            Serial = string.IsNullOrWhiteSpace(Serial) ? null : Serial.Trim()
        };
    }

    public string? ConnectionKey
    {
        get
        {
            var printer = Normalize();
            if (printer.Protocol == "bambu") return string.IsNullOrWhiteSpace(printer.Serial) ? null : $"bambu:{printer.Serial}";
            if (printer.ConnectionType == "usb") return string.IsNullOrWhiteSpace(printer.PortName) ? null : $"{printer.Protocol}:{printer.PortName}";
            if (string.IsNullOrWhiteSpace(printer.Ip)) return null;
            return $"{printer.Protocol}:{printer.Ip}:{printer.Port?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty}";
        }
    }

    public PrinterCredentialIdentity CredentialIdentity
    {
        get
        {
            var printer = Normalize();
            return new PrinterCredentialIdentity(printer.Protocol, printer.Ip, printer.Port, printer.Serial, printer.PortName);
        }
    }

    private static string RequiredText(JsonElement element, string name) => Text(element, name) is { Length: > 0 } value
        ? value : throw new InvalidDataException($"Impressora sem campo obrigatorio {name}.");

    private static string? Text(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        foreach (var property in element.EnumerateObject())
        {
            if (!property.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) continue;
            return property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString(),
                JsonValueKind.Number => property.Value.GetRawText(),
                _ => null
            };
        }
        return null;
    }

    private static int? Integer(JsonElement element, string name) => int.TryParse(Text(element, name), out var value) ? value : null;
    private static bool Boolean(JsonElement element, string name) => Text(element, name)?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
}

public sealed record AgentPrinterConnectionResult(bool Connected, string Protocol, bool Reused, string Key);
public sealed record AgentPrinterReconnectOutcome(string? PrinterId, string? Name, string Protocol, bool Connected, string? Error);
public sealed record AgentPrinterReconnectSummary(int Requested, int Connected, IReadOnlyList<AgentPrinterReconnectOutcome> Outcomes);
public sealed record AgentPrinterHeartbeatState(string ConnectionKey, string Status, string LastError,
    object? LastStatus, DateTimeOffset ObservedAt);

public sealed class AgentPrinterConnectionManager : IAsyncDisposable
{
    private readonly AgentPrinterCredentialStore _credentials;
    private readonly HttpPrinterAdapterService _http;
    private readonly BambuPrinterAdapterService _bambu;
    private readonly MarlinSerialAdapterService _marlin;
    private readonly AgentCloudClient _cloud;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, AgentPrinterHeartbeatState> _connectionStates = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Session> _sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _sessionGate = new();
    private bool _disposed;

    public AgentPrinterConnectionManager(AgentCloudClient cloud, AgentPrinterCredentialStore credentials,
        HttpPrinterAdapterService? http = null, BambuPrinterAdapterService? bambu = null, MarlinSerialAdapterService? marlin = null)
    {
        _cloud = cloud ?? throw new ArgumentNullException(nameof(cloud));
        _credentials = credentials ?? throw new ArgumentNullException(nameof(credentials));
        _http = http ?? new HttpPrinterAdapterService();
        _bambu = bambu ?? new BambuPrinterAdapterService();
        _marlin = marlin ?? new MarlinSerialAdapterService();
    }

    public int ActiveConnectionCount { get { lock (_sessionGate) return _sessions.Count; } }
    public IReadOnlyList<AgentPrinterHeartbeatState> ListConnectionStates() =>
        _connectionStates.Values.OrderBy(state => state.ConnectionKey, StringComparer.OrdinalIgnoreCase).ToArray();

    public async Task<AgentPrinterConnectionResult> ConnectAsync(AgentCredentials agentCredentials, AgentPrinterDescriptor printer,
        IReadOnlyDictionary<string, string?>? suppliedOptions = null, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        var normalized = printer.Normalize();
        var key = normalized.ConnectionKey ?? throw new InvalidDataException("Nao foi possivel gerar a identificacao da impressora.");
        var gate = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var storedOptions = await _credentials.LoadAsync(normalized.CredentialIdentity, cancellationToken);
            var options = new Dictionary<string, string?>(storedOptions, StringComparer.Ordinal);
            if (suppliedOptions is not null)
                foreach (var option in suppliedOptions) options[option.Key] = option.Value;

            Session? existing;
            lock (_sessionGate) _sessions.TryGetValue(key, out existing);
            if (existing is not null && existing.IsActive)
            {
                await _credentials.SaveAsync(normalized.CredentialIdentity, options, cancellationToken);
                RecordConnectionState(key, "connected");
                return new AgentPrinterConnectionResult(true, normalized.Protocol, true, key);
            }
            if (existing is not null)
            {
                await DisconnectSessionAsync(existing);
                lock (_sessionGate) _sessions.Remove(key);
            }

            var session = await OpenSessionAsync(normalized, options, cancellationToken);
            lock (_sessionGate) _sessions[key] = session;
            await _credentials.SaveAsync(normalized.CredentialIdentity, options, cancellationToken);
            RecordConnectionState(key, "connected");
            return new AgentPrinterConnectionResult(true, normalized.Protocol, false, key);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            RecordConnectionState(key, "disconnected", error.Message);
            throw;
        }
        finally { gate.Release(); }
    }

    public async Task<AgentPrinterConnectionResult> EnsureConnectedAsync(AgentCredentials credentials, AgentPrinterDescriptor printer,
        CancellationToken cancellationToken = default) => await ConnectAsync(credentials, printer, suppliedOptions: null, cancellationToken);

    public async Task<bool> DisconnectAsync(AgentPrinterDescriptor printer, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        var key = printer.ConnectionKey ?? throw new InvalidDataException("Impressora invalida para desconexao.");
        var gate = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            Session? session;
            lock (_sessionGate)
            {
                if (!_sessions.Remove(key, out session))
                {
                    RecordConnectionState(key, "disconnected");
                    return false;
                }
            }
            await DisconnectSessionAsync(session);
            RecordConnectionState(key, "disconnected");
            return true;
        }
        finally { gate.Release(); }
    }

    public Task<object> GetStatusAsync(AgentCredentials credentials, AgentPrinterDescriptor printer,
        CancellationToken cancellationToken = default) => ExecuteWithSessionAsync(credentials, printer, async session =>
    {
        if (session.Bambu is not null) return await _bambu.GetStatusAsync(session.Bambu, cancellationToken);
        if (session.Marlin is not null) return await _marlin.GetStatusAsync(session.Marlin, cancellationToken);
        if (session.Http is not null) return await _http.GetStatusAsync(session.Http, cancellationToken);
        throw new InvalidOperationException("Sessao de impressora indisponivel.");
    }, cancellationToken);

    public Task<object> StartPrintAsync(AgentCredentials credentials, AgentPrinterDescriptor printer, string localPath,
        string? fileName, string format, string? checksum, string? title, string? productName, JsonElement? printProfile,
        CancellationToken cancellationToken = default) => ExecuteWithSessionAsync(credentials, printer, async session =>
    {
        if (session.Bambu is not null)
        {
            var printFile = new BambuPrintFile(localPath, fileName, format);
            var job = new BambuPrintJob(printFile, localPath, title, productName, printProfile);
            return await _bambu.StartPrintAsync(session.Bambu, job, cancellationToken);
        }

        if (session.Marlin is not null)
            return await _marlin.StartPrintAsync(session.Marlin, localPath, fileName, format, cancellationToken);

        if (session.Http is not null)
            return await _http.StartPrintAsync(session.Http, localPath, fileName, checksum, cancellationToken);

        throw new InvalidOperationException("Sessao de impressora indisponivel.");
    }, cancellationToken);

    public Task<object> PauseAsync(AgentCredentials credentials, AgentPrinterDescriptor printer,
        CancellationToken cancellationToken = default) => ExecuteControlAsync(credentials, printer, "pause", cancellationToken);

    public Task<object> ResumeAsync(AgentCredentials credentials, AgentPrinterDescriptor printer,
        CancellationToken cancellationToken = default) => ExecuteControlAsync(credentials, printer, "resume", cancellationToken);

    public Task<object> CancelAsync(AgentCredentials credentials, AgentPrinterDescriptor printer,
        CancellationToken cancellationToken = default) => ExecuteControlAsync(credentials, printer, "cancel", cancellationToken);

    public async Task<AgentPrinterReconnectSummary> RestoreRegisteredPrintersAsync(AgentCredentials credentials,
        CancellationToken cancellationToken = default)
    {
        var response = await _cloud.GetRegisteredPrintersForReconnectAsync(credentials, cancellationToken);
        if (!TryGetProperty(response, "printers", out var printers) || printers.ValueKind != JsonValueKind.Array)
            return new AgentPrinterReconnectSummary(0, 0, []);

        var outcomes = new List<AgentPrinterReconnectOutcome>();
        foreach (var item in printers.EnumerateArray())
        {
            cancellationToken.ThrowIfCancellationRequested();
            string? protocol = null;
            string? name = null;
            string? printerId = null;
            try
            {
                protocol = GetText(item, "protocol") ?? string.Empty;
                name = GetText(item, "name") ?? GetText(item, "serial") ?? GetText(item, "ip");
                printerId = GetText(item, "id");
                var descriptor = AgentPrinterDescriptor.FromJson(item);
                await EnsureConnectedAsync(credentials, descriptor, cancellationToken);
                outcomes.Add(new AgentPrinterReconnectOutcome(printerId, name, protocol, true, null));
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                outcomes.Add(new AgentPrinterReconnectOutcome(printerId, name, protocol ?? string.Empty, false, error.Message));
            }
        }
        return new AgentPrinterReconnectSummary(outcomes.Count, outcomes.Count(outcome => outcome.Connected), outcomes);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Session[] sessions;
        lock (_sessionGate) { sessions = _sessions.Values.ToArray(); _sessions.Clear(); }
        foreach (var session in sessions)
        {
            try { await DisconnectSessionAsync(session); }
            catch { }
        }
        _http.Dispose();
        foreach (var gate in _locks.Values) gate.Dispose();
        _locks.Clear();
    }

    private async Task<Session> OpenSessionAsync(AgentPrinterDescriptor printer, IReadOnlyDictionary<string, string?> options,
        CancellationToken cancellationToken)
    {
        return printer.Protocol switch
        {
            "bambu" => new Session(printer, null, await _bambu.ConnectAsync(new BambuPrinterDescriptor(
                printer.Ip ?? string.Empty, printer.Serial ?? string.Empty, printer.Port ?? 8883,
                Name: printer.Name, Mock: printer.Mock), options.GetValueOrDefault("accessCode") ?? string.Empty, cancellationToken), null),
            "marlin" => new Session(printer, null, null, await _marlin.ConnectAsync(new MarlinPrinterDescriptor(
                printer.PortName ?? string.Empty, printer.BaudRate, printer.Name, printer.Manufacturer), cancellationToken)),
            "octoprint" or "moonraker" or "prusalink" => new Session(printer,
                await _http.ConnectAsync(new NetworkPrinterDescriptor(printer.Protocol, printer.Ip ?? string.Empty, printer.Port,
                    printer.Name, printer.Manufacturer), options, cancellationToken), null, null),
            _ => throw new NotSupportedException($"Protocolo de impressora nao suportado: {printer.Protocol}.")
        };
    }

    private async Task DisconnectSessionAsync(Session session)
    {
        if (session.Bambu is not null) await _bambu.DisconnectAsync(session.Bambu);
        else if (session.Marlin is not null) await _marlin.DisconnectAsync(session.Marlin);
        else if (session.Http is not null) _http.Disconnect(session.Http);
    }

    private Task<object> ExecuteControlAsync(AgentCredentials credentials, AgentPrinterDescriptor printer, string action,
        CancellationToken cancellationToken) => ExecuteWithSessionAsync(credentials, printer, async session =>
    {
        if (session.Bambu is not null)
        {
            if (action == "pause") await _bambu.PauseAsync(session.Bambu, cancellationToken);
            else if (action == "resume") await _bambu.ResumeAsync(session.Bambu, cancellationToken);
            else await _bambu.CancelAsync(session.Bambu, cancellationToken);
            var result = new Dictionary<string, object?> { ["success"] = true };
            if (session.Bambu.Mock) result["mock"] = true;
            return result;
        }

        if (session.Marlin is not null)
        {
            var result = action switch
            {
                "pause" => await _marlin.PauseAsync(session.Marlin, cancellationToken),
                "resume" => await _marlin.ResumeAsync(session.Marlin, cancellationToken),
                _ => await _marlin.CancelAsync(session.Marlin, cancellationToken)
            };
            var values = new Dictionary<string, object?> { ["success"] = result.Success };
            if (result.Paused) values["paused"] = true;
            if (result.Resumed) values["resumed"] = true;
            if (result.Cancelled) values["cancelled"] = true;
            return values;
        }

        if (session.Http is not null)
        {
            return action switch
            {
                "pause" => await _http.PauseAsync(session.Http, cancellationToken),
                "resume" => await _http.ResumeAsync(session.Http, cancellationToken),
                _ => await _http.CancelAsync(session.Http, cancellationToken)
            };
        }

        throw new InvalidOperationException("Sessao de impressora indisponivel.");
    }, cancellationToken);

    private async Task<object> ExecuteWithSessionAsync(AgentCredentials credentials, AgentPrinterDescriptor printer,
        Func<Session, Task<object>> operation, CancellationToken cancellationToken)
    {
        await EnsureConnectedAsync(credentials, printer, cancellationToken);
        var normalized = printer.Normalize();
        var key = normalized.ConnectionKey ?? throw new InvalidDataException("Impressora invalida para operacao.");
        var gate = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            Session? session;
            lock (_sessionGate) _sessions.TryGetValue(key, out session);
            if (session is null || !session.IsActive) throw new InvalidOperationException("Impressora nao conectada.");
            return await operation(session);
        }
        finally { gate.Release(); }
    }

    private static bool TryGetProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    private static string? GetText(JsonElement element, string name) => TryGetProperty(element, name, out var value)
        ? value.ValueKind == JsonValueKind.String ? value.GetString() : value.ValueKind == JsonValueKind.Number ? value.GetRawText() : null
        : null;

    private void ThrowIfDisposed() { if (_disposed) throw new ObjectDisposedException(nameof(AgentPrinterConnectionManager)); }

    private void RecordConnectionState(string key, string status, string error = "") =>
        _connectionStates[key] = new AgentPrinterHeartbeatState(key, status,
            error.Length > 500 ? error[..500] : error, null, DateTimeOffset.UtcNow);

    private sealed record Session(AgentPrinterDescriptor Printer, HttpPrinterConnection? Http, BambuPrinterConnection? Bambu, MarlinPrinterConnection? Marlin)
    {
        public bool IsActive => Http?.Connected == true || Bambu?.Connected == true || Marlin?.Connected == true;
    }
}
