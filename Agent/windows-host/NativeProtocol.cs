using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FilaAgent.Runtime;

namespace FilaAgentHost;

internal static partial class NativeProtocol
{
    public static bool TryHandle(string[] args)
    {
        var protocolUrl = ReadArgument(args, "--protocol");
        if (string.IsNullOrWhiteSpace(protocolUrl)) return false;
        try
        {
            var code = TryParsePairingCode(protocolUrl);
            if (code is null) return true;
            var dataDirectory = ReadArgument(args, "--data-dir") ?? AgentLocalPaths.ResolveDataDirectory();
            SavePendingPairingCode(code, dataDirectory);
            if (!args.Contains("--no-start", StringComparer.OrdinalIgnoreCase)) StartScheduledAgent(ReadArgument(args, "--task-name") ?? "FilaAgent");
        }
        catch { }
        return true;
    }

    private static string? ReadArgument(string[] args, string name) => args
        .SkipWhile(value => !string.Equals(value, name, StringComparison.OrdinalIgnoreCase))
        .Skip(1)
        .FirstOrDefault();

    internal static string? TryParsePairingCode(string protocolUrl)
    {
        if (!Uri.TryCreate(protocolUrl, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Scheme, "fila-agent", StringComparison.OrdinalIgnoreCase)) return null;
        return ParsePairingCode(uri);
    }

    private static string ParsePairingCode(Uri uri)
    {
        var value = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .FirstOrDefault(pair => pair.Length == 2 && string.Equals(pair[0], "code", StringComparison.OrdinalIgnoreCase))?
            .ElementAtOrDefault(1);
        var code = Uri.UnescapeDataString(value ?? string.Empty).Trim().ToUpperInvariant();
        if (!PairingCodePattern().IsMatch(code)) throw new InvalidOperationException("Codigo de pareamento invalido.");
        return code;
    }

    private static void SavePendingPairingCode(string code, string root)
    {
        Directory.CreateDirectory(root);
        var plaintext = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { code, createdAt = DateTime.UtcNow.ToString("O") }));
        var payload = ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);
        File.WriteAllText(Path.Combine(root, "pending-pairing.json"), JsonSerializer.Serialize(new { version = 1, protection = "windows-dpapi", payload = Convert.ToBase64String(payload) }), new UTF8Encoding(false));
    }

    private static void StartScheduledAgent(string taskName)
    {
        try { Process.Start(new ProcessStartInfo("schtasks.exe") { UseShellExecute = false, CreateNoWindow = true, ArgumentList = { "/Run", "/TN", taskName } }); }
        catch { }
    }

    [GeneratedRegex("^[A-Z0-9-]{6,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex PairingCodePattern();
}
