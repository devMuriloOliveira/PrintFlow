using System.Diagnostics;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using FilaAgent.Runtime;

namespace FilaAgent.Setup;

internal sealed class SignedUpdateService
{
    private const string ReleaseApi = "https://api.github.com/repos/devMuriloOliveira/PrintFlow/releases/latest";
    private const string TrustedCertificateSha256 = "AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB";
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly Uri _releaseApi;
    private readonly string? _testAuthority;
    private readonly bool _testMode;
    private readonly string _dataDirectory;
    private readonly string? _testDataDirectory;
    private readonly string? _testApiUrl;
    private readonly string? _testTaskName;
    private readonly string _healthUrl;

    public SignedUpdateService(string? testReleaseApi = null, bool testMode = false, string? testDataDirectory = null,
        string? testApiUrl = null, string? testTaskName = null, string? localPort = null)
    {
        _testMode = testMode;
        if (testReleaseApi is null)
        {
            if (testMode) throw new InvalidDataException("Atualização em modo de teste exige uma API de release local.");
            _releaseApi = new Uri(ReleaseApi);
        }
        else
        {
            if (!testMode || !Uri.TryCreate(testReleaseApi, UriKind.Absolute, out var testUri) ||
                testUri.Scheme != Uri.UriSchemeHttp || !testUri.IsLoopback)
                throw new InvalidDataException("Endpoint local de teste permitido somente com --test-mode e loopback HTTP.");
            _releaseApi = testUri;
            _testAuthority = testUri.GetLeftPart(UriPartial.Authority);
        }

        if (testMode)
        {
            if (string.IsNullOrWhiteSpace(testDataDirectory) ||
                !Uri.TryCreate(testApiUrl, UriKind.Absolute, out var testApi) ||
                testApi.Scheme != Uri.UriSchemeHttp || !testApi.IsLoopback ||
                string.IsNullOrWhiteSpace(testTaskName) || !testTaskName.StartsWith("FilaAgent_E2E_", StringComparison.OrdinalIgnoreCase) ||
                !int.TryParse(localPort, out var testPort) || testPort is < 1 or > 65535)
                throw new InvalidDataException("Atualização de teste exige diretório, API, porta e tarefa E2E isolados.");
            _testDataDirectory = Path.GetFullPath(testDataDirectory);
            _testApiUrl = testApiUrl;
            _testTaskName = testTaskName;
            _healthUrl = $"http://127.0.0.1:{testPort}/healthz";
            _dataDirectory = _testDataDirectory;
        }
        else
        {
            _healthUrl = "http://127.0.0.1:17873/healthz";
            _dataDirectory = AgentLocalPaths.ResolveDataDirectory();
        }
    }

