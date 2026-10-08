using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed class ProductionJobMonitorService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly IReadOnlyDictionary<string, string> TerminalStates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["finish"] = "completed",
        ["finished"] = "completed",
        ["completed"] = "completed",
        ["complete"] = "completed",
        ["success"] = "completed",
        ["cancelled"] = "cancelled",
        ["canceled"] = "cancelled",
        ["failed"] = "failed",
        ["error"] = "failed",
        ["fault"] = "failed"
    };

    private readonly AgentCloudClient _cloudClient;
    private readonly AgentLocalOperationsStore _operationsStore;
    private readonly AgentPrinterConnectionManager _printers;
    private readonly AgentPrintFileCache _printFiles;
    private readonly Action<string>? _log;
    private readonly TimeSpan _pollInterval;
    private readonly TimeSpan _stablePollInterval;
    private readonly int _maxPolls;
    private readonly ConcurrentDictionary<string, TaskCompletionSource> _active = new(StringComparer.Ordinal);

    public ProductionJobMonitorService(AgentCloudClient cloudClient, AgentLocalOperationsStore operationsStore,
        AgentPrinterConnectionManager printers, AgentPrintFileCache printFiles, Action<string>? log = null,
        TimeSpan? pollInterval = null, TimeSpan? stablePollInterval = null, int? maxPolls = null)
    {
        _cloudClient = cloudClient ?? throw new ArgumentNullException(nameof(cloudClient));
        _operationsStore = operationsStore ?? throw new ArgumentNullException(nameof(operationsStore));
        _printers = printers ?? throw new ArgumentNullException(nameof(printers));
        _printFiles = printFiles ?? throw new ArgumentNullException(nameof(printFiles));
        _log = log;
        _pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(ReadPollMilliseconds("FILA_AGENT_PRINT_COMPLETION_POLL_MS", "PRINTFLOW_PRINT_COMPLETION_POLL_MS", 5_000));
        _stablePollInterval = stablePollInterval ?? TimeSpan.FromMilliseconds(Math.Max(_pollInterval.TotalMilliseconds,
            ReadPollMilliseconds("FILA_AGENT_PRINT_STABLE_POLL_MS", "PRINTFLOW_PRINT_STABLE_POLL_MS", 15_000)));
        _maxPolls = Math.Max(1, maxPolls ?? ReadMaxPolls(_pollInterval));
    }

    public int ActiveMonitorCount => _active.Count;

    public void StartPending(AgentCredentials credentials, CancellationToken cancellationToken = default)
    {
        foreach (var monitor in _operationsStore.ListPendingProductionJobMonitors())
            Start(credentials, monitor, cancellationToken);
    }

    public bool Start(AgentCredentials credentials, AgentProductionJobMonitor monitor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        ArgumentNullException.ThrowIfNull(monitor);
        var jobId = monitor.PrintJobId.Trim();
        if (jobId.Length == 0) return false;
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_active.TryAdd(jobId, completion)) return false;
        _ = RunTrackedAsync(credentials, monitor, cancellationToken, completion);
        return true;
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        var active = _active.Values.Select(completion => completion.Task).ToArray();
        if (active.Length > 0) await Task.WhenAll(active).WaitAsync(cancellationToken);
    }

    private async Task RunTrackedAsync(AgentCredentials credentials, AgentProductionJobMonitor monitor,
        CancellationToken cancellationToken, TaskCompletionSource completion)
    {
        try
        {
            await MonitorAsync(credentials, monitor, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            _log?.Invoke($"Monitor do Production Job {monitor.PrintJobId} permanece salvo para retomada: {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            _active.TryRemove(monitor.PrintJobId, out _);
            completion.TrySetResult();
        }
    }

    private async Task MonitorAsync(AgentCredentials credentials, AgentProductionJobMonitor monitor, CancellationToken cancellationToken)
    {
        var lastError = string.Empty;
        var nextDelay = _pollInterval;
        for (var poll = 0; poll < _maxPolls; poll++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                await _printers.EnsureConnectedAsync(credentials, monitor.Printer, cancellationToken);
                var status = JsonSerializer.SerializeToElement(
                    await _printers.GetStatusAsync(credentials, monitor.Printer, cancellationToken), JsonOptions);
                var terminal = NormalizeCompletionState(status);
                if (terminal is not null)
                {
                    await CompleteAsync(credentials, monitor, status, terminal, cancellationToken);
                    return;
                }

                lastError = string.Empty;
                nextDelay = GetNextPollDelay(status, _pollInterval, _stablePollInterval);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                lastError = error.Message;
                nextDelay = _pollInterval;
                _log?.Invoke($"Consulta de status do Production Job {monitor.PrintJobId} falhou: {error.GetType().Name}");
            }

            await Task.Delay(nextDelay, cancellationToken);
        }

        throw new TimeoutException($"Monitoramento do Production Job {monitor.PrintJobId} excedeu o limite de polling.{(lastError.Length == 0 ? string.Empty : " Ultimo erro: " + lastError)}");
    }

    private async Task CompleteAsync(AgentCredentials credentials, AgentProductionJobMonitor monitor,
        JsonElement status, string completionState, CancellationToken cancellationToken)
    {
        var payload = new
        {
            status = completionState,
            idempotencyKey = $"agent-{monitor.CommandId}-completion",
            attemptNo = 1,
            actualPrintSeconds = FindMetric(status, "actualPrintSeconds", "elapsedSeconds", "printSeconds", "print_time", "print_duration") ??
                Math.Max(0, (DateTimeOffset.UtcNow - monitor.StartedAt).TotalSeconds),
            actualFilamentGrams = FindMetric(status, "actualFilamentGrams", "filamentUsedGrams", "filament_used_g", "filament_used"),
            actualFilamentMillimeters = FindMetric(status, "actualFilamentMillimeters", "filamentUsedMillimeters", "filament_used_mm")
        };

        try
        {
            await _cloudClient.ReportPrintJobMetricsAsync(credentials, monitor.PrintJobId, payload, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            _operationsStore.QueueProductionMetric(monitor.PrintJobId, payload);
            _log?.Invoke($"Métrica final do Production Job {monitor.PrintJobId} enfileirada: {error.GetType().Name}");
        }

        await _printFiles.UnpinByPrintJobIdAsync(monitor.PrintJobId, cancellationToken);
        _operationsStore.AcknowledgeProductionJobMonitor(monitor.PrintJobId);
    }

    private static string? NormalizeCompletionState(JsonElement status)
    {
        var value = GetText(status, "state") ?? GetText(status, "status");
        return value is not null && TerminalStates.TryGetValue(value.Trim(), out var normalized) ? normalized : null;
    }

    private static TimeSpan GetNextPollDelay(JsonElement status, TimeSpan pollInterval, TimeSpan stablePollInterval)
    {
        var state = (GetText(status, "state") ?? GetText(status, "status") ?? string.Empty).Trim();
        var progress = GetNumber(status, "progress") ?? FindMetric(status, "progress");
        if (state.Equals("paused", StringComparison.OrdinalIgnoreCase) || state.Equals("pause", StringComparison.OrdinalIgnoreCase) ||
            state.Equals("pausing", StringComparison.OrdinalIgnoreCase) || state.Equals("resuming", StringComparison.OrdinalIgnoreCase) ||
            progress is >= 90)
            return pollInterval;
        if (state.Equals("printing", StringComparison.OrdinalIgnoreCase) || state.Equals("running", StringComparison.OrdinalIgnoreCase) ||
            state.Equals("prepare", StringComparison.OrdinalIgnoreCase) || state.Equals("preparing", StringComparison.OrdinalIgnoreCase))
            return stablePollInterval;
        return pollInterval;
    }

    private static double? FindMetric(JsonElement status, params string[] keys)
    {
        var sources = new List<JsonElement> { status };
        if (TryGetProperty(status, "raw", out var raw))
        {
            sources.Add(raw);
            foreach (var nested in new[] { "print", "job", "print_stats" })
                if (TryGetProperty(raw, nested, out var child)) sources.Add(child);
        }

        foreach (var source in sources)
            foreach (var key in keys)
                if (GetNumber(source, key) is { } number && number >= 0) return number;
        return null;
    }

    private static double? GetNumber(JsonElement element, string name)
    {
        if (!TryGetProperty(element, name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
        if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return number;
        return null;
    }

    private static string? GetText(JsonElement element, string name) =>
        TryGetProperty(element, name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool TryGetProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var property in element.EnumerateObject())
                if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
        value = default;
        return false;
    }

    private static int ReadPollMilliseconds(string primaryName, string legacyName, int fallback)
    {
        var value = Environment.GetEnvironmentVariable(primaryName) ?? Environment.GetEnvironmentVariable(legacyName);
        return int.TryParse(value, out var parsed) ? Math.Max(1_000, parsed) : fallback;
    }

    private static int ReadMaxPolls(TimeSpan pollInterval)
    {
        var value = Environment.GetEnvironmentVariable("FILA_AGENT_PRINT_COMPLETION_MAX_POLLS") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_PRINT_COMPLETION_MAX_POLLS");
        return int.TryParse(value, out var parsed) ? Math.Max(1, parsed) :
            Math.Max(1, (int)Math.Ceiling(TimeSpan.FromDays(30).TotalMilliseconds / pollInterval.TotalMilliseconds));
    }
}
