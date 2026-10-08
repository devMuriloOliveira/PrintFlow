using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed class AgentDiagnosticsTokenStore : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IAgentDataProtector _protector;
    private bool _disposed;

    public AgentDiagnosticsTokenStore(string dataDirectory, IAgentDataProtector? protector = null)
    {
        var directory = Path.GetFullPath(dataDirectory);
        Directory.CreateDirectory(directory);
        FilePath = Path.Combine(directory, "diagnostics.token");
        _protector = protector ?? new WindowsDpapiDataProtector();
        Token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        try
        {
            var protectedValue = _protector.Protect(Encoding.UTF8.GetBytes(Token));
            var envelope = JsonSerializer.Serialize(new
            {
                version = 1,
                protection = "windows-dpapi",
                payload = Convert.ToBase64String(protectedValue)
            }, JsonOptions);
            WriteAtomically(FilePath, envelope + "\n");
        }
        catch (CryptographicException error) when (error.Message.Contains("user profile", StringComparison.OrdinalIgnoreCase))
        {
            Token = string.Empty;
            try { File.Delete(FilePath); } catch { }
        }
    }

    public string Token { get; }
    public string FilePath { get; }
    public bool IsAvailable => Token.Length > 0 && File.Exists(FilePath);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { File.Delete(FilePath); } catch { }
    }

    private static void WriteAtomically(string destination, string content)
    {
        var temporaryPath = destination + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(temporaryPath, content, new UTF8Encoding(false));
            File.Move(temporaryPath, destination, true);
        }
        finally
        {
            try { File.Delete(temporaryPath); } catch { }
        }
    }
}