    public async Task<bool> CheckAndInstallAsync(string installRoot, bool interactive, bool confirmUpdates, CancellationToken cancellationToken = default)
    {
        var health = await GetHealthAsync(cancellationToken);
        if (health is null || health.UpdateBlocked || !health.CloudConnected)
        {
            WriteHistory(VersionAt(installRoot), "", "deferred", health?.UpdateBlockedReason ?? "health_unavailable");
            return false;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, _releaseApi);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Fila-Agent-Updater", VersionAt(installRoot)));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var release = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        var root = release.RootElement;
        var tag = root.GetProperty("tag_name").GetString() ?? "";
        if (!tag.StartsWith("agent-v", StringComparison.Ordinal) || !Version.TryParse(tag[7..], out var latest)) throw new InvalidDataException("Release do Agent invalida.");

        var currentVersion = VersionAt(installRoot);
        if (!Version.TryParse(currentVersion, out var current)) throw new InvalidDataException("Versao instalada invalida.");
        if (latest <= current)
        {
            if (interactive) MessageBox.Show($"Você já está usando a versão mais recente do Fila Agent ({current}).", "Fila Agent", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return false;
        }

        if ((interactive || confirmUpdates) && MessageBox.Show($"Nova versão do Fila Agent disponível: {latest}\nVersão atual: {current}\n\nDeseja baixar e instalar agora? O instalador mostrará os termos e pedirá confirmação antes de substituir a versão atual.", "Fila Agent", MessageBoxButtons.YesNo, MessageBoxIcon.Information, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
        {
            WriteHistory(currentVersion, latest.ToString(), "declined", "user_declined");
            return false;
        }

        var assets = root.GetProperty("assets").EnumerateArray().ToDictionary(
            asset => asset.GetProperty("name").GetString() ?? "",
            asset => asset.GetProperty("browser_download_url").GetString() ?? "",
            StringComparer.OrdinalIgnoreCase);
        string setupName;
        string certificateName;
        if (assets.ContainsKey("Fila-Agent-Setup.exe") && assets.ContainsKey("Fila-Agent-Dev-Certificate.cer"))
        {
            setupName = "Fila-Agent-Setup.exe";
            certificateName = "Fila-Agent-Dev-Certificate.cer";
        }
        else if (assets.ContainsKey("PrintFlow-Agent-Setup.exe") && assets.ContainsKey("PrintFlow-Agent-Dev-Certificate.cer"))
        {
            setupName = "PrintFlow-Agent-Setup.exe";
            certificateName = "PrintFlow-Agent-Dev-Certificate.cer";
        }
        else throw new InvalidDataException("Release incompleta: falta um par de instalador e certificado do Fila Agent.");
        var required = new[] { setupName, certificateName, "RELEASE-METADATA.json", "SHA256SUMS.txt" };
        if (required.Any(name => !assets.ContainsKey(name))) throw new InvalidDataException("Release incompleta: falta um artefato obrigatorio.");

        var updatesRoot = Path.Combine(_dataDirectory, "updates", latest.ToString());
        Directory.CreateDirectory(updatesRoot);
        var updated = await RunWithProgressAsync($"Preparando a versão {latest} do Fila Agent...", async progress =>
        {
            for (var index = 0; index < required.Length; index++)
            {
                var name = required[index];
                progress.SetStatus($"Baixando arquivo {index + 1} de {required.Length}:\r\n{name}");
                await DownloadAsync(assets[name], Path.Combine(updatesRoot, name), cancellationToken);
            }

            progress.SetStatus("Validando assinatura, certificado e arquivos baixados...");
            ValidatePackage(updatesRoot, latest.ToString(), setupName, certificateName);

            WriteHistory(currentVersion, latest.ToString(), "started", "verified_signed_release");
            var installer = Path.Combine(updatesRoot, setupName);
            progress.SetStatus("Abrindo o instalador. Confirme os termos para continuar a atualização.");
            // Keep the modal message loop alive until the child installer and post-update health check finish.
            var installerStartInfo = new ProcessStartInfo(installer) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = updatesRoot };
            if (_testMode)
            {
                installerStartInfo.ArgumentList.Add("--test-mode");
                installerStartInfo.ArgumentList.Add("--install-dir");
                installerStartInfo.ArgumentList.Add(installRoot);
                installerStartInfo.ArgumentList.Add("--test-data-dir");
                installerStartInfo.ArgumentList.Add(_testDataDirectory!);
                installerStartInfo.ArgumentList.Add("--api-url");
                installerStartInfo.ArgumentList.Add(_testApiUrl!);
                installerStartInfo.ArgumentList.Add("--local-port");
                installerStartInfo.ArgumentList.Add(new Uri(_healthUrl).Port.ToString(System.Globalization.CultureInfo.InvariantCulture));
                installerStartInfo.ArgumentList.Add("--task-name");
                installerStartInfo.ArgumentList.Add(_testTaskName!);
            }
            using var process = Process.Start(installerStartInfo)
                ?? throw new InvalidOperationException("Nao foi possivel iniciar o instalador assinado.");
            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0) throw new InvalidOperationException($"Instalador retornou {process.ExitCode}.");
            if (!string.Equals(VersionAt(installRoot), latest.ToString(), StringComparison.Ordinal))
            {
                WriteHistory(currentVersion, latest.ToString(), "declined", "installer_cancelled_or_closed");
                return false;
            }

            progress.SetStatus("Instalação concluída. Verificando pareamento e conexão com a nuvem...");
            var healthy = await WaitForHealthAsync(latest.ToString(), requirePaired: true, TimeSpan.FromSeconds(90), cancellationToken);
            if (!healthy) throw new InvalidOperationException("Nova versao nao confirmou health, pareamento e Cloud depois de iniciar.");
            WriteHistory(currentVersion, latest.ToString(), "succeeded", "health_verified");
            return true;
        });
        if (!updated && interactive)
            MessageBox.Show($"A atualização não foi aplicada. O Fila Agent continua na versão {current}.", "Atualização cancelada", MessageBoxButtons.OK, MessageBoxIcon.Information);
        return updated;
    }

    private static Task<T> RunWithProgressAsync<T>(string initialStatus, Func<UpdateProgressForm, Task<T>> operation)
    {
        T? result = default;
        Exception? failure = null;
        using var progress = new UpdateProgressForm(initialStatus);
        progress.Shown += async (_, _) =>
        {
            try { result = await operation(progress); }
            catch (Exception error) { failure = error; }
            finally { progress.Close(); }
        };
        progress.ShowDialog();
        if (failure is not null) ExceptionDispatchInfo.Capture(failure).Throw();
        return Task.FromResult(result!);
    }

    private sealed class UpdateProgressForm : Form
    {
        private readonly Label _status = new();

        public UpdateProgressForm(string initialStatus)
        {
            Text = "Atualização do Fila Agent";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            ControlBox = false;
            ShowInTaskbar = true;
            ClientSize = new Size(470, 132);
            Font = new Font("Segoe UI", 9F);
            _status.Text = initialStatus;
            _status.Location = new Point(18, 18);
            _status.Size = new Size(434, 46);
            var progress = new ProgressBar
            {
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 24,
                Location = new Point(18, 82),
                Size = new Size(434, 20)
            };
            Controls.AddRange([_status, progress]);
        }

        public void SetStatus(string message) => _status.Text = message;
    }

    private async Task DownloadAsync(string url, string destination, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (_testAuthority is null && uri.Scheme != Uri.UriSchemeHttps) ||
            (_testAuthority is not null && (uri.Scheme != Uri.UriSchemeHttp || !uri.IsLoopback || uri.GetLeftPart(UriPartial.Authority) != _testAuthority)))
            throw new InvalidDataException("URL de artefato insegura.");
        using var response = await _http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var target = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        await source.CopyToAsync(target, cancellationToken);
    }

