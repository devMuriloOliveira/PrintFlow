using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Org.BouncyCastle.Crypto.Generators;

namespace FilaAgent.Runtime;

public sealed record PrinterCredentialIdentity(string Protocol, string? Ip = null, int? Port = null, string? Serial = null, string? PortName = null);
public sealed record PrinterCredentialUserContext(string HostName, string UserName, string UserProfile);

public sealed class AgentPrinterCredentialStore : IDisposable
{
    private const int ScryptCost = 16_384;
    private const int ScryptBlockSize = 8;
    private const int ScryptParallelism = 1;
    private const string LegacyKeyLabel = "printflow-agent-printer-credentials";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly string _filePath;
    private readonly IAgentDataProtector _protector;
    private readonly PrinterCredentialUserContext _userContext;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    public AgentPrinterCredentialStore(string dataDirectory, IAgentDataProtector? protector = null,
        PrinterCredentialUserContext? userContext = null)
    {
        if (string.IsNullOrWhiteSpace(dataDirectory)) throw new ArgumentException("Diretorio de dados obrigatorio.", nameof(dataDirectory));
        _filePath = Path.Combine(Path.GetFullPath(dataDirectory), "printer-credentials.json");
        _protector = protector ?? new WindowsDpapiDataProtector();
        _userContext = userContext ?? new PrinterCredentialUserContext(
            Environment.MachineName,
            Environment.UserName,
            Environment.GetEnvironmentVariable("USERPROFILE") ?? Environment.GetEnvironmentVariable("HOME") ?? string.Empty);
    }

    public string FilePath => _filePath;

