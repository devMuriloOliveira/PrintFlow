using System.Diagnostics;
using System.Runtime.InteropServices;

namespace FilaAgent.Runtime;

public sealed class AgentRuntimeComposition : IAsyncDisposable
{
    private static readonly object[] PrinterProfiles =
    [
        new { protocol = "bambu", label = "Bambu Lab", connectionType = "network", defaultPort = 8883,
            requiredPrinterFields = new[] { "ip", "serial" }, requiredOptionFields = new[] { "accessCode" },
            credentialOptionFields = new[] { "serial" }, secretOptionFields = new[] { "accessCode" },
            capabilities = new { status = true, pause = true, resume = true, cancel = true, disconnect = true, upload = true, startPrint = true } },
        new { protocol = "marlin", label = "USB / Marlin", connectionType = "usb", defaultBaudRate = 115200,
            requiredPrinterFields = new[] { "port" }, requiredOptionFields = Array.Empty<string>(),
            credentialOptionFields = Array.Empty<string>(), secretOptionFields = Array.Empty<string>(),
            capabilities = new { status = true, pause = true, resume = true, cancel = true, disconnect = true, upload = false, startPrint = true } },
        new { protocol = "octoprint", label = "OctoPrint", connectionType = "network", defaultPort = 80,
            requiredPrinterFields = new[] { "ip" }, requiredOptionFields = new[] { "apiKey" },
            credentialOptionFields = new[] { "apiKey" }, secretOptionFields = new[] { "apiKey" },
            capabilities = new { status = true, pause = true, resume = true, cancel = true, disconnect = true, upload = true, startPrint = true } },
        new { protocol = "moonraker", label = "Moonraker / Klipper", connectionType = "network", defaultPort = 7125,
            requiredPrinterFields = new[] { "ip" }, requiredOptionFields = Array.Empty<string>(),
            credentialOptionFields = new[] { "apiKey" }, secretOptionFields = new[] { "apiKey" },
            capabilities = new { status = true, pause = true, resume = true, cancel = true, disconnect = true, upload = true, startPrint = true } },
        new { protocol = "prusalink", label = "PrusaLink", connectionType = "network", defaultPort = 80,
            requiredPrinterFields = new[] { "ip" }, requiredOptionFields = new[] { "username", "password" },
            credentialOptionFields = new[] { "username", "password" }, secretOptionFields = new[] { "password" },
            capabilities = new { status = true, pause = true, resume = true, cancel = true, disconnect = true, upload = true, startPrint = true } }
    ];

    private static readonly object[] PrinterConnectionPresets =
    [
        new { id = "creality-ender-3-v3-se", label = "Creality Ender-3 V3 SE", protocol = "marlin", connectionType = "usb", baudRate = 115200 },
        new { id = "creality-ender-3-v3-ke", label = "Creality Ender-3 V3 KE", protocol = "moonraker", connectionType = "network", port = 7125 }
    ];

    private readonly AgentConfiguration _configuration;
    private readonly AgentLocalPaths _paths;
    private readonly AgentCredentialStore _credentials;
    private readonly AgentDiagnosticsTokenStore _diagnosticsToken;
    private readonly AgentPrinterCredentialStore _printerCredentials;
    private readonly AgentCloudClient _cloud;
    private readonly AgentLocalOperationsStore _operations;
    private readonly AgentPrinterConnectionManager _printers;
    private readonly AgentPrintFileCache _printFiles;
    private readonly ProductionJobMonitorService _productionJobMonitors;
    private readonly AgentPrinterCommandHandler _printerCommands;
    private readonly AgentRealtimeNotificationClient _realtime;
    private readonly AgentRuntimeStatusState _status;
    private readonly AgentLocalServer _localServer;
    private readonly AgentRuntimeLoop _runtime;
    private readonly Stopwatch _uptime = Stopwatch.StartNew();
    private DateTimeOffset _lastHealthSnapshotAt;
    private object? _lastHealthSnapshot;
    private bool _disposed;

    public AgentRuntimeComposition(AgentConfiguration configuration, Action<string>? log = null,
        IAgentDataProtector? dataProtector = null)
    {
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _paths = AgentLocalPaths.FromDataDirectory(configuration.DataDirectory);
        _paths.EnsureDirectories();

        var protector = dataProtector ?? new WindowsDpapiDataProtector();
        _credentials = new AgentCredentialStore(configuration.DataDirectory, protector);
        _diagnosticsToken = new AgentDiagnosticsTokenStore(configuration.DataDirectory, protector);
        _printerCredentials = new AgentPrinterCredentialStore(configuration.DataDirectory, protector);
        _cloud = new AgentCloudClient(configuration.ApiUrl);
        _operations = new AgentLocalOperationsStore(_paths.Database);
        _operations.RecoverInterruptedCommands();
        _printers = new AgentPrinterConnectionManager(_cloud, _printerCredentials);
        _printFiles = new AgentPrintFileCache(_cloud, _paths.CacheFiles, GetRuntimeEnvironment(configuration));
        _productionJobMonitors = new ProductionJobMonitorService(_cloud, _operations, _printers, _printFiles, log);
        _printerCommands = new AgentPrinterCommandHandler(_cloud, _operations, _printers, _printFiles,
            onPrintJobStarted: (credentials, monitor, token) => _productionJobMonitors.Start(credentials, monitor, token),
            log: log);

        var slicing = new ProductionJobSlicingService(_cloud, _printFiles, environment: GetRuntimeEnvironment(configuration));
        var slicingCommands = new ProductionJobSlicingCommandHandler(_cloud, _operations, slicing);
        var polling = new AgentCommandPollingService(_cloud, _operations, _printerCommands, slicingCommands, log: log);
        var startup = new AgentRuntimeStartupService(_cloud, _credentials, _printers,
            Environment.MachineName, "win32", GetArchitecture(), configuration.Version);

        _status = new AgentRuntimeStatusState();
        _localServer = new AgentLocalServer(configuration.LocalPort, configuration.AppOrigins, _credentials,
            () => _status.Snapshot, configuration.Version, _diagnosticsToken, GetDiagnosticsSnapshot);
        _realtime = new AgentRealtimeNotificationClient(configuration, log: log);
        _runtime = new AgentRuntimeLoop(startup, _credentials, _cloud, polling, _localServer, _status,
            CreateHeartbeat, log, productionJobMonitors: _productionJobMonitors, realtimeNotifications: _realtime,
            webSocketCommandPollInterval: configuration.WebSocketCommandPollInterval,
            sseCommandPollInterval: configuration.SseCommandPollInterval);
    }