    private static void ValidatePackage(string directory, string expectedVersion, string installerName, string certificateName)
    {
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "RELEASE-METADATA.json")));
        var metadata = manifest.RootElement;
        if (metadata.GetProperty("version").GetString() != expectedVersion) throw new InvalidDataException("Versao do manifesto diverge da tag.");
        if (metadata.GetProperty("signingMode").GetString() is not ("DEV_SELF_SIGNED" or "PRODUCTION_TRUSTED")) throw new InvalidDataException("Modo de assinatura invalido.");
        if (!Version.TryParse(metadata.GetProperty("minimumSupportedVersion").GetString(), out _)) throw new InvalidDataException("Versao minima invalida.");
        if (metadata.GetProperty("runtime").GetString() != ".NET 8 self-contained" ||
            !metadata.GetProperty("selfContained").GetBoolean())
            throw new InvalidDataException("Release sem runtime C# .NET 8 autocontido.");

        var hashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in File.ReadLines(Path.Combine(directory, "SHA256SUMS.txt")))
        {
            var split = line.Trim().Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries);
            if (split.Length != 2 || split[0].Length != 64 || !split[0].All(Uri.IsHexDigit)) throw new InvalidDataException("SHA256SUMS invalido.");
            hashes[Path.GetFileName(split[1])] = split[0].ToUpperInvariant();
        }

        foreach (var name in new[] { installerName, certificateName, "RELEASE-METADATA.json" })
        {
            var path = Path.Combine(directory, name);
            if (!hashes.TryGetValue(name, out var expected)) throw new InvalidDataException($"Hash ausente: {name}");
            var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual), Convert.FromHexString(expected))) throw new InvalidDataException($"Hash divergente: {name}");
        }

        var certificatePath = Path.Combine(directory, certificateName);
        var certificateFileHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(certificatePath)));
        var pinnedCertificate = X509Certificate2.CreateFromCertFile(certificatePath);
        var installerPath = Path.Combine(directory, installerName);
        var signer = X509Certificate.CreateFromSignedFile(installerPath);
        var signerHash = Convert.ToHexString(SHA256.HashData(signer.GetRawCertData()));
        if (!string.Equals(certificateFileHash, TrustedCertificateSha256, StringComparison.OrdinalIgnoreCase)) throw new CryptographicException("Certificado nao corresponde ao pin confiavel do Agent.");
        if (!string.Equals(signerHash, certificateFileHash, StringComparison.OrdinalIgnoreCase)) throw new CryptographicException("Assinante nao corresponde ao certificado publicado.");
        if (!string.Equals(metadata.GetProperty("certificateSha256").GetString(), certificateFileHash, StringComparison.OrdinalIgnoreCase)) throw new CryptographicException("Manifesto e certificado divergem.");
        if (!AuthenticodeTrust.Verify(installerPath)) throw new CryptographicException("Windows nao confia na assinatura Authenticode deste instalador.");
        _ = pinnedCertificate;
    }

    private async Task<AgentHealth?> GetHealthAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            return await http.GetFromJsonAsync<AgentHealth>(_healthUrl, cancellationToken);
        }
        catch { return null; }
    }

    private async Task<bool> WaitForHealthAsync(string expectedVersion, bool requirePaired, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var health = await GetHealthAsync(cancellationToken);
            if (health is { Ok: true } && health.Version == expectedVersion && (!requirePaired || (health.Paired && health.CloudConnected))) return true;
            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
        }
        return false;
    }

    private static string VersionAt(string root)
    {
        try { using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "package.json"))); return json.RootElement.GetProperty("version").GetString() ?? "0.0.0"; }
        catch { return "0.0.0"; }
    }

    private void WriteHistory(string previous, string next, string result, string detail)
    {
        var path = Path.Combine(_dataDirectory, "updates", "update-history.jsonl");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var item = JsonSerializer.Serialize(new { occurredAt = DateTime.UtcNow.ToString("O"), previousVersion = previous, newVersion = next, result, detail });
        File.AppendAllText(path, item + Environment.NewLine);
    }

    private sealed record AgentHealth(bool Ok, string? Version, bool Paired, bool CloudConnected, bool UpdateBlocked, string? UpdateBlockedReason);
}

