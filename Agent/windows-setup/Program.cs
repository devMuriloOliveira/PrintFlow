using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

namespace PrintFlowAgentSetup;

internal static class Program
{
    private const string TermsVersion = "1.0";
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var testMode = args.Contains("--test-mode", StringComparer.OrdinalIgnoreCase);
        try
        {
            var installRoot = ReadArgument(args, "--install-dir") ?? DefaultInstallRoot;
            var taskName = ReadArgument(args, "--task-name") ?? "PrintFlowAgent";
            var localPort = ReadArgument(args, "--local-port") ?? "17873";
            var testDataDirectory = testMode ? ReadArgument(args, "--test-data-dir") ?? Path.Combine(installRoot, "test-data") : null;
            if (!testMode && args.Contains("--install-package", StringComparer.OrdinalIgnoreCase) && !args.Contains("--consent-accepted", StringComparer.OrdinalIgnoreCase))
            {
                var packagePath = ReadArgument(args, "--install-package");
                var targetVersion = GetPackageVersionFromZip(packagePath);
                if (!SetupConsentForm.ShowInstall(targetVersion, GetInstalledVersion(installRoot), ReadTerms(), HasAcceptedTerms())) return 0;
                args = [.. args, "--consent-accepted"];
            }
            if (!testMode && args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase) && !args.Contains("--uninstall-confirmed", StringComparer.OrdinalIgnoreCase))
            {
                var removeUserData = false;
                if (!SetupConsentForm.ShowUninstall(GetInstalledVersion(installRoot), out removeUserData)) return 0;
                args = removeUserData ? [.. args, "--remove-user-data", "--uninstall-confirmed"] : [.. args, "--uninstall-confirmed"];
            }
            var elevatedExitCode = RelaunchElevatedWhenRequired(args);
            if (elevatedExitCode.HasValue) return elevatedExitCode.Value;
            if (args.Contains("--check-updates", StringComparer.OrdinalIgnoreCase))
                return new SignedUpdateService(ReadArgument(args, "--test-release-api"), testMode).CheckAndInstallAsync(installRoot, args.Contains("--interactive", StringComparer.OrdinalIgnoreCase), args.Contains("--confirm-updates", StringComparer.OrdinalIgnoreCase)).GetAwaiter().GetResult() ? 0 : 0;
            if (args.Contains("--finalize-uninstall", StringComparer.OrdinalIgnoreCase))
            {
                DeleteDirectory(ReadArgument(args, "--install-dir") ?? DefaultInstallRoot);
                if (!testMode && args.Contains("--remove-user-data", StringComparer.OrdinalIgnoreCase)) DeleteDirectory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrintFlow Agent"));
                try { File.Delete(Environment.ProcessPath!); } catch { }
                return 0;
            }
            if (args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase)) return Uninstall(installRoot, taskName, args.Contains("--remove-user-data", StringComparer.OrdinalIgnoreCase), testMode);
            var zip = ReadArgument(args, "--install-package");
            if (!string.IsNullOrWhiteSpace(zip) && !Path.IsPathRooted(zip)) zip = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, zip));
            if (string.IsNullOrWhiteSpace(zip)) return ShowUsage();
            return Install(zip, ReadArgument(args, "--api-url") ?? "https://printflow-api-4y5l.onrender.com", installRoot, taskName, localPort, testMode, testDataDirectory, args.Contains("--test-fail-after-copy", StringComparer.OrdinalIgnoreCase), args.Contains("--consent-accepted", StringComparer.OrdinalIgnoreCase));
        }
        catch (Exception error)
        {
            if (testMode || args.Contains("--quiet", StringComparer.OrdinalIgnoreCase))
            {
                var logDirectory = testMode
                    ? ReadArgument(args, "--test-data-dir") ?? Path.Combine(ReadArgument(args, "--install-dir") ?? DefaultInstallRoot, "test-data")
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrintFlow Agent", "logs");
                Directory.CreateDirectory(logDirectory);
                File.AppendAllText(Path.Combine(logDirectory, "installer.log"), $"{DateTime.UtcNow:O} {error}{Environment.NewLine}");
            }
            else MessageBox.Show($"Nao foi possivel concluir: {error.Message}", "PrintFlow Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int Install(string zipPath, string apiUrl, string root, string taskName, string localPort, bool testMode, string? testDataDirectory, bool failAfterCopy, bool consentAccepted)
    {
        if (!File.Exists(zipPath)) throw new FileNotFoundException("Pacote do Agent nao encontrado.", zipPath);
        var temp = Path.Combine(Path.GetTempPath(), $"PrintFlowAgentSetup-{Guid.NewGuid():N}");
        var backup = Path.Combine(Path.GetTempPath(), $"PrintFlowAgentRollback-{Guid.NewGuid():N}");
        var movedExistingInstall = false;
        var copiedNewInstall = false;
        var taskStopped = false;
        var hadExistingInstall = Directory.Exists(root);
        try
        {
            Directory.CreateDirectory(temp);
            ZipFile.ExtractToDirectory(zipPath, temp);
            var host = Path.Combine(temp, "host", "PrintFlowAgentHost.exe");
            var package = Path.Combine(temp, "package.json");
            if (!File.Exists(host) || !File.Exists(package)) throw new InvalidDataException("Pacote do Agent incompleto.");
            if (!testMode) TrustDeveloperCertificateIfPresent();
            ValidateOrcaRuntime(temp, testMode);

            if (hadExistingInstall) EnsureNoActivePrintJobs(root, localPort);
            StopTask(taskName);
            taskStopped = true;
            if (hadExistingInstall)
            {
                StopAgentProcesses(root, localPort);
                Directory.Move(root, backup);
                movedExistingInstall = true;
            }
            copiedNewInstall = true;
            CopyDirectory(temp, root);
            File.Copy(Environment.ProcessPath!, Path.Combine(root, "PrintFlowAgentSetup.exe"), true);
            if (testMode && failAfterCopy) throw new InvalidOperationException("Falha de rollback simulada em modo de teste.");

            var installedHost = Path.Combine(root, "host", "PrintFlowAgentHost.exe");
            CreateTask(installedHost, apiUrl, taskName, localPort, root, testMode, testDataDirectory);
            if (!testMode)
            {
                RegisterProtocol(installedHost);
                CreateShortcuts(installedHost, apiUrl, root);
                RegisterUninstaller(root, GetVersion(Path.Combine(root, "package.json")));
            }
            StartTask(taskName);
            var installedVersion = GetVersion(Path.Combine(root, "package.json"));
            if (!WaitForHealth(installedVersion, localPort, requirePaired: movedExistingInstall, TimeSpan.FromSeconds(45)))
                throw new InvalidOperationException("O Agent nao confirmou /healthz e conexao local no prazo.");
            if (!testMode && consentAccepted) SaveTermsAcceptance(installedVersion);
            if (!testMode && !Environment.GetCommandLineArgs().Contains("--quiet", StringComparer.OrdinalIgnoreCase)) MessageBox.Show("PrintFlow Agent instalado. Ele iniciara automaticamente com o Windows.", "PrintFlow Agent", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch
        {
            if (taskStopped) StopTask(taskName);
            if (copiedNewInstall && Directory.Exists(root)) Directory.Delete(root, true);
            if (movedExistingInstall && Directory.Exists(backup)) Directory.Move(backup, root);
            if (taskStopped && hadExistingInstall && Directory.Exists(root))
            {
                try
                {
                    if (!testMode) RegisterUninstaller(root, GetVersion(Path.Combine(root, "package.json")));
                    CreateTask(Path.Combine(root, "host", "PrintFlowAgentHost.exe"), apiUrl, taskName, localPort, root, testMode, testDataDirectory);
                    StartTask(taskName);
                }
                catch { }
            }
            throw;
        }
        finally
        {
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
            if (Directory.Exists(backup)) Directory.Delete(backup, true);
        }
    }

    private static int Uninstall(string installRoot, string taskName, bool removeUserData, bool testMode)
    {
        if (testMode) return FinalizeUninstall(installRoot, taskName, removeUserData, true);
        return FinalizeUninstall(installRoot, taskName, removeUserData, testMode);
    }

    private static string ReadTerms() => Assembly.GetExecutingAssembly().GetManifestResourceStream("PrintFlowAgentSetup.TermsOfUse.txt") is { } stream
        ? new StreamReader(stream, Encoding.UTF8).ReadToEnd()
        : throw new InvalidDataException("Os termos de uso nao foram incluidos neste instalador.");

    private static string? GetPackageVersionFromZip(string? zipPath)
    {
        if (string.IsNullOrWhiteSpace(zipPath)) return null;
        if (!Path.IsPathRooted(zipPath)) zipPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, zipPath));
        if (!File.Exists(zipPath)) throw new FileNotFoundException("Pacote do Agent nao encontrado.", zipPath);
        using var archive = ZipFile.OpenRead(zipPath);
        var entry = archive.GetEntry("package.json") ?? throw new InvalidDataException("Pacote do Agent incompleto.");
        using var reader = new StreamReader(entry.Open());
        using var json = JsonDocument.Parse(reader.ReadToEnd());
        return json.RootElement.GetProperty("version").GetString();
    }

    private static string GetInstalledVersion(string root) => File.Exists(Path.Combine(root, "package.json")) ? GetVersion(Path.Combine(root, "package.json")) : "";
    private static string TermsAcceptancePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrintFlow Agent", "terms-acceptance.json");

    private static bool HasAcceptedTerms()
    {
        try { using var json = JsonDocument.Parse(File.ReadAllText(TermsAcceptancePath)); return json.RootElement.GetProperty("termsVersion").GetString() == TermsVersion; }
        catch { return false; }
    }

    private static void SaveTermsAcceptance(string packageVersion)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(TermsAcceptancePath)!);
        File.WriteAllText(TermsAcceptancePath, JsonSerializer.Serialize(new { termsVersion = TermsVersion, acceptedAtUtc = DateTime.UtcNow.ToString("O"), packageVersion }, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static int FinalizeUninstall(string installRoot, string taskName, bool removeUserData, bool testMode = false)
    {
        StopTask(taskName);
        if (!testMode) DeleteShortcuts();
        if (!testMode && taskName == "PrintFlowAgent")
        {
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\printflow-agent", false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent", false);
        }
        if (!testMode && removeUserData) DeleteDirectory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrintFlow Agent"));
        var helper = Path.Combine(Path.GetTempPath(), $"PrintFlowAgentUninstall-{Guid.NewGuid():N}.exe");
        File.Copy(Environment.ProcessPath!, helper, true);
        Process.Start(new ProcessStartInfo(helper, $"--finalize-uninstall --install-dir \"{installRoot}\" --task-name \"{taskName}\" {(removeUserData ? "--remove-user-data" : "")} {(testMode ? "--test-mode" : "")}") { UseShellExecute = false, CreateNoWindow = true });
        return 0;
    }

    private static string? ReadArgument(string[] args, string name) { var i = Array.FindIndex(args, value => string.Equals(value, name, StringComparison.OrdinalIgnoreCase)); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
    private static string DefaultInstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrintFlowAgent");
    private static void TrustDeveloperCertificateIfPresent()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "PrintFlow-Agent-Dev-Certificate.cer");
        if (!File.Exists(path)) return;
        const string expectedSha256 = "AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB";
        var bytes = File.ReadAllBytes(path);
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
        if (!string.Equals(hash, expectedSha256, StringComparison.OrdinalIgnoreCase)) throw new CryptographicException("Certificado Early Access nao corresponde ao pacote.");
        var certificate = new X509Certificate2(bytes);
        var usage = certificate.Extensions.OfType<X509EnhancedKeyUsageExtension>().SelectMany(item => item.EnhancedKeyUsages.Cast<Oid>()).Any(oid => oid.Value == "1.3.6.1.5.5.7.3.3");
        if (!usage) throw new CryptographicException("Certificado nao permite assinatura de codigo.");
        var trusted = new[] { StoreName.Root, StoreName.TrustedPublisher }.All(storeName =>
        {
            using var store = new X509Store(storeName, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadOnly);
            return store.Certificates.Cast<X509Certificate2>().Any(existing => existing.Thumbprint == certificate.Thumbprint);
        });
        if (!trusted && MessageBox.Show("Este pacote usa o certificado Early Access do PrintFlow Agent. Deseja confiar neste certificado para validar as atualizacoes assinadas futuras?", "PrintFlow Agent - certificado de teste", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            throw new OperationCanceledException("Instalacao cancelada: certificado Early Access recusado.");
        foreach (var storeName in new[] { StoreName.Root, StoreName.TrustedPublisher })
        {
            using var store = new X509Store(storeName, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadWrite);
            if (!store.Certificates.Cast<X509Certificate2>().Any(existing => existing.Thumbprint == certificate.Thumbprint)) store.Add(certificate);
        }
    }
    private static int ShowUsage() { MessageBox.Show("Instalador nativo do PrintFlow Agent.", "PrintFlow Agent"); return 2; }
    private static void CreateTask(string host, string apiUrl, string taskName, string localPort, string installRoot, bool testMode, string? testDataDirectory)
    {
        XNamespace ns = "http://schemas.microsoft.com/windows/2004/02/mit/task";
        var user = WindowsIdentity.GetCurrent().Name;
        var arguments = $"--api-url {QuoteTaskArgument(apiUrl)} --local-port {localPort}" +
            (testMode ? $" --data-dir {QuoteTaskArgument(testDataDirectory ?? Path.Combine(installRoot, "test-data"))} --test-mode" : "");
        var definition = new XDocument(
            new XDeclaration("1.0", "UTF-16", null),
            new XElement(ns + "Task",
                new XAttribute("version", "1.2"),
                new XElement(ns + "RegistrationInfo",
                    new XElement(ns + "Author", user),
                    new XElement(ns + "Description", "Inicia o PrintFlow Agent quando este usuario entra no Windows.")),
                new XElement(ns + "Triggers",
                    new XElement(ns + "LogonTrigger",
                        new XElement(ns + "Enabled", "true"),
                        new XElement(ns + "UserId", user))),
                new XElement(ns + "Principals",
                    new XElement(ns + "Principal",
                        new XAttribute("id", "Author"),
                        new XElement(ns + "UserId", user),
                        new XElement(ns + "LogonType", "InteractiveToken"),
                        new XElement(ns + "RunLevel", "LeastPrivilege"))),
                new XElement(ns + "Settings",
                    new XElement(ns + "MultipleInstancesPolicy", "IgnoreNew"),
                    new XElement(ns + "DisallowStartIfOnBatteries", "false"),
                    new XElement(ns + "StopIfGoingOnBatteries", "false"),
                    new XElement(ns + "StartWhenAvailable", "true"),
                    new XElement(ns + "Enabled", "true"),
                    new XElement(ns + "ExecutionTimeLimit", "PT0S")),
                new XElement(ns + "Actions",
                    new XAttribute("Context", "Author"),
                    new XElement(ns + "Exec",
                        new XElement(ns + "Command", host),
                        new XElement(ns + "Arguments", arguments),
                        new XElement(ns + "WorkingDirectory", installRoot)))));
        var definitionPath = Path.Combine(Path.GetTempPath(), $"PrintFlowAgentTask-{Guid.NewGuid():N}.xml");
        try
        {
            using (var writer = System.Xml.XmlWriter.Create(definitionPath, new System.Xml.XmlWriterSettings
            {
                Encoding = Encoding.Unicode,
                Indent = true
            }))
                definition.Save(writer);
            Run("schtasks.exe", ["/Create", "/TN", taskName, "/XML", definitionPath, "/F"]);
        }
        finally
        {
            try { File.Delete(definitionPath); } catch { }
        }
    }
    private static string QuoteTaskArgument(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
    private static int? RelaunchElevatedWhenRequired(string[] args)
    {
        var needsTaskSchedulerAccess = args.Any(argument =>
            string.Equals(argument, "--install-package", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(argument, "--uninstall", StringComparison.OrdinalIgnoreCase));
        if (!needsTaskSchedulerAccess || new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return null;

        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Caminho do instalador indisponivel para solicitar permissao.");
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = true,
            Verb = "runas",
            WorkingDirectory = Environment.CurrentDirectory
        };
        foreach (var argument in args) start.ArgumentList.Add(argument);
        Process? elevatedProcess;
        try { elevatedProcess = Process.Start(start); }
        catch (Win32Exception error) when (error.NativeErrorCode == 1223) { return 0; }
        using var process = elevatedProcess ?? throw new InvalidOperationException("Nao foi possivel reabrir o instalador com permissao administrativa.");
        process.WaitForExit();
        return process.ExitCode;
    }
    private static void StartTask(string taskName) => Run("schtasks.exe", ["/Run", "/TN", taskName]);
    private static void StopTask(string taskName) { Run("schtasks.exe", ["/End", "/TN", taskName], false); Run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], false); }
    private static int Run(string file, IReadOnlyList<string> arguments, bool required = true)
    {
        var start = new ProcessStartInfo(file) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException($"Nao foi possivel iniciar {file}.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(15_000))
        {
            process.Kill(true);
            throw new TimeoutException($"{file} nao terminou no prazo.");
        }
        var details = $"{stderr.GetAwaiter().GetResult()} {stdout.GetAwaiter().GetResult()}".Trim();
        if (required && process.ExitCode != 0) throw new InvalidOperationException($"Falha ao executar {file} (codigo {process.ExitCode}). {details}");
        return process.ExitCode;
    }
    private static void RegisterProtocol(string host) { using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\printflow-agent"); key!.SetValue(null, "URL:PrintFlow Agent Protocol"); key.SetValue("URL Protocol", ""); using var icon = key.CreateSubKey("DefaultIcon"); icon!.SetValue(null, $"{host},0"); using var command = key.CreateSubKey(@"shell\open\command"); command!.SetValue(null, $"\"{host}\" --protocol \"%1\""); }
    private static void RegisterUninstaller(string root, string version) { using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent"); key!.SetValue("DisplayName", "PrintFlow Agent"); key.SetValue("DisplayVersion", version); key.SetValue("Publisher", "PrintFlow 3D"); key.SetValue("InstallLocation", root); key.SetValue("DisplayIcon", Path.Combine(root, "assets", "printflow-agent-icon.ico")); key.SetValue("UninstallString", $"\"{Path.Combine(root, "PrintFlowAgentSetup.exe")}\" --uninstall"); }
    private static string GetVersion(string package) => JsonDocument.Parse(File.ReadAllText(package)).RootElement.GetProperty("version").GetString() ?? "0.0.0";
    private static void CreateShortcuts(string host, string apiUrl, string root) { CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PrintFlow Agent.lnk"), host, $"--api-url \"{apiUrl}\"", root); var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PrintFlow 3D"); Directory.CreateDirectory(menu); CreateShortcut(Path.Combine(menu, "PrintFlow Agent.lnk"), host, $"--api-url \"{apiUrl}\"", root); CreateShortcut(Path.Combine(menu, "Desinstalar PrintFlow Agent.lnk"), Path.Combine(root, "PrintFlowAgentSetup.exe"), "--uninstall", root); }
    private static void CreateShortcut(string path, string target, string arguments, string root) { var shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!); dynamic shortcut = shell!.GetType().InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, [path])!; shortcut.TargetPath = target; shortcut.Arguments = arguments; shortcut.WorkingDirectory = root; shortcut.IconLocation = $"{Path.Combine(root, "assets", "printflow-agent-icon.ico")},0"; shortcut.Save(); }
    private static void DeleteShortcuts() { foreach (var path in new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PrintFlow Agent.lnk"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PrintFlow 3D") }) DeleteDirectory(path); }
    private static void DeleteDirectory(string path) { if (Directory.Exists(path)) Directory.Delete(path, true); else if (File.Exists(path)) File.Delete(path); }
    private static void CopyDirectory(string source, string target) { Directory.CreateDirectory(target); foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true); foreach (var directory in Directory.EnumerateDirectories(source)) CopyDirectory(directory, Path.Combine(target, Path.GetFileName(directory))); }

    private static void ValidateOrcaRuntime(string packageRoot, bool testMode)
    {
        var node = Path.Combine(packageRoot, "runtime", "node.exe");
        var verifier = Path.Combine(packageRoot, "scripts", "verify-orca-runtime.mjs");
        if (!File.Exists(node) || !File.Exists(verifier)) throw new InvalidDataException("Validador OrcaSlicer ausente no pacote.");
        if (testMode)
        {
            Run(node, ["--check", Path.Combine(packageRoot, "src", "index.js")]);
            return;
        }
        if (Run(node, [verifier], required: false) != 0)
            Run("winget.exe", ["install", "--id", "9MV6GL23XM59", "--exact", "--source", "msstore", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity", "--silent"]);
        Run(node, [verifier]);
    }

    private static bool WaitForHealth(string expectedVersion, string port, bool requirePaired, TimeSpan timeout)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var health = http.GetFromJsonAsync<SetupHealth>($"http://127.0.0.1:{port}/healthz").GetAwaiter().GetResult();
                if (health is { Ok: true } && health.Version == expectedVersion && (!requirePaired || health.Paired)) return true;
            }
            catch { }
            Thread.Sleep(500);
        }
        return false;
    }

    private static void EnsureNoActivePrintJobs(string installRoot, string port)
    {
        if (!HasAgentProcesses(installRoot)) return;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        SetupHealth? health;
        try { health = http.GetFromJsonAsync<SetupHealth>($"http://127.0.0.1:{port}/healthz").GetAwaiter().GetResult(); }
        catch (Exception error) { throw new InvalidOperationException("Nao foi possivel confirmar o estado da impressao antes de atualizar o Agent.", error); }
        if (health is null || !health.Ok) throw new InvalidOperationException("O Agent existente nao confirmou o estado local antes da atualizacao.");
        if (health.ActivePrintJobs > 0) throw new InvalidOperationException("Finalize ou pause as impressoes ativas antes de atualizar o Agent.");
    }

    private static void StopAgentProcesses(string installRoot, string port)
    {
        var processes = FindAgentHostProcesses(installRoot).Concat(FindAgentNodeProcesses(installRoot)).ToList();
        if (processes.Count == 0) return;
        EnsureNoActivePrintJobs(installRoot, port);
        foreach (var process in processes)
        {
            using (process)
            {
                if (process.HasExited) continue;
                process.Kill(entireProcessTree: true);
                if (!process.WaitForExit(15_000)) throw new InvalidOperationException("O Agent antigo continuou em execucao; a instalacao foi interrompida para preservar os arquivos.");
            }
        }
    }

    private static bool HasAgentProcesses(string installRoot)
    {
        var processes = FindAgentHostProcesses(installRoot).Concat(FindAgentNodeProcesses(installRoot)).ToList();
        try { return processes.Any(process => !process.HasExited); }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    private static List<Process> FindAgentNodeProcesses(string installRoot)
    {
        return FindProcessesByExecutable("node", Path.Combine(installRoot, "runtime", "node.exe"));
    }

    private static List<Process> FindAgentHostProcesses(string installRoot)
    {
        return FindProcessesByExecutable("PrintFlowAgentHost", Path.Combine(installRoot, "host", "PrintFlowAgentHost.exe"));
    }

    private static List<Process> FindProcessesByExecutable(string processName, string executablePath)
    {
        var expectedExecutable = Path.GetFullPath(executablePath);
        var matches = new List<Process>();
        foreach (var process in Process.GetProcessesByName(processName))
        {
            try
            {
                if (string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? string.Empty), expectedExecutable, StringComparison.OrdinalIgnoreCase)) matches.Add(process);
                else process.Dispose();
            }
            catch { process.Dispose(); }
        }
        return matches;
    }

    private sealed record SetupHealth(bool Ok, string? Version, bool Paired, bool CloudConnected, int ActivePrintJobs);
}
