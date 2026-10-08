using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;

namespace FilaAgent.Runtime;

public interface IAgentDataProtector
{
    byte[] Protect(byte[] plaintext);
    byte[] Unprotect(byte[] protectedData);
}

public sealed class WindowsDpapiDataProtector : IAgentDataProtector
{
    public byte[] Protect(byte[] plaintext) => ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);

    public byte[] Unprotect(byte[] protectedData)
    {
        try { return ProtectedData.Unprotect(protectedData, null, DataProtectionScope.CurrentUser); }
        catch (CryptographicException) { return ProtectedData.Unprotect(protectedData, null, DataProtectionScope.LocalMachine); }
    }
}

public sealed partial class AgentCredentialStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _dataDirectory;
    private readonly IAgentDataProtector _protector;

    public AgentCredentialStore(string dataDirectory, IAgentDataProtector? protector = null)
    {
        _dataDirectory = Path.GetFullPath(dataDirectory);
        _protector = protector ?? new WindowsDpapiDataProtector();
    }

    private string CredentialsPath => Path.Combine(_dataDirectory, "agent.json");
    private string PendingPairingPath => Path.Combine(_dataDirectory, "pending-pairing.json");

    public async Task<AgentCredentials?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(CredentialsPath)) return null;
        var stored = await File.ReadAllTextAsync(CredentialsPath, cancellationToken);
        using var document = JsonDocument.Parse(stored.TrimStart('\uFEFF'));
        var root = document.RootElement;
        byte[] plaintext;
        if (TryGetProtectionEnvelope(root, out var payload))
        {
            plaintext = _protector.Unprotect(Convert.FromBase64String(payload));
        }
        else
        {
            plaintext = Encoding.UTF8.GetBytes(stored);
        }

        var credentials = JsonSerializer.Deserialize<AgentCredentials>(plaintext, JsonOptions);
        if (credentials is not null && !TryGetProtectionEnvelope(root, out _) && OperatingSystem.IsWindows())
            await SaveAsync(credentials, cancellationToken);
        return credentials;
    }

    public async Task SaveAsync(AgentCredentials credentials, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_dataDirectory);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(credentials, JsonOptions);
        var protectedValue = _protector.Protect(plaintext);
        var envelope = JsonSerializer.Serialize(new
        {
            version = 2,
            protection = "windows-dpapi",
            payload = Convert.ToBase64String(protectedValue)
        }, JsonOptions);
        await WriteAtomicallyAsync(CredentialsPath, envelope, cancellationToken);
    }

    public Task ClearAsync(CancellationToken cancellationToken = default) => DeleteIfExistsAsync(CredentialsPath, cancellationToken);

    public async Task SavePendingPairingCodeAsync(string code, CancellationToken cancellationToken = default)
    {
        var normalized = code.Trim().ToUpperInvariant();
        if (!PairingCode().IsMatch(normalized)) throw new ArgumentException("Codigo de pareamento invalido.", nameof(code));
        Directory.CreateDirectory(_dataDirectory);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(new { code = normalized, createdAt = DateTimeOffset.UtcNow }, JsonOptions);
        var protectedValue = _protector.Protect(plaintext);
        var envelope = JsonSerializer.Serialize(new
        {
            version = 1,
            protection = "windows-dpapi",
            payload = Convert.ToBase64String(protectedValue)
        }, JsonOptions);
        await WriteAtomicallyAsync(PendingPairingPath, envelope, cancellationToken);
    }

    public async Task<string> ConsumePendingPairingCodeAsync(DateTimeOffset? now = null, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(PendingPairingPath)) return string.Empty;
        var stored = await File.ReadAllTextAsync(PendingPairingPath, cancellationToken);
        await DeleteIfExistsAsync(PendingPairingPath, cancellationToken);

        using var document = JsonDocument.Parse(stored.TrimStart('\uFEFF'));
        var root = document.RootElement;
        var plaintext = TryGetProtectionEnvelope(root, out var payload)
            ? _protector.Unprotect(Convert.FromBase64String(payload))
            : Encoding.UTF8.GetBytes(stored);
        using var data = JsonDocument.Parse(plaintext);
        var code = data.RootElement.TryGetProperty("code", out var codeElement) ? codeElement.GetString()?.Trim().ToUpperInvariant() ?? string.Empty : string.Empty;
        var createdAtText = data.RootElement.TryGetProperty("createdAt", out var createdAtElement) ? createdAtElement.GetString() : null;
        if (!DateTimeOffset.TryParse(createdAtText, out var createdAt)) return string.Empty;
        var age = (now ?? DateTimeOffset.UtcNow) - createdAt;
        if (age < TimeSpan.FromMinutes(-1) || age > TimeSpan.FromMinutes(10) || !PairingCode().IsMatch(code)) return string.Empty;
        return code;
    }

    private static bool TryGetProtectionEnvelope(JsonElement root, out string payload)
    {
        payload = string.Empty;
        return root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("protection", out var protection) && protection.GetString() == "windows-dpapi" &&
            root.TryGetProperty("payload", out var value) && (payload = value.GetString() ?? string.Empty).Length > 0;
    }

    private static async Task WriteAtomicallyAsync(string destination, string content, CancellationToken cancellationToken)
    {
        var temp = destination + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await File.WriteAllTextAsync(temp, content, new UTF8Encoding(false), cancellationToken);
            File.Move(temp, destination, true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    private static async Task DeleteIfExistsAsync(string path, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.Run(() => { if (File.Exists(path)) File.Delete(path); }, cancellationToken);
    }

    [GeneratedRegex("^[A-Z0-9-]{6,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex PairingCode();
}