internal static class AuthenticodeTrust
{
    private static readonly Guid Policy = new("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
    public static bool Verify(string path)
    {
        using var file = new WinTrustFileInfo(path);
        var data = new WinTrustData(file);
        var policy = Policy;
        return WinVerifyTrust(IntPtr.Zero, ref policy, data) == 0;
    }

    [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
    private static extern uint WinVerifyTrust(IntPtr hwnd, [In] ref Guid actionId, WinTrustData data);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustFileInfo : IDisposable
    {
        public uint Size = (uint)Marshal.SizeOf<WinTrustFileInfo>();
        public IntPtr FilePath;
        public IntPtr FileHandle;
        public IntPtr KnownSubject;
        public WinTrustFileInfo(string path) => FilePath = Marshal.StringToCoTaskMemUni(path);
        public void Dispose() { if (FilePath != IntPtr.Zero) Marshal.FreeCoTaskMem(FilePath); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustData
    {
        public uint Size = (uint)Marshal.SizeOf<WinTrustData>();
        public IntPtr PolicyCallbackData;
        public IntPtr SipClientData;
        public uint UiChoice = 2;
        public uint RevocationChecks = 0;
        public uint UnionChoice = 1;
        public IntPtr FileInfo;
        public uint StateAction = 0;
        public IntPtr StateData;
        public IntPtr UrlReference;
        public uint ProviderFlags = 0x00001000;
        public uint UiContext = 0;
        public WinTrustData(WinTrustFileInfo file) => FileInfo = Marshal.AllocHGlobal(Marshal.SizeOf<WinTrustFileInfo>()).Also(pointer => Marshal.StructureToPtr(file, pointer, false));
    }
}

internal static class MarshalExtensions
{
    public static T Also<T>(this T value, Action<T> action) { action(value); return value; }
}