    public async Task<IReadOnlyDictionary<string, string?>> LoadAsync(PrinterCredentialIdentity printer,
        CancellationToken cancellationToken = default)
    {
        var key = GetPrinterCredentialKey(printer);
        if (key is null) return new Dictionary<string, string?>();
        await _gate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            if (!File.Exists(_filePath)) return new Dictionary<string, string?>();
            var store = await ReadStoreAsync(cancellationToken);
            if (!store.Printers.TryGetValue(key, out var entry)) return new Dictionary<string, string?>();
            return Decrypt(entry.Encrypted, store.Salt, GetCredentialFields(printer.Protocol));
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> SaveAsync(PrinterCredentialIdentity printer, IReadOnlyDictionary<string, string?> options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        var key = GetPrinterCredentialKey(printer, options);
        if (key is null) return false;
        var fields = GetCredentialFields(printer.Protocol);
        var selected = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            if (!options.TryGetValue(field, out var value) || string.IsNullOrWhiteSpace(value)) continue;
            selected[field] = value.Trim();
        }
        if (selected.Count == 0) return false;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            var store = File.Exists(_filePath)
                ? await ReadStoreAsync(cancellationToken)
                : CreateEmptyStore();
            store.Printers[key] = new StoredCredential(printer.Protocol.Trim().ToLowerInvariant(),
                DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture),
                Encrypt(selected, store.Salt));
            await WriteStoreAsync(store, cancellationToken);
            return true;
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> ClearAsync(PrinterCredentialIdentity printer, CancellationToken cancellationToken = default)
    {
        var key = GetPrinterCredentialKey(printer);
        if (key is null) return false;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            if (!File.Exists(_filePath)) return false;
            var store = await ReadStoreAsync(cancellationToken);
            if (!store.Printers.Remove(key)) return false;
            await WriteStoreAsync(store, cancellationToken);
            return true;
        }
        finally { _gate.Release(); }
    }

    public static string? GetPrinterCredentialKey(PrinterCredentialIdentity printer,
        IReadOnlyDictionary<string, string?>? options = null)
    {
        ArgumentNullException.ThrowIfNull(printer);
        var protocol = Normalize(printer.Protocol).ToLowerInvariant();
        if (protocol == "bambu")
        {
            var serial = Normalize(printer.Serial);
            if (serial.Length == 0 && options?.TryGetValue("serial", out var optionSerial) == true) serial = Normalize(optionSerial);
            return serial.Length == 0 ? null : $"bambu:{serial}";
        }

        if (protocol == "marlin")
        {
            var port = Normalize(printer.PortName);
            return port.Length == 0 ? null : $"marlin:{port}";
        }

        var defaultPort = protocol switch
        {
            "octoprint" or "prusalink" => 80,
            "moonraker" => 7125,
            _ => throw new NotSupportedException($"Protocolo de impressora sem credenciais suportadas: {protocol}.")
        };
        var ip = Normalize(printer.Ip);
        if (ip.Length == 0) return null;
        var networkPort = printer.Port is > 0 ? printer.Port.Value : defaultPort;
        return $"{protocol}:{ip}:{networkPort.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _gate.Dispose();
    }

    private IReadOnlyDictionary<string, string?> Decrypt(EncryptedCredential encrypted, string salt, IReadOnlyList<string> fields)
    {
        var key = DeriveKey(salt);
        var nonce = Convert.FromBase64String(encrypted.Iv);
        var tag = Convert.FromBase64String(encrypted.Tag);
        var ciphertext = Convert.FromBase64String(encrypted.Value);
        var plaintext = new byte[ciphertext.Length];
        try
        {
            using var aes = new AesGcm(key, tag.Length);
            aes.Decrypt(nonce, ciphertext, tag, plaintext);
            using var document = JsonDocument.Parse(plaintext);
            var values = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var field in fields)
            {
                if (!TryGetProperty(document.RootElement, field, out var value)) continue;
                var text = value.ValueKind switch
                {
                    JsonValueKind.String => value.GetString(),
                    JsonValueKind.Number => value.GetRawText(),
                    _ => null
                };
                if (!string.IsNullOrWhiteSpace(text)) values[field] = text;
            }
            return values;
        }
        catch (Exception error) when (error is CryptographicException or JsonException or FormatException or ArgumentException)
        {
            throw new InvalidDataException("Credenciais locais da impressora nao puderam ser lidas; arquivo preservado.", error);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private EncryptedCredential Encrypt(IReadOnlyDictionary<string, string> values, string salt)
    {
        var key = DeriveKey(salt);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(values, JsonOptions);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        try
        {
            using var aes = new AesGcm(key, tag.Length);
            aes.Encrypt(nonce, plaintext, ciphertext, tag);
            return new EncryptedCredential(Convert.ToBase64String(nonce), Convert.ToBase64String(tag), Convert.ToBase64String(ciphertext));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private byte[] DeriveKey(string salt)
    {
        var password = Encoding.UTF8.GetBytes(string.Join('|', _userContext.HostName, _userContext.UserName, _userContext.UserProfile, LegacyKeyLabel));
        var saltBytes = Encoding.UTF8.GetBytes(salt);
        try { return SCrypt.Generate(password, saltBytes, ScryptCost, ScryptBlockSize, ScryptParallelism, 32); }
        finally
        {
            CryptographicOperations.ZeroMemory(password);
            CryptographicOperations.ZeroMemory(saltBytes);
        }
    }

    private async Task<CredentialStore> ReadStoreAsync(CancellationToken cancellationToken)
    {
        var fileBytes = await File.ReadAllBytesAsync(_filePath, cancellationToken);
        byte[] storeBytes = fileBytes;
        try
        {
            using var outer = JsonDocument.Parse(fileBytes);
            if (TryGetProperty(outer.RootElement, "protection", out var protection) &&
                protection.ValueKind == JsonValueKind.String && protection.GetString() == "windows-dpapi")
            {
                if (!TryGetProperty(outer.RootElement, "payload", out var payload) || payload.ValueKind != JsonValueKind.String)
                    throw new InvalidDataException("Envelope DPAPI de credenciais de impressora esta incompleto.");
                storeBytes = _protector.Unprotect(Convert.FromBase64String(payload.GetString()!));
            }

            var store = JsonSerializer.Deserialize<CredentialStore>(storeBytes, JsonOptions)
                ?? throw new InvalidDataException("Arquivo de credenciais de impressora vazio.");
            if (string.IsNullOrWhiteSpace(store.Salt) || store.Printers is null)
                throw new InvalidDataException("Arquivo de credenciais de impressora incompleto.");
            return store;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Arquivo de credenciais de impressora invalido; arquivo preservado.", error);
        }
        finally
        {
            if (!ReferenceEquals(storeBytes, fileBytes)) CryptographicOperations.ZeroMemory(storeBytes);
        }
    }

    private async Task WriteStoreAsync(CredentialStore store, CancellationToken cancellationToken)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(store, JsonOptions);
        var protectedValue = _protector.Protect(plaintext);
        var envelope = JsonSerializer.SerializeToUtf8Bytes(new
        {
            version = 2,
            protection = "windows-dpapi",
            payload = Convert.ToBase64String(protectedValue)
        }, JsonOptions);
        var temporaryPath = _filePath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
            await File.WriteAllBytesAsync(temporaryPath, envelope, cancellationToken);
            File.Move(temporaryPath, _filePath, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            CryptographicOperations.ZeroMemory(protectedValue);
            CryptographicOperations.ZeroMemory(envelope);
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private CredentialStore CreateEmptyStore() => new()
    {
        Version = 1,
        Salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)),
        Printers = new Dictionary<string, StoredCredential>(StringComparer.Ordinal)
    };

    private static IReadOnlyList<string> GetCredentialFields(string protocol) => Normalize(protocol).ToLowerInvariant() switch
    {
        "bambu" => ["accessCode", "serial"],
        "octoprint" => ["apiKey"],
        "moonraker" => ["apiKey"],
        "prusalink" => ["username", "password"],
        "marlin" => [],
        _ => throw new NotSupportedException($"Protocolo de impressora sem credenciais suportadas: {protocol}.")
    };

    private static bool TryGetProperty(JsonElement element, string propertyName, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name.Equals(propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    private static string Normalize(string? value) => value?.Trim() ?? string.Empty;
    private void ThrowIfDisposed() { if (_disposed) throw new ObjectDisposedException(nameof(AgentPrinterCredentialStore)); }

    private sealed class CredentialStore
    {
        public int Version { get; set; }
        public string Salt { get; set; } = string.Empty;
        public Dictionary<string, StoredCredential> Printers { get; set; } = new(StringComparer.Ordinal);
    }

    private sealed record StoredCredential(string Protocol, string UpdatedAt, EncryptedCredential Encrypted);
    private sealed record EncryptedCredential(string Iv, string Tag, string Value);
}
