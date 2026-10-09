namespace FilaAgent.Runtime;

public sealed record AgentLocalPaths(string Root, string Database, string CacheFiles, string CacheGcode, string Temp, string Logs, string Updates)
{
    public static string ResolveDataDirectory(
        IReadOnlyDictionary<string, string?>? values = null,
        string? appDataRoot = null)
    {
        values ??= Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);

        var configured = FirstNonBlank(values.GetValueOrDefault("FILA_AGENT_DATA_DIR"), values.GetValueOrDefault("PRINTFLOW_AGENT_DATA_DIR"));
        if (configured.Length > 0) return Path.GetFullPath(configured);

        var root = appDataRoot ?? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var legacy = Path.Combine(root, "PrintFlow Agent");
        return Path.GetFullPath(Directory.Exists(legacy) ? legacy : Path.Combine(root, "Fila Agent"));
    }

    public static AgentLocalPaths FromDataDirectory(string dataDirectory)
    {
        var root = Path.GetFullPath(dataDirectory);
        return new AgentLocalPaths(root,
            Path.Combine(root, "agent-operations.sqlite"),
            Path.Combine(root, "cache", "files"),
            Path.Combine(root, "cache", "gcode"),
            Path.Combine(root, "temp"),
            Path.Combine(root, "logs"),
            Path.Combine(root, "updates"));
    }

    public void EnsureDirectories()
    {
        foreach (var directory in new[] { Root, Path.GetDirectoryName(Database)!, CacheFiles, CacheGcode, Temp, Logs, Updates })
            Directory.CreateDirectory(directory);
    }

    private static string FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}
