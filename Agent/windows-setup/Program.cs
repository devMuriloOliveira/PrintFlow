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
using System.Text.RegularExpressions;
using System.Xml.Linq;
using FilaAgent.Runtime;

namespace FilaAgent.Setup;

internal static class Program
{
    private const string TermsVersion = "1.4";
    private const string DefaultTaskName = "FilaAgent";
    private const string LegacyTaskName = "PrintFlowAgent";
    private const string StartupRunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupValueName = "FilaAgent";
    private const string OrcaStoreProductId = "9MV6GL23XM59";
    [STAThread]
    private static int Main(string[] args)
    {
        string? embeddedPackagePath = null;
        var testMode = args.Contains("--test-mode", StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!testMode && !args.Contains("--quiet", StringComparer.OrdinalIgnoreCase) &&
                !args.Contains("--validate-embedded-package", StringComparer.OrdinalIgnoreCase))
                ApplicationConfiguration.Initialize();
            if (args.Contains("--validate-embedded-package", StringComparer.OrdinalIgnoreCase))
                return ValidateEmbeddedPackage();
            args = AddEmbeddedPackageArgument(args, out embeddedPackagePath);
            var installRoot = ResolveInstallRoot(args);
            var taskName = ReadArgument(args, "--task-name") ?? DefaultTaskName;
            var legacyTaskName = ReadArgument(args, "--legacy-task-name");
            if (string.IsNullOrWhiteSpace(legacyTaskName) && !testMode && taskName.Equals(DefaultTaskName, StringComparison.OrdinalIgnoreCase))
                legacyTaskName = LegacyTaskName;
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
            ValidateTestModeOperation(testMode, args, installRoot, taskName, legacyTaskName, testDataDirectory);
            var apiUrl = ReadArgument(args, "--api-url") ?? "https://printflow-api-4y5l.onrender.com";
            if (!testMode && args.Contains("--install-package", StringComparer.OrdinalIgnoreCase))
                _ = AgentConfiguration.FromEnvironment(new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
                {
                    ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION",
                    ["FILA_AGENT_API_URL"] = apiUrl
                });
            var elevatedExitCode = RelaunchElevatedWhenRequired(args, testMode);
            if (elevatedExitCode.HasValue) return elevatedExitCode.Value;
            if (args.Contains("--check-updates", StringComparer.OrdinalIgnoreCase))
                return new SignedUpdateService(ReadArgument(args, "--test-release-api"), testMode, testDataDirectory,
                    apiUrl, taskName, localPort).CheckAndInstallAsync(installRoot,
                    args.Contains("--interactive", StringComparer.OrdinalIgnoreCase),
                    args.Contains("--confirm-updates", StringComparer.OrdinalIgnoreCase)).GetAwaiter().GetResult() ? 0 : 0;
            if (args.Contains("--finalize-uninstall", StringComparer.OrdinalIgnoreCase))
            {
                DeleteDirectory(ReadArgument(args, "--install-dir") ?? DefaultInstallRoot);
                if (!testMode && args.Contains("--remove-user-data", StringComparer.OrdinalIgnoreCase)) DeleteUserDataDirectories();
                try { File.Delete(Environment.ProcessPath!); } catch { }
                return 0;
            }
            if (args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase)) return Uninstall(installRoot, taskName, args.Contains("--remove-user-data", StringComparer.OrdinalIgnoreCase), testMode);
            var zip = ReadArgument(args, "--install-package");
            if (!string.IsNullOrWhiteSpace(zip) && !Path.IsPathRooted(zip)) zip = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, zip));
            if (string.IsNullOrWhiteSpace(zip)) return ShowUsage();
            return Install(zip, apiUrl, installRoot, taskName, legacyTaskName, localPort, testMode, testDataDirectory, args.Contains("--test-fail-after-copy", StringComparer.OrdinalIgnoreCase), args.Contains("--consent-accepted", StringComparer.OrdinalIgnoreCase));
        }
        catch (Exception error)
        {
            if (args.Contains("--validate-embedded-package", StringComparer.OrdinalIgnoreCase))
            {
                Console.Error.WriteLine(error);
                return 1;
            }
            var logDirectory = testMode
                ? ReadArgument(args, "--test-data-dir") ?? Path.Combine(ResolveInstallRoot(args), "test-data")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FilaAgentSetup", "logs");
            var logPath = Path.Combine(logDirectory, "installer.log");
            try
            {
                Directory.CreateDirectory(logDirectory);
                File.AppendAllText(logPath, $"{DateTime.UtcNow:O} {error}{Environment.NewLine}");
            }
            catch (Exception loggingError)
            {
                try
                {
                    Console.Error.WriteLine($"Falha do instalador: {error}");
                    Console.Error.WriteLine($"Nao foi possivel gravar installer.log: {loggingError.Message}");
                }
                catch { }
            }
            if (testMode || args.Contains("--quiet", StringComparer.OrdinalIgnoreCase))
                return 1;
            MessageBox.Show($"Nao foi possivel concluir: {error.Message}{Environment.NewLine}{Environment.NewLine}Detalhes registrados em: {logPath}", "Fila Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(embeddedPackagePath))
            {
                try { File.Delete(embeddedPackagePath); } catch { }
            }
        }
    }

    private static int ValidateEmbeddedPackage()
    {
        ValidateThirdPartyLicenseResources();
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("FilaAgentSetup.AgentPackage.zip")
            ?? throw new InvalidDataException("Payload ZIP nao foi embutido no instalador.");
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var entries = archive.Entries.Select(entry => entry.FullName.Replace('\\', '/')).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!entries.Contains("package.json") || !entries.Contains("host/FilaAgent.exe"))
            throw new InvalidDataException("Payload embutido nao contem package.json e host C#.");
        if (entries.Any(name => Path.GetFileName(name).Equals("node.exe", StringComparison.OrdinalIgnoreCase) ||
                                new[] { ".node", ".ps1", ".psm1", ".vbs" }.Contains(Path.GetExtension(name), StringComparer.OrdinalIgnoreCase)))
            throw new InvalidDataException("Payload embutido contem Node nativo ou script de execucao legado.");
        using var manifestStream = archive.GetEntry("package.json")!.Open();
        using var manifest = JsonDocument.Parse(manifestStream);
        if (manifest.RootElement.GetProperty("runtime").GetString() != ".NET 8 self-contained" ||
            manifest.RootElement.GetProperty("selfContained").GetBoolean() is false)
            throw new InvalidDataException("Manifesto do payload nao declara runtime C# autocontido.");
        Console.WriteLine($"Payload embutido validado (v{manifest.RootElement.GetProperty("version").GetString()}).");
        return 0;
    }

    private static void ValidateThirdPartyLicenseResources()
    {
        var resources = Assembly.GetExecutingAssembly().GetManifestResourceNames().ToHashSet(StringComparer.Ordinal);
        var required = new[]
        {
            "FilaAgentSetup.ThirdParty.00-Overview.txt",
            "FilaAgentSetup.ThirdParty.DOTNET-THIRD-PARTY-NOTICES.txt",
            "FilaAgentSetup.ThirdParty.LICENSE-APACHE-2.0.txt",
            "FilaAgentSetup.ThirdParty.LICENSE-BouncyCastle.txt",
            "FilaAgentSetup.ThirdParty.LICENSE-DotNet-MIT.txt",
            "FilaAgentSetup.ThirdParty.LICENSE-DotNet-Runtime.txt",
            "FilaAgentSetup.ThirdParty.LICENSE-FluentFTP.txt",
            "FilaAgentSetup.ThirdParty.LICENSE-MQTTnet.txt",
            "FilaAgentSetup.ThirdParty.NOTICE-SQLitePCLRaw.txt"
        };
        var missing = required.Where(name => !resources.Contains(name)).ToArray();
        if (missing.Length > 0) throw new InvalidDataException("Avisos de licenca ausentes no instalador: " + string.Join(", ", missing));
    }

    private static string[] AddEmbeddedPackageArgument(string[] args, out string? extractedPackagePath)
    {
        extractedPackagePath = null;
        if (args.Any(argument => string.Equals(argument, "--install-package", StringComparison.OrdinalIgnoreCase)) ||
            args.Any(argument => new[] { "--check-updates", "--uninstall", "--finalize-uninstall", "--help" }
                .Contains(argument, StringComparer.OrdinalIgnoreCase))) return args;

        using var embeddedPackage = Assembly.GetExecutingAssembly().GetManifestResourceStream("FilaAgentSetup.AgentPackage.zip");
        if (embeddedPackage is null) return args;

        extractedPackagePath = Path.Combine(Path.GetTempPath(), $"FilaAgentPackage-{Guid.NewGuid():N}.zip");
        using (var output = File.Create(extractedPackagePath)) embeddedPackage.CopyTo(output);
        return [.. args, "--install-package", extractedPackagePath];
    }

    private static int Install(string zipPath, string apiUrl, string root, string taskName, string? legacyTaskName, string localPort, bool testMode, string? testDataDirectory, bool failAfterCopy, bool consentAccepted)
    {
        if (!File.Exists(zipPath)) throw new FileNotFoundException("Pacote do Agent nao encontrado.", zipPath);
        var temp = Path.Combine(Path.GetTempPath(), $"FilaAgentSetup-{Guid.NewGuid():N}");
        var backup = Path.Combine(Path.GetTempPath(), $"FilaAgentRollback-{Guid.NewGuid():N}");
        var movedExistingInstall = false;
        var copiedNewInstall = false;
        var installationCompleted = false;
        var taskStopped = false;
        var legacyTaskStopped = false;
        var hadExistingInstall = Directory.Exists(root);
        try
        {
            Directory.CreateDirectory(temp);
            ZipFile.ExtractToDirectory(zipPath, temp);
            var host = Path.Combine(temp, "host", "FilaAgent.exe");
            var package = Path.Combine(temp, "package.json");
            if (!File.Exists(host) || !File.Exists(package)) throw new InvalidDataException("Pacote do Agent incompleto.");
            if (!testMode) TrustDeveloperCertificateIfPresent();
            ValidateOrcaRuntime(temp, testMode);

            if (hadExistingInstall) EnsureNoActivePrintJobs(root, localPort);
            StopTask(taskName);
            taskStopped = true;
            if (!string.IsNullOrWhiteSpace(legacyTaskName) && !taskName.Equals(legacyTaskName, StringComparison.OrdinalIgnoreCase))
            {
                StopTask(legacyTaskName);
                legacyTaskStopped = true;
            }
            if (hadExistingInstall)
            {
                StopAgentProcesses(root, localPort);
                Directory.Move(root, backup);
                movedExistingInstall = true;
            }
            copiedNewInstall = true;
            CopyDirectory(temp, root);
            File.Copy(Environment.ProcessPath!, Path.Combine(root, "FilaAgentSetup.exe"), true);
            if (testMode && failAfterCopy) throw new InvalidOperationException("Falha de rollback simulada em modo de teste.");

            var installedHost = Path.Combine(root, "host", "FilaAgent.exe");
            if (!testMode)
            {
                RegisterProtocol(installedHost);
                CreateShortcuts(installedHost, apiUrl, root);
                var installedSetup = Path.Combine(root, "FilaAgentSetup.exe");
                if (!File.Exists(installedSetup) || !string.Equals(
                        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Environment.ProcessPath!))),
                        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(installedSetup))),
                        StringComparison.OrdinalIgnoreCase))
                    throw new IOException("O instalador nao foi preservado corretamente na pasta do Agent; a desinstalacao nao foi registrada.");
            }
            CreateTask(installedHost, apiUrl, taskName, localPort, root, testMode, testDataDirectory);
            StartTask(taskName);
            var installedVersion = GetVersion(Path.Combine(root, "package.json"));
            if (!WaitForHealth(installedVersion, localPort, requirePaired: movedExistingInstall, TimeSpan.FromSeconds(90)))
                throw new InvalidOperationException("O Agent nao confirmou /healthz e, na atualizacao, pareamento e conexao com a nuvem no prazo.");
            if (testMode)
                RegisterStartupEntry(installedHost, apiUrl, localPort, GetTestStartupValueName(taskName), testDataDirectory);
            if (!testMode)
            {
                RegisterUninstaller(root, installedVersion);
                VerifyUninstallerRegistration(root);
                RegisterStartupEntry(installedHost, apiUrl, localPort);
                DeleteTask(taskName);
                if (!string.IsNullOrWhiteSpace(legacyTaskName) && !taskName.Equals(legacyTaskName, StringComparison.OrdinalIgnoreCase)) StopTask(legacyTaskName);
                if (!File.Exists(ResolveInstalledSetup(root))) throw new FileNotFoundException("O desinstalador desapareceu durante a instalacao.", Path.Combine(root, "FilaAgentSetup.exe"));
            }
            if (!testMode && consentAccepted) SaveTermsAcceptance(installedVersion);
            if (!testMode && !Environment.GetCommandLineArgs().Contains("--quiet", StringComparer.OrdinalIgnoreCase))
                MessageBox.Show($"Instalação concluída com sucesso!\r\n\r\nFila Agent {installedVersion} foi instalado e respondeu à verificação local.\r\n\r\nEle iniciará quando você entrar no Windows. Para desativar essa opção, abra o Gerenciador de Tarefas > Aplicativos de inicialização e desative Fila Agent.\r\n\r\nDesinstalador registrado em Aplicativos instalados.", "Fila Agent instalado", MessageBoxButtons.OK, MessageBoxIcon.Information);
            installationCompleted = true;
            return 0;
        }
        catch (Exception installError)
        {
            Exception? rollbackError = null;
            if (taskStopped)
            {
                try { StopTask(taskName); }
                catch (Exception error) { rollbackError = error; }
            }
            if (!testMode)
            {
                try
                {
                    Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilaAgent", false);
                }
                catch (Exception error) { rollbackError = rollbackError is null ? error : new AggregateException(rollbackError, error); }
            }
            try { RemoveStartupEntry(testMode ? GetTestStartupValueName(taskName) : StartupValueName); }
            catch (Exception error) { rollbackError = rollbackError is null ? error : new AggregateException(rollbackError, error); }
            if (rollbackError is null && copiedNewInstall && Directory.Exists(root))
            {
                try { StopAgentProcesses(root, localPort); }
                catch (Exception error) { rollbackError = error; }
            }
            if (rollbackError is null && copiedNewInstall && Directory.Exists(root))
            {
                try { Directory.Delete(root, true); }
                catch (Exception error) { rollbackError = rollbackError is null ? error : new AggregateException(rollbackError, error); }
            }
            if (movedExistingInstall && Directory.Exists(backup) && !Directory.Exists(root))
            {
                try { Directory.Move(backup, root); }
                catch (Exception error) { rollbackError = rollbackError is null ? error : new AggregateException(rollbackError, error); }
            }
            if (rollbackError is null && taskStopped && hadExistingInstall && Directory.Exists(root))
            {
                try
                {
                    var rollbackTaskName = legacyTaskStopped && !string.IsNullOrWhiteSpace(legacyTaskName) ? legacyTaskName : taskName;
                    if (!testMode)
                    {
                        RegisterUninstaller(root, GetVersion(Path.Combine(root, "package.json")));
                        var rollbackHost = ResolveInstalledHost(root);
                        CreateTask(rollbackHost, apiUrl, rollbackTaskName, localPort, root, testMode, testDataDirectory);
                        StartTask(rollbackTaskName);
                        var rollbackVersion = GetVersion(Path.Combine(root, "package.json"));
                        if (!WaitForHealth(rollbackVersion, localPort, requirePaired: false, TimeSpan.FromSeconds(45)))
                            throw new InvalidOperationException("A instalacao anterior foi restaurada, mas nao confirmou /healthz.");
                        RegisterStartupEntry(rollbackHost, apiUrl, localPort);
                        DeleteTask(rollbackTaskName);
                    }
                    else
                    {
                        var rollbackHost = ResolveInstalledHost(root);
                        CreateTask(rollbackHost, apiUrl, rollbackTaskName, localPort, root, testMode, testDataDirectory);
                        StartTask(rollbackTaskName);
                        var rollbackVersion = GetVersion(Path.Combine(root, "package.json"));
                        if (!WaitForHealth(rollbackVersion, localPort, requirePaired: false, TimeSpan.FromSeconds(45)))
                            throw new InvalidOperationException("A instalacao anterior foi restaurada, mas nao confirmou /healthz.");
                        RegisterStartupEntry(rollbackHost, apiUrl, localPort, GetTestStartupValueName(rollbackTaskName), testDataDirectory);
                    }
                }
                catch (Exception error) { rollbackError = error; }
            }
            if (rollbackError is not null)
                throw new InvalidOperationException($"Falha na instalação: {installError.Message}. A reversão também falhou: {rollbackError.Message}", installError);
            throw;
        }
        finally
        {
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
            if (installationCompleted && Directory.Exists(backup)) Directory.Delete(backup, true);
        }
    }

    private static int Uninstall(string installRoot, string taskName, bool removeUserData, bool testMode)
    {
        if (testMode) return FinalizeUninstall(installRoot, taskName, removeUserData, true);
        return FinalizeUninstall(installRoot, taskName, removeUserData, testMode);
    }

    private static string ReadTerms() => Assembly.GetExecutingAssembly().GetManifestResourceStream("FilaAgentSetup.TermsOfUse.txt") is { } stream
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
    private static string TermsAcceptancePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Fila Agent", "terms-acceptance.json");
    private static string LegacyTermsAcceptancePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrintFlow Agent", "terms-acceptance.json");

    private static bool HasAcceptedTerms()
    {
        foreach (var path in new[] { TermsAcceptancePath, LegacyTermsAcceptancePath })
        {
            try { using var json = JsonDocument.Parse(File.ReadAllText(path)); if (json.RootElement.GetProperty("termsVersion").GetString() == TermsVersion) return true; }
            catch { }
        }
        return false;
    }

    private static void SaveTermsAcceptance(string packageVersion)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(TermsAcceptancePath)!);
        File.WriteAllText(TermsAcceptancePath, JsonSerializer.Serialize(new { termsVersion = TermsVersion, acceptedAtUtc = DateTime.UtcNow.ToString("O"), packageVersion }, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static void DeleteUserDataDirectories()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        DeleteDirectory(Path.Combine(appData, "Fila Agent"));
        DeleteDirectory(Path.Combine(appData, "PrintFlow Agent"));
    }

    private static int FinalizeUninstall(string installRoot, string taskName, bool removeUserData, bool testMode = false)
    {
        StopTask(taskName);
        StopAgentProcesses(installRoot, "17873", requireIdle: !testMode);
        if (!testMode)
        {
            foreach (var knownTaskName in new[] { DefaultTaskName, LegacyTaskName })
                if (!taskName.Equals(knownTaskName, StringComparison.OrdinalIgnoreCase)) StopTask(knownTaskName);
            DeleteShortcuts();
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\printflow-agent", false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\fila-agent", false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilaAgent", false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent", false);
        }
        RemoveStartupEntry(testMode ? GetTestStartupValueName(taskName) : StartupValueName);
        if (!testMode && removeUserData) DeleteUserDataDirectories();
        var helper = Path.Combine(Path.GetTempPath(), $"FilaAgentUninstall-{Guid.NewGuid():N}.exe");
        File.Copy(Environment.ProcessPath!, helper, true);
        Process.Start(new ProcessStartInfo(helper, $"--finalize-uninstall --install-dir \"{installRoot}\" --task-name \"{taskName}\" {(removeUserData ? "--remove-user-data" : "")} {(testMode ? "--test-mode" : "")}") { UseShellExecute = false, CreateNoWindow = true });
        return 0;
    }

    private static string? ReadArgument(string[] args, string name) { var i = Array.FindIndex(args, value => string.Equals(value, name, StringComparison.OrdinalIgnoreCase)); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
    private static string DefaultInstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FilaAgent");
    private static string LegacyInstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrintFlowAgent");
    private static string ResolveInstallRoot(string[] args)
    {
        var requestedRoot = ReadArgument(args, "--install-dir");
        if (!string.IsNullOrWhiteSpace(requestedRoot)) return Path.GetFullPath(requestedRoot);
        if (Directory.Exists(DefaultInstallRoot)) return DefaultInstallRoot;
        if (Directory.Exists(LegacyInstallRoot)) return LegacyInstallRoot;
        return DefaultInstallRoot;
    }
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
        if (!trusted && MessageBox.Show("Este pacote usa o certificado Early Access do Fila Agent. Deseja confiar neste certificado para validar as atualizacoes assinadas futuras?", "Fila Agent - certificado de teste", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            throw new OperationCanceledException("Instalacao cancelada: certificado Early Access recusado.");
        foreach (var storeName in new[] { StoreName.Root, StoreName.TrustedPublisher })
        {
            using var store = new X509Store(storeName, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadWrite);
            if (!store.Certificates.Cast<X509Certificate2>().Any(existing => existing.Thumbprint == certificate.Thumbprint)) store.Add(certificate);
        }
    }
    private static int ShowUsage() { MessageBox.Show("Instalador nativo do Fila Agent.", "Fila Agent"); return 2; }
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
                    new XElement(ns + "Description", "Inicia o Fila Agent quando este usuario entra no Windows.")),
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
        var definitionPath = Path.Combine(Path.GetTempPath(), $"FilaAgentTask-{Guid.NewGuid():N}.xml");
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
    private static void ValidateTestModeOperation(bool testMode, string[] args, string installRoot, string taskName, string? legacyTaskName, string? testDataDirectory)
    {
        if (!testMode) return;
        var installing = args.Contains("--install-package", StringComparer.OrdinalIgnoreCase);
        var uninstalling = args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase);
        var checkingUpdates = args.Contains("--check-updates", StringComparer.OrdinalIgnoreCase);
        if (!installing && !uninstalling && !checkingUpdates) return;

        var localAppData = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
        bool IsDirectTestDirectory(string path, string prefix)
        {
            var fullPath = Path.GetFullPath(path);
            return string.Equals(Path.GetDirectoryName(fullPath), localAppData, StringComparison.OrdinalIgnoreCase) &&
                   Path.GetFileName(fullPath).StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }

        if (!IsDirectTestDirectory(installRoot, "FilaAgent-E2E-"))
            throw new InvalidOperationException("Test mode only permits an isolated FilaAgent-E2E-* install directory under LocalAppData.");
        if (!taskName.StartsWith("FilaAgent_E2E_", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Test mode only permits an isolated FilaAgent_E2E_* scheduled task.");
        if (!string.IsNullOrWhiteSpace(legacyTaskName) && !legacyTaskName.StartsWith("FilaAgent_E2E_Legacy_", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Test mode legacy task name is outside the isolated E2E namespace.");
        if (args.Contains("--remove-user-data", StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException("Test mode cannot remove user data.");

        if (installing || checkingUpdates)
        {
            if (!args.Contains("--test-data-dir", StringComparer.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(testDataDirectory) ||
                !IsDirectTestDirectory(testDataDirectory, "FilaAgent-E2E-data-"))
                throw new InvalidOperationException("Test mode requires an isolated FilaAgent-E2E-data-* directory under LocalAppData.");
            var apiText = ReadArgument(args, "--api-url");
            if (!Uri.TryCreate(apiText, UriKind.Absolute, out var apiUri) || apiUri.Scheme != Uri.UriSchemeHttp || !apiUri.IsLoopback)
                throw new InvalidOperationException("Test mode requires an HTTP loopback API endpoint.");
            if (checkingUpdates && string.IsNullOrWhiteSpace(ReadArgument(args, "--test-release-api")))
                throw new InvalidOperationException("Test mode update checks require a loopback release API.");
        }
    }

    private static int? RelaunchElevatedWhenRequired(string[] args, bool testMode)
    {
        var needsTaskSchedulerAccess = args.Any(argument =>
            string.Equals(argument, "--install-package", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(argument, "--uninstall", StringComparison.OrdinalIgnoreCase));
        if (!needsTaskSchedulerAccess || testMode || new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return null;

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
    private static void DeleteTask(string taskName) => Run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"]);
    private static void StopTask(string taskName) { Run("schtasks.exe", ["/End", "/TN", taskName], false); Run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], false); }
    private static void RegisterStartupEntry(string host, string apiUrl, string localPort, string valueName = StartupValueName, string? testDataDirectory = null)
    {
        var arguments = $"\"{host}\" --api-url \"{apiUrl}\" --local-port {localPort}";
        if (testDataDirectory is not null) arguments += $" --data-dir {QuoteTaskArgument(testDataDirectory)} --test-mode";
        if (arguments.Length > 260) throw new InvalidOperationException("O caminho de instalacao excede o limite aceito pelo Windows para aplicativos de inicializacao.");
        using var key = Registry.CurrentUser.CreateSubKey(StartupRunKey);
        key!.SetValue(valueName, arguments, RegistryValueKind.String);
        if (!string.Equals(key.GetValue(valueName) as string, arguments, StringComparison.Ordinal))
            throw new IOException("O Windows nao confirmou o registro do Fila Agent na inicializacao.");
    }
    private static string GetTestStartupValueName(string taskName)
    {
        var valueName = taskName.Replace("FilaAgent_E2E_Legacy_", "FilaAgent_E2E_", StringComparison.OrdinalIgnoreCase);
        if (!valueName.StartsWith("FilaAgent_E2E_", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Test mode requires an isolated FilaAgent_E2E startup value.");
        return valueName;
    }
    private static void RemoveStartupEntry(string valueName = StartupValueName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(StartupRunKey, writable: true);
        key?.DeleteValue(valueName, throwOnMissingValue: false);
    }
    private static int Run(string file, IReadOnlyList<string> arguments, bool required = true, TimeSpan? timeout = null)
    {
        var start = new ProcessStartInfo(file) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException($"Nao foi possivel iniciar {file}.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        var timeoutMilliseconds = (int)Math.Clamp((timeout ?? TimeSpan.FromSeconds(15)).TotalMilliseconds, 1, int.MaxValue);
        if (!process.WaitForExit(timeoutMilliseconds))
        {
            process.Kill(true);
            throw new TimeoutException($"{file} nao terminou no prazo.");
        }
        var details = $"{stderr.GetAwaiter().GetResult()} {stdout.GetAwaiter().GetResult()}".Trim();
        if (required && process.ExitCode != 0) throw new InvalidOperationException($"Falha ao executar {file} (codigo {process.ExitCode}). {details}");
        return process.ExitCode;
    }
    private static void RegisterProtocol(string host) { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\printflow-agent", false); RegisterProtocolAlias(host, "fila-agent", "URL:Fila Agent Protocol"); }
    private static void RegisterProtocolAlias(string host, string scheme, string description) { using var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{scheme}"); key!.SetValue(null, description); key.SetValue("URL Protocol", ""); using var icon = key.CreateSubKey("DefaultIcon"); icon!.SetValue(null, $"{host},0"); using var command = key.CreateSubKey(@"shell\open\command"); command!.SetValue(null, $"\"{host}\" --protocol \"%1\""); }
    private static void RegisterUninstaller(string root, string version) { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent", false); using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilaAgent"); key!.SetValue("DisplayName", "Fila Agent"); key.SetValue("DisplayVersion", version); key.SetValue("Publisher", "Filamind"); key.SetValue("InstallLocation", root); key.SetValue("DisplayIcon", Path.Combine(root, "assets", "fila-agent-icon.ico")); key.SetValue("UninstallString", $"\"{ResolveInstalledSetup(root)}\" --uninstall --install-dir \"{root}\""); }
    private static void VerifyUninstallerRegistration(string root)
    {
        var setup = ResolveInstalledSetup(root);
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilaAgent");
        var expected = $"\"{setup}\" --uninstall --install-dir \"{root}\"";
        if (key is null || !File.Exists(setup) || !string.Equals(key.GetValue("UninstallString") as string, expected, StringComparison.OrdinalIgnoreCase))
            throw new IOException("O Windows nao confirmou o caminho do desinstalador do Fila Agent.");
    }
    private static string GetVersion(string package) => JsonDocument.Parse(File.ReadAllText(package)).RootElement.GetProperty("version").GetString() ?? "0.0.0";
    private static void CreateShortcuts(string host, string apiUrl, string root)
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        DeleteShortcutFile(Path.Combine(desktop, "PrintFlow Agent.lnk"));
        CreateShortcut(Path.Combine(desktop, "Fila Agent.lnk"), host, $"--api-url \"{apiUrl}\"", root);

        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        var oldMenu = Path.Combine(programs, "PrintFlow 3D");
        DeleteShortcutFile(Path.Combine(oldMenu, "PrintFlow Agent.lnk"));
        DeleteShortcutFile(Path.Combine(oldMenu, "Desinstalar PrintFlow Agent.lnk"));
        DeleteEmptyDirectory(oldMenu);

        var menu = Path.Combine(programs, "Filamind");
        Directory.CreateDirectory(menu);
        CreateShortcut(Path.Combine(menu, "Fila Agent.lnk"), host, $"--api-url \"{apiUrl}\"", root);
        CreateShortcut(Path.Combine(menu, "Desinstalar Fila Agent.lnk"), Path.Combine(root, "FilaAgentSetup.exe"), $"--uninstall --install-dir \"{root}\"", root);
    }
    private static void CreateShortcut(string path, string target, string arguments, string root) { var shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!); dynamic shortcut = shell!.GetType().InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, [path])!; shortcut.TargetPath = target; shortcut.Arguments = arguments; shortcut.WorkingDirectory = root; shortcut.IconLocation = $"{Path.Combine(root, "assets", "fila-agent-icon.ico")},0"; shortcut.Save(); }
    private static void DeleteShortcuts()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        DeleteShortcutFile(Path.Combine(desktop, "PrintFlow Agent.lnk"));
        DeleteShortcutFile(Path.Combine(desktop, "Fila Agent.lnk"));

        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        foreach (var menuName in new[] { "PrintFlow 3D", "Filamind" })
        {
            var menu = Path.Combine(programs, menuName);
            DeleteShortcutFile(Path.Combine(menu, "PrintFlow Agent.lnk"));
            DeleteShortcutFile(Path.Combine(menu, "Desinstalar PrintFlow Agent.lnk"));
            DeleteShortcutFile(Path.Combine(menu, "Fila Agent.lnk"));
            DeleteShortcutFile(Path.Combine(menu, "Desinstalar Fila Agent.lnk"));
            DeleteEmptyDirectory(menu);
        }
    }

    private static void DeleteShortcutFile(string path)
    {
        if (File.Exists(path)) File.Delete(path);
    }

    private static void DeleteEmptyDirectory(string path)
    {
        if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any()) Directory.Delete(path);
    }

    private static void DeleteDirectory(string path) { if (Directory.Exists(path)) Directory.Delete(path, true); else if (File.Exists(path)) File.Delete(path); }
    private static void CopyDirectory(string source, string target) { Directory.CreateDirectory(target); foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true); foreach (var directory in Directory.EnumerateDirectories(source)) CopyDirectory(directory, Path.Combine(target, Path.GetFileName(directory))); }

    private static void ValidateOrcaRuntime(string packageRoot, bool testMode)
    {
        if (testMode) return;

        var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["FILA_AGENT_ORCA_SLICER_PATH"] = Environment.GetEnvironmentVariable("FILA_AGENT_ORCA_SLICER_PATH"),
            ["PRINTFLOW_ORCA_SLICER_PATH"] = Environment.GetEnvironmentVariable("PRINTFLOW_ORCA_SLICER_PATH")
        };
        var executable = OrcaSlicerService.ResolveConfiguredExecutable(environment);
        if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable))
        {
            ThrowIfUnsupportedOrcaStoreVersion();
            var winget = ResolveWingetExecutable();
            Exception? wingetError = null;
            if (winget is not null)
            {
                try
                {
                    RunWithProgress("Instalando OrcaSlicer", "O Fila Agent está baixando o OrcaSlicer oficial pela Microsoft Store. Isso pode levar alguns minutos.",
                        () => Run(winget, ["install", "--id", OrcaStoreProductId, "--exact", "--source", "msstore", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity", "--silent"], timeout: TimeSpan.FromMinutes(20)));
                }
                catch (Exception error) { wingetError = error; }
            }

            executable = OrcaSlicerService.ResolveConfiguredExecutable(environment);
            if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable))
            {
                ThrowIfUnsupportedOrcaStoreVersion();
                var openStore = MessageBox.Show(
                    "O OrcaSlicer oficial é necessário para gerar G-code. A instalação automática pela Store não pôde ser concluída neste computador; o WinGet do App Installer pode estar indisponível ou ter falhado. Deseja abrir a página oficial da Microsoft Store para instalar o OrcaSlicer? Depois, volte aqui e clique em Repetir para validar.",
                    "Instalar dependência OrcaSlicer", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (openStore != DialogResult.Yes)
                    throw new InvalidOperationException("OrcaSlicer 2.4.2 não foi encontrado. A instalação do Fila Agent foi cancelada.", wingetError);

                try
                {
                    Process.Start(new ProcessStartInfo($"ms-windows-store://pdp/?ProductId={OrcaStoreProductId}") { UseShellExecute = true });
                }
                catch (Exception error)
                {
                    throw new InvalidOperationException("Não foi possível abrir a página oficial do OrcaSlicer na Microsoft Store. Instale o OrcaSlicer pelo canal oficial e tente novamente.", error);
                }

                while (true)
                {
                    var retry = MessageBox.Show(
                        "Conclua a instalação do OrcaSlicer na Microsoft Store e clique em Repetir para validar o slicer. Cancelar interrompe a instalação do Fila Agent.",
                        "Aguardando OrcaSlicer", MessageBoxButtons.RetryCancel, MessageBoxIcon.Information);
                    if (retry != DialogResult.Retry)
                        throw new InvalidOperationException("OrcaSlicer 2.4.2 não foi encontrado após a instalação pela Store.", wingetError);

                    executable = OrcaSlicerService.ResolveConfiguredExecutable(environment);
                    if (!string.IsNullOrWhiteSpace(executable) && File.Exists(executable)) break;
                    ThrowIfUnsupportedOrcaStoreVersion();
                }
            }
        }

        var input = Path.Combine(packageRoot, "assets", "slicing-smoke-cube.stl");
        if (!File.Exists(input)) throw new InvalidDataException("Modelo local de validação do OrcaSlicer ausente no pacote.");

        var temporaryRoot = Path.Combine(Path.GetTempPath(), $"fila-agent-setup-orca-{Guid.NewGuid():N}");
        var stage = "validar perfis oficiais";
        try
        {
            foreach (var model in new[] { "P1S", "P1P", "X1 Carbon", "A1", "A1 mini" })
            {
                var profile = OrcaSlicerService.ResolveOfficialProfile("Bambu Lab", model, executable);
                foreach (var path in profile.SettingsPaths.Concat(profile.FilamentPaths))
                    if (!File.Exists(path)) throw new FileNotFoundException($"Perfil oficial OrcaSlicer ausente para {model}.", path);
            }

            Directory.CreateDirectory(temporaryRoot);
            stage = "executar fatiamento local de validação";
            var output = Path.Combine(temporaryRoot, "validation.gcode");
            var p1sProfile = OrcaSlicerService.ResolveOfficialProfile("Bambu Lab", "P1S", executable);
            var artifact = new OrcaSlicerService().SliceAsync(executable, input, output, p1sProfile,
                TimeSpan.FromMinutes(2)).GetAwaiter().GetResult();

            stage = "validar G-code gerado";
            var gcode = File.ReadAllText(artifact.OutputPath);
            if (!Regex.IsMatch(gcode, @"(?m)^G[01]\s") || !Regex.IsMatch(gcode, @"(?m)^M10[49]\s"))
                throw new InvalidDataException("G-code local não contém movimentos e comandos de aquecimento esperados.");
            if (!gcode.Contains("generated by OrcaSlicer 2.4.2", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Motor OrcaSlicer difere da versão 2.4.2 validada.");
        }
        catch (Exception error)
        {
            throw new InvalidOperationException($"OrcaSlicer não passou na validação local do instalador ({stage}): {error.Message}", error);
        }
        finally
        {
            if (Directory.Exists(temporaryRoot)) Directory.Delete(temporaryRoot, recursive: true);
        }
    }

    private static void ThrowIfUnsupportedOrcaStoreVersion()
    {
        var version = OrcaSlicerService.FindUnvalidatedStorePackageVersion();
        if (version is null) return;
        throw new InvalidOperationException(
            $"OrcaSlicer Store {version} está instalado, mas ainda não foi validado com esta versão do Fila Agent. " +
            "A instalação foi interrompida sem substituir o Orca. O Agent exige um motor e perfis testados para gerar G-code.");
    }

    private static string? ResolveWingetExecutable()
    {
        var candidates = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Append(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps"));
        foreach (var directory in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var executable = Path.Combine(directory, "winget.exe");
            if (File.Exists(executable)) return executable;
        }
        return null;
    }

    private static void RunWithProgress(string title, string message, Action operation)
    {
        using var dialog = new Form
        {
            Text = title,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            ControlBox = false,
            ShowInTaskbar = true,
            ClientSize = new Size(460, 118),
            Font = new Font("Segoe UI", 9F)
        };
        var description = new Label { Text = message, Location = new Point(18, 16), Size = new Size(424, 48) };
        var progress = new ProgressBar { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 24, Location = new Point(18, 76), Size = new Size(424, 20) };
        dialog.Controls.AddRange([description, progress]);
        Exception? failure = null;
        dialog.Shown += async (_, _) =>
        {
            try { await Task.Run(operation); }
            catch (Exception error) { failure = error; }
            finally { dialog.Close(); }
        };
        dialog.ShowDialog();
        if (failure is not null) throw new InvalidOperationException("Falha ao instalar OrcaSlicer pelo Windows Package Manager.", failure);
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
                if (health is { Ok: true } && health.Version == expectedVersion && (!requirePaired || (health.Paired && health.CloudConnected))) return true;
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

    private static void StopAgentProcesses(string installRoot, string port, bool requireIdle = true)
    {
        var processes = FindAgentHostProcesses(installRoot).Concat(FindAgentNodeProcesses(installRoot)).ToList();
        if (processes.Count == 0) return;
        if (requireIdle) EnsureNoActivePrintJobs(installRoot, port);
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

    private static string ResolveInstalledHost(string installRoot) => new[] { "host/FilaAgent.exe", "host/PrintFlowAgentHost.exe" }
        .Select(relative => Path.Combine(installRoot, relative.Replace('/', Path.DirectorySeparatorChar)))
        .FirstOrDefault(File.Exists)
        ?? throw new FileNotFoundException("Executavel C# do Agent ausente na instalacao restaurada.", installRoot);

    private static string ResolveInstalledSetup(string installRoot) => new[] { "FilaAgentSetup.exe", "PrintFlowAgentSetup.exe" }
        .Select(name => Path.Combine(installRoot, name))
        .FirstOrDefault(File.Exists)
        ?? throw new FileNotFoundException("Instalador C# ausente na instalacao restaurada.", installRoot);

    private static List<Process> FindAgentHostProcesses(string installRoot) =>
        FindProcessesByExecutable("FilaAgent", Path.Combine(installRoot, "host", "FilaAgent.exe"))
            .Concat(FindProcessesByExecutable("PrintFlowAgentHost", Path.Combine(installRoot, "host", "PrintFlowAgentHost.exe")))
            .ToList();

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