    public Task RunAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return RunCoreAsync(cancellationToken);
    }

    private async Task RunCoreAsync(CancellationToken cancellationToken)
    {
        await _printFiles.CleanupAsync(cancellationToken: cancellationToken);
        await _runtime.RunAsync(cancellationToken);
    }

    private object CreateHeartbeat()
    {
        var health = GetHealthSnapshot();
        return new
        {
            version = _configuration.Version,
            machineName = Environment.MachineName,
            platform = "win32",
            architecture = GetArchitecture(),
            runtime = RuntimeInformation.FrameworkDescription,
            printerConnectionPresets = PrinterConnectionPresets,
            printerProfiles = PrinterProfiles,
            printers = _printers.ListConnectionStates(),
            runtimeHealth = health
        };
    }

    private object GetHealthSnapshot()
    {
        var now = DateTimeOffset.UtcNow;
        if (_lastHealthSnapshot is not null && now - _lastHealthSnapshotAt < _configuration.HealthSnapshotInterval) return _lastHealthSnapshot;

        var localStatus = _status.Snapshot;
        var counts = _operations.GetPendingCounts();
        var printerStates = _printers.ListConnectionStates();
        var cache = _printFiles.GetStats();
        var deadLetters = _operations.GetDeadLetterEventCount() + _operations.GetDeadLetterProductionMetricCount();
        _lastHealthSnapshot = new
        {
            status = !localStatus.CloudConnected ? "offline" : deadLetters > 0 || printerStates.Any(state => state.Status != "connected") ? "degraded" : "healthy",
            uptimeSeconds = Math.Max(0, (long)_uptime.Elapsed.TotalSeconds),
            realtimeMode = localStatus.RealtimeMode,
            backend = new { connected = localStatus.CloudConnected, latencyMs = (int?)null },
            sqlite = new { status = "open", schemaVersion = _operations.SchemaVersion },
            outbox = new { pending = counts.Total, deadLetter = deadLetters },
            cache = new { files = cache.Files, bytes = cache.Bytes, pinnedFiles = cache.PinnedFiles, temporaryFiles = cache.TemporaryFiles },
            printers = new { connected = printerStates.Count(state => state.Status == "connected"), degraded = 0, offline = printerStates.Count(state => state.Status != "connected") },
            metrics = Array.Empty<object>()
        };
        _lastHealthSnapshotAt = now;
        return _lastHealthSnapshot;
    }

    private object GetDiagnosticsSnapshot()
    {
        var localStatus = _status.Snapshot;
        var counts = _operations.GetPendingCounts();
        var printerStates = _printers.ListConnectionStates();
        var cache = _printFiles.GetStats();
        var deadLetterEvents = _operations.GetDeadLetterEventCount();
        var deadLetterMetrics = _operations.GetDeadLetterProductionMetricCount();
        return new
        {
            backend = new { connected = localStatus.CloudConnected },
            realtime = new { mode = localStatus.RealtimeMode },
            sqlite = new { status = "open", schemaVersion = _operations.SchemaVersion },
            cache = new { files = cache.Files, bytes = cache.Bytes, pinnedFiles = cache.PinnedFiles, temporaryFiles = cache.TemporaryFiles },
            outbox = new { pending = new { total = counts.Total }, deadLetterEvents, deadLetterProductionMetrics = deadLetterMetrics },
            printerHealth = new
            {
                connected = printerStates.Count(state => state.Status == "connected"),
                degraded = 0,
                offline = printerStates.Count(state => state.Status != "connected")
            }
        };
    }

    private static IReadOnlyDictionary<string, string?> GetRuntimeEnvironment(AgentConfiguration configuration)
    {
        var values = Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);
        values["FILA_AGENT_ENVIRONMENT"] = configuration.Environment;
        values["FILA_AGENT_API_URL"] = configuration.ApiUrl.AbsoluteUri;
        values["FILA_AGENT_WS_URL"] = configuration.WebSocketUrl.AbsoluteUri;
        values["FILA_AGENT_APP_ORIGINS"] = string.Join(',', configuration.AppOrigins);
        values["FILA_AGENT_LOCAL_PORT"] = configuration.LocalPort.ToString(System.Globalization.CultureInfo.InvariantCulture);
        values["FILA_AGENT_DATA_DIR"] = configuration.DataDirectory;
        values["FILA_AGENT_LOG_DIR"] = configuration.LogDirectory;
        return values;
    }

    private static string GetArchitecture() => RuntimeInformation.ProcessArchitecture switch
    {
        Architecture.X64 => "x64",
        Architecture.Arm64 => "arm64",
        Architecture.X86 => "ia32",
        _ => RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant()
    };

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _localServer.DisposeAsync();
        await _productionJobMonitors.StopAsync();
        _printerCommands.Dispose();
        await _printers.DisposeAsync();
        _printerCredentials.Dispose();
        _operations.Dispose();
        _realtime.Dispose();
        _cloud.Dispose();
    }
}
