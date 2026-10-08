using System.Text.Json;
using System.Text.Json.Serialization;

namespace FilaAgent.Runtime;

public sealed class AgentPrinterCommandHandler(
    AgentCloudClient cloudClient,
    AgentLocalOperationsStore operationsStore,
    AgentPrinterConnectionManager printers,
    AgentPrintFileCache printFiles,
    NetworkDiscoveryService? networkDiscovery = null,
    UsbDiscoveryService? usbDiscovery = null,
    Action<AgentCredentials, AgentProductionJobMonitor, CancellationToken>? onPrintJobStarted = null,
    Action<string>? log = null) : IDisposable
{
    private readonly NetworkDiscoveryService _networkDiscovery = networkDiscovery ?? new NetworkDiscoveryService();
    private readonly UsbDiscoveryService _usbDiscovery = usbDiscovery ?? new UsbDiscoveryService();
    private readonly bool _ownsNetworkDiscovery = networkDiscovery is null;
    private readonly Action<AgentCredentials, AgentProductionJobMonitor, CancellationToken>? _onPrintJobStarted = onPrintJobStarted;
    private readonly Action<string>? _log = log;
    private static readonly HashSet<string> SupportedCommands = new(StringComparer.Ordinal)
    {
        "connect_printer",
        "disconnect_printer",
        "discover_printers",
        "start_print",
        "printer_status",
        "printer_pause",
        "printer_resume",
        "printer_cancel"
    };
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    private static readonly IReadOnlyDictionary<string, HashSet<string>> AllowedPrintFormats =
        new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
        {
            ["bambu"] = new(StringComparer.OrdinalIgnoreCase) { "3mf", "gcode", "bgcode" },
            ["marlin"] = new(StringComparer.OrdinalIgnoreCase) { "gcode" },
            ["octoprint"] = new(StringComparer.OrdinalIgnoreCase) { "gcode" },
            ["moonraker"] = new(StringComparer.OrdinalIgnoreCase) { "gcode" },
            ["prusalink"] = new(StringComparer.OrdinalIgnoreCase) { "gcode", "bgcode" }
        };

    public async Task<AgentCommandDispatchResult> TryDispatchPendingAsync(AgentCredentials credentials,
        JsonElement pendingResponse, CancellationToken cancellationToken = default)
    {
        if (!TryGetProperty(pendingResponse, "command", out var command) || command.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return new AgentCommandDispatchResult(false, "empty");

        var commandType = GetText(command, "type") ?? string.Empty;
        if (!SupportedCommands.Contains(commandType)) return new AgentCommandDispatchResult(false, "unsupported");

        var commandId = GetRequiredText(command, "id");
        var start = operationsStore.Begin(new AgentCommand(commandId, commandType));
        if (start.Status == "processing") return new AgentCommandDispatchResult(true, "processing");
        if (start.Status == "completed")
        {
            if (!cancellationToken.IsCancellationRequested)
                await TryDeliverCompletionAsync(credentials, commandId, cancellationToken);
            return new AgentCommandDispatchResult(true, "completed", start.Result);
        }

        object result;
        try
        {
            result = await ExecuteAsync(credentials, commandType, command, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            result = new { success = false, error = "Operacao da impressora cancelada.", code = "cancelled" };
        }
        catch (Exception error)
        {
            result = new { success = false, error = error.Message };
        }

        operationsStore.RecordResult(commandId, result, commandType);
        var persisted = operationsStore.Begin(new AgentCommand(commandId, commandType));
        if (!cancellationToken.IsCancellationRequested)
            await TryDeliverCompletionAsync(credentials, commandId, cancellationToken);
        return new AgentCommandDispatchResult(true, "completed", persisted.Result);
    }

    public async Task<int> FlushPendingCompletionsAsync(AgentCredentials credentials, CancellationToken cancellationToken = default)
    {
        if (cancellationToken.IsCancellationRequested) return 0;
        var completions = operationsStore.ListPendingCompletions(limit: 100);
        foreach (var completion in completions)
            await TryDeliverCompletionAsync(credentials, completion, cancellationToken);
        return completions.Count;
    }

    private async Task<object> ExecuteAsync(AgentCredentials credentials, string commandType, JsonElement command,
        CancellationToken cancellationToken)
    {
        if (commandType == "discover_printers")
            return await DiscoverPrintersAsync(credentials, GetRequiredText(command, "id"), cancellationToken);

        if (!TryGetProperty(command, "payload", out var payload) || payload.ValueKind != JsonValueKind.Object ||
            !TryGetProperty(payload, "printer", out var printerJson) || printerJson.ValueKind != JsonValueKind.Object)
            return new { success = false, error = "Dados da impressora nao foram enviados." };

        if (commandType == "connect_printer" && string.IsNullOrWhiteSpace(GetText(printerJson, "protocol")))
            return new { success = false, error = "Protocolo da impressora nao informado." };

        var printer = AgentPrinterDescriptor.FromJson(printerJson).Normalize();
        switch (commandType)
        {
            case "connect_printer":
            {
                var options = TryGetProperty(payload, "options", out var optionJson) ? ReadOptions(optionJson) : new Dictionary<string, string?>();
                var connection = await printers.ConnectAsync(credentials, printer, options, cancellationToken);
                return new
                {
                    success = true,
                    printer = new
                    {
                        protocol = printer.Protocol,
                        connectionType = printer.ConnectionType,
                        name = printer.Name,
                        manufacturer = printer.Manufacturer,
                        model = printer.Model,
                        software = printer.Software,
                        ip = printer.Ip,
                        port = printer.PortName ?? printer.Port?.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        baudRate = printer.BaudRate,
                        serial = printer.Serial,
                        firmware = printer.Firmware,
                        mock = printer.Mock
                    },
                    connection = new
                    {
                        connected = connection.Connected,
                        protocol = connection.Protocol,
                        reused = connection.Reused,
                        key = connection.Key,
                        capabilities = new { }
                    }
                };
            }
            case "disconnect_printer":
            {
                var disconnected = await printers.DisconnectAsync(printer, cancellationToken);
                return new
                {
                    success = true,
                    result = new { disconnected = true, alreadyDisconnected = !disconnected }
                };
            }
            case "start_print":
                return await StartPrintAsync(credentials, GetRequiredText(command, "id"), payload, printer, cancellationToken);
            case "printer_status":
                return new { success = true, status = await printers.GetStatusAsync(credentials, printer, cancellationToken) };
            case "printer_pause":
                return new { success = true, result = await printers.PauseAsync(credentials, printer, cancellationToken) };
            case "printer_resume":
                return new { success = true, result = await printers.ResumeAsync(credentials, printer, cancellationToken) };
            case "printer_cancel":
                return new { success = true, result = await printers.CancelAsync(credentials, printer, cancellationToken) };
            default:
                return new { success = false, error = "Comando desconhecido" };
        }
    }

    private async Task<object> DiscoverPrintersAsync(AgentCredentials credentials, string commandId,
        CancellationToken cancellationToken)
    {
        var timeoutMilliseconds = ReadDiscoveryTimeoutMilliseconds();
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeoutMilliseconds);
        await using var progress = new AgentDiscoveryProgressReporter(cloudClient, credentials, commandId, timeoutSource.Token);

        var network = await _networkDiscovery.ScanAsync(onPrinterDiscovered: progress.Add, cancellationToken: timeoutSource.Token);
        var usb = await _usbDiscovery.ScanAsync(onPrinterDiscovered: progress.Add, cancellationToken: timeoutSource.Token);
        await progress.FlushAsync(cancellationToken);

        return new
        {
            success = true,
            printers = network.Printers.Cast<object>().Concat(usb).ToArray(),
            diagnostics = new { warnings = network.Warnings }
        };
    }

    private static int ReadDiscoveryTimeoutMilliseconds()
    {
        var configured = Environment.GetEnvironmentVariable("FILA_AGENT_DISCOVERY_TIMEOUT_MS") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_DISCOVERY_TIMEOUT_MS");
        return int.TryParse(configured, out var timeout) && timeout is >= 1_000 and <= 600_000 ? timeout : 120_000;
    }

    private async Task<object> StartPrintAsync(AgentCredentials credentials, string commandId, JsonElement payload,
        AgentPrinterDescriptor printer, CancellationToken cancellationToken)
    {
        if (!TryGetProperty(payload, "job", out var job) || job.ValueKind != JsonValueKind.Object ||
            !TryGetProperty(job, "printFile", out var printFile) || printFile.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Arquivo do Production Job ausente.");

        var format = GetText(printFile, "format")?.Trim().ToLowerInvariant() ?? string.Empty;
        var name = GetText(printFile, "name")?.Trim() ?? string.Empty;
        if (!string.Equals(GetText(job, "validationStatus"), "validated", StringComparison.Ordinal) ||
            name.Length == 0 || format.Length == 0)
            throw new InvalidDataException("Receita de impressao nao validada para envio ao Agent.");

        if (AllowedPrintFormats.TryGetValue(printer.Protocol, out var allowedFormats) && !allowedFormats.Contains(format))
            throw new InvalidDataException($"Formato {format.ToUpperInvariant()} nao suportado para {printer.Protocol}.");

        if (printer.Protocol == "bambu" && format == "3mf" &&
            !HasText(printFile, "slicingArtifactStorageKey") && !HasText(job, "slicingArtifactStorageKey"))
            throw new InvalidDataException("Arquivo 3MF ainda nao foi fatiado. Prepare o G-code antes de iniciar na Bambu.");

        var storageKey = GetText(printFile, "storageKey")?.Trim() ?? string.Empty;
        if (!printer.Mock && storageKey.Length == 0)
            throw new InvalidDataException("Arquivo de impressao nao foi disponibilizado para download.");

        var printJobId = FirstNonBlank(GetText(payload, "printJobId"), GetText(job, "id"));
        CachedPrintFile? cachedFile = null;
        var keepPinnedForMonitor = false;
        try
        {
            if (storageKey.Length > 0)
            {
                if (printJobId.Length == 0)
                    throw new InvalidDataException("ID do Production Job obrigatorio para baixar o arquivo.");
                var descriptor = JsonSerializer.Deserialize<AgentPrintFileDescriptor>(printFile.GetRawText(), JsonOptions)
                    ?? throw new InvalidDataException("Metadados do arquivo do Production Job invalidos.");
                cachedFile = await printFiles.EnsureCachedAsync(credentials, printJobId, descriptor, cancellationToken);
                await printFiles.PinAsync(cachedFile.LocalPath, printJobId, ToPinMetadata(printer), cancellationToken);
            }

            var printProfile = TryGetProperty(job, "printProfile", out var profile) && profile.ValueKind == JsonValueKind.Object
                ? profile.Clone()
                : (JsonElement?)null;
            var result = await printers.StartPrintAsync(credentials, printer, cachedFile?.LocalPath ?? string.Empty,
                name, format, GetText(printFile, "hash"), GetText(job, "title"), GetText(job, "productName"),
                printProfile, cancellationToken);
            var startResult = JsonSerializer.SerializeToElement(result, JsonOptions);
            keepPinnedForMonitor = !printer.Mock &&
                (HasTrueProperty(startResult, "started") || HasTrueProperty(startResult, "background"));
            if (keepPinnedForMonitor && printJobId.Length > 0)
            {
                var startedAt = DateTimeOffset.TryParse(GetText(payload, "startedAt"), out var parsedStartedAt)
                    ? parsedStartedAt.ToUniversalTime()
                    : DateTimeOffset.UtcNow;
                var monitor = new AgentProductionJobMonitor(printJobId, commandId, printer, startedAt);
                try
                {
                    operationsStore.QueueProductionJobMonitor(monitor);
                    _onPrintJobStarted?.Invoke(credentials, monitor, cancellationToken);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    _log?.Invoke($"Monitor do Production Job {printJobId} nao iniciou; arquivo permanece fixado: {error.GetType().Name}");
                }
            }
            return new { success = true, result };
        }
        finally
        {
            if (cachedFile is not null && !keepPinnedForMonitor)
                await printFiles.UnpinAsync(cachedFile.LocalPath);
        }
    }

    private static PrinterPinMetadata ToPinMetadata(AgentPrinterDescriptor printer) => new(
        Protocol: printer.Protocol,
        ConnectionType: printer.ConnectionType,
        Name: printer.Name,
        Manufacturer: printer.Manufacturer,
        Model: printer.Model,
        Software: printer.Software,
        Ip: printer.Ip,
        Port: printer.Port,
        BaudRate: printer.BaudRate,
        Serial: printer.Serial,
        Firmware: printer.Firmware);

    private static bool HasTrueProperty(JsonElement element, string name) =>
        TryGetProperty(element, name, out var value) && value.ValueKind == JsonValueKind.True;

    private static bool HasText(JsonElement element, string name) => !string.IsNullOrWhiteSpace(GetText(element, name));

    private static string FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    private async Task TryDeliverCompletionAsync(AgentCredentials credentials, string commandId, CancellationToken cancellationToken)
    {
        var completion = operationsStore.ListPendingCompletions(limit: 100)
            .FirstOrDefault(item => string.Equals(item.CommandId, commandId, StringComparison.Ordinal));
        if (completion is not null) await TryDeliverCompletionAsync(credentials, completion, cancellationToken);
    }

    private async Task TryDeliverCompletionAsync(AgentCredentials credentials, PendingCompletion completion,
        CancellationToken cancellationToken)
    {
        var success = !TryGetProperty(completion.Result, "success", out var value) || value.ValueKind != JsonValueKind.False;
        try
        {
            await cloudClient.CompleteCommandAsync(credentials, completion.CommandId, success, completion.Result, cancellationToken);
            operationsStore.AcknowledgeCompletion(completion.CommandId);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            operationsStore.RetryCompletion(completion.CommandId, error: error.GetType().Name);
        }
    }

    private static Dictionary<string, string?> ReadOptions(JsonElement element)
    {
        var options = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (element.ValueKind != JsonValueKind.Object) return options;
        foreach (var property in element.EnumerateObject())
        {
            var value = property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString(),
                JsonValueKind.Number => property.Value.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => null
            };
            if (value is not null) options[property.Name] = value;
        }
        return options;
    }

    private static string GetRequiredText(JsonElement element, string name) => GetText(element, name) is { Length: > 0 } value
        ? value : throw new InvalidDataException($"Comando sem identificador {name}.");

    private static string? GetText(JsonElement element, string name) => TryGetProperty(element, name, out var value)
        ? value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null
        }
        : null;

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

    public void Dispose()
    {
        if (_ownsNetworkDiscovery) _networkDiscovery.Dispose();
    }
}
