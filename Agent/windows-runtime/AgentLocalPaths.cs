namespace FilaAgent.Runtime;

public sealed record AgentLocalPaths(string Root, string Database, string CacheFiles, string CacheGcode, string Temp, string Logs, string Updates)
{
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
}
