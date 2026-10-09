using System.Net;

namespace FilaAgent.Runtime;

public sealed record AgentConfiguration(
    string Environment,
    Uri ApiUrl,
    Uri WebSocketUrl,
    IReadOnlyList<string> AppOrigins,
    int LocalPort,
    string DataDirectory,
    string LogDirectory,
    string Version)
{
    public TimeSpan HealthSnapshotInterval { get; init; } = TimeSpan.FromMinutes(1);
    public TimeSpan WebSocketCommandPollInterval { get; init; } = TimeSpan.FromSeconds(90);
    public TimeSpan SseCommandPollInterval { get; init; } = TimeSpan.FromSeconds(45);

    private const string ProductionApiUrl = "https://printflow-api-4y5l.onrender.com";
    private static readonly string[] ProductionOrigins = [
        "https://print-flow-d5si.vercel.app",
        "https://filamind.com.br",
        "https://www.filamind.com.br"
    ];

    public static AgentConfiguration FromEnvironment(
        IReadOnlyDictionary<string, string?>? values = null,
        string? version = null,
        string? appData = null,
        string? localAppData = null)
    {
        values ??= System.Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);

        string Get(string primary, string legacy, string fallback = "") =>
            FirstNonBlank(values.GetValueOrDefault(primary), values.GetValueOrDefault(legacy), fallback);

        var environment = Get("FILA_AGENT_ENVIRONMENT", "PRINTFLOW_ENVIRONMENT", "DEVELOPMENT").Trim().ToUpperInvariant();
        if (environment is not ("DEVELOPMENT" or "PRODUCTION"))
            throw new InvalidOperationException("FILA_AGENT_ENVIRONMENT deve ser DEVELOPMENT ou PRODUCTION.");

        var apiText = Get("FILA_AGENT_API_URL", "PRINTFLOW_API_URL",
            environment == "PRODUCTION" ? ProductionApiUrl : "http://localhost:3333");
        var apiUrl = ParseUri(apiText, "FILA_AGENT_API_URL");
        var wsText = Get("FILA_AGENT_WS_URL", "PRINTFLOW_WS_URL",
            environment == "PRODUCTION"
                ? new UriBuilder(apiUrl) { Scheme = "wss", Port = apiUrl.IsDefaultPort ? -1 : apiUrl.Port }.Uri.AbsoluteUri.TrimEnd('/')
                : "ws://localhost:3333");
        var wsUrl = ParseUri(wsText, "FILA_AGENT_WS_URL");

        var originText = Get("FILA_AGENT_APP_ORIGINS", "PRINTFLOW_APP_ORIGINS");
        var origins = originText.Length > 0
            ? originText.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            : environment == "PRODUCTION"
                ? ProductionOrigins
                : ["http://localhost:3000", "http://127.0.0.1:3000"];

        if (environment == "PRODUCTION")
        {
            ValidateProductionUri(apiUrl, "FILA_AGENT_API_URL", "https:");
            ValidateProductionUri(wsUrl, "FILA_AGENT_WS_URL", "wss:");
            foreach (var origin in origins) ValidateProductionUri(ParseUri(origin, "FILA_AGENT_APP_ORIGINS"), "FILA_AGENT_APP_ORIGINS", "https:");
            if (string.Equals(Get("FILA_AGENT_DEV_MOCK_BAMBU", "PRINTFLOW_DEV_MOCK_BAMBU"), "true", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("FILA_AGENT_DEV_MOCK_BAMBU nao pode ser usado em PRODUCTION.");
        }

        var appDataRoot = appData ?? System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData);
        var localAppDataRoot = localAppData ?? System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData);
        var dataDirectory = AgentLocalPaths.ResolveDataDirectory(values, appDataRoot);
        var logDirectory = Get("FILA_AGENT_LOG_DIR", "PRINTFLOW_AGENT_LOG_DIR",
            Path.Combine(localAppDataRoot, "FilaAgentSetup", "logs"));
        var portText = Get("FILA_AGENT_LOCAL_PORT", "PRINTFLOW_AGENT_LOCAL_PORT", "17873");
        if (!int.TryParse(portText, out var localPort) || localPort is < 0 or > 65535) localPort = 17873;
        var healthSnapshotInterval = ReadInterval(Get("FILA_AGENT_HEALTH_SNAPSHOT_MS", "PRINTFLOW_AGENT_HEALTH_SNAPSHOT_MS", "60000"), 60_000, 60_000);
        var webSocketPollInterval = ReadInterval(Get("FILA_AGENT_WS_POLL_MS", "PRINTFLOW_AGENT_WS_POLL_MS", "90000"), 90_000, 60_000);
        var ssePollInterval = ReadInterval(Get("FILA_AGENT_SSE_POLL_MS", "PRINTFLOW_AGENT_SSE_POLL_MS", "45000"), 45_000, 30_000);

        return new AgentConfiguration(environment, apiUrl, wsUrl, origins, localPort,
            Path.GetFullPath(dataDirectory), Path.GetFullPath(logDirectory), version ?? "0.1.28")
        {
            HealthSnapshotInterval = healthSnapshotInterval,
            WebSocketCommandPollInterval = webSocketPollInterval,
            SseCommandPollInterval = ssePollInterval
        };
    }

    private static TimeSpan ReadInterval(string value, int fallback, int minimum)
    {
        var milliseconds = int.TryParse(value, out var parsed) && parsed > 0 ? Math.Max(minimum, parsed) : fallback;
        return TimeSpan.FromMilliseconds(milliseconds);
    }

    private static string FirstNonBlank(params string?[] candidates) =>
        candidates.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    private static Uri ParseUri(string value, string name)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"{name} invalido.");
        return uri;
    }

    private static void ValidateProductionUri(Uri uri, string name, string scheme)
    {
        if (!string.Equals(uri.Scheme, scheme, StringComparison.OrdinalIgnoreCase) || IsLocalHost(uri.Host))
            throw new InvalidOperationException($"{name} inseguro para PRODUCTION.");
    }

    private static bool IsLocalHost(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
        IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
}
