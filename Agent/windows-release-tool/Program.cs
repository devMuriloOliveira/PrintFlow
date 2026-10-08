using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using FilaAgent.ReleaseTool;

internal static class Program
{
    private const string OrcaStoreProductId = "9MV6GL23XM59";
    private const string TimestampUrl = "http://timestamp.digicert.com";
    private const string ExpectedCertificateSha256 = "AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB";

    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 0) throw new ArgumentException("Comando obrigatorio: package, validate-release, prepare-release ou publish-release.");
            switch (args[0].ToLowerInvariant())
            {
                case "package":
                    await BuildPackageAsync(ParseOptions(args.Skip(1).ToArray()));
                    return 0;
                case "validate-release":
                    await ValidateReleaseAsync(args.Skip(1).ToArray());
                    return 0;
                case "prepare-release":
                    await PrepareReleaseAsync(args.Skip(1).ToArray());
                    return 0;
                case "publish-release":
                    await PublishReleaseAsync(args.Skip(1).ToArray());
                    return 0;
                default:
                    throw new ArgumentException($"Comando desconhecido: {args[0]}");
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Falha no pacote Windows: {error.Message}");
            return 1;
        }
    }

    private static async Task BuildPackageAsync(BuildOptions options)
    {
        var agentRoot = FindAgentRoot();
        var package = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(agentRoot, "package.json")));
        var version = package.RootElement.GetProperty("version").GetString() ?? "";
        if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$"))
            throw new InvalidDataException("Versao do Agent invalida no package.json.");

        ValidateApiUrl(options.ApiUrl);
        if (options.TestPackage &&
            (!options.PackageName.Contains("test", StringComparison.OrdinalIgnoreCase) ||
             !options.InstallerName.Contains("test", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Pacotes sem validacao OrcaSlicer precisam usar nomes explicitos de teste.");

        var outputRoot = ResolveInside(agentRoot, options.OutputDirectory);
        Directory.CreateDirectory(outputRoot);
        var stageRoot = Path.Combine(outputRoot, options.PackageName);
        var zipPath = Path.Combine(outputRoot, options.PackageName + ".zip");
        var installerPath = Path.Combine(outputRoot, options.InstallerName + ".exe");
        var buildRoot = Path.Combine(outputRoot, ".build");
        var hostOutput = Path.Combine(buildRoot, "windows-host");
        var setupOutput = Path.Combine(buildRoot, "windows-setup");
        var hostProject = Path.Combine(agentRoot, "windows-host", "FilaAgent.csproj");
        var setupProject = Path.Combine(agentRoot, "windows-setup", "FilaAgentSetup.csproj");
        var dotnet = "dotnet.exe";

        ResetDirectory(buildRoot, outputRoot);
        Directory.CreateDirectory(hostOutput);
        var hostPublishArguments = new List<string>
        {
            "publish", hostProject, "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true", "--output", hostOutput,
            $"--property:Version={version}", $"--property:InformationalVersion={version}"
        };
        if (options.NoRestore) hostPublishArguments.Add("--no-restore");
        await RunRequiredAsync(dotnet,
            hostPublishArguments, agentRoot);

        var hostExecutable = Path.Combine(hostOutput, "FilaAgent.exe");
        if (!File.Exists(hostExecutable)) throw new FileNotFoundException("Executavel do host nativo nao foi gerado.", hostExecutable);
        var hostManifest = JsonSerializer.Serialize(new { agentVersion = version, hostVersion = version, executable = "FilaAgent.exe" }, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(hostOutput, "host-version.json"), hostManifest, new System.Text.UTF8Encoding(false));

        ResetDirectory(stageRoot, outputRoot);
        Directory.CreateDirectory(stageRoot);
        foreach (var directoryName in new[] { "assets", "legal" })
        {
            var source = Path.Combine(agentRoot, directoryName);
            if (Directory.Exists(source)) CopyDirectory(source, Path.Combine(stageRoot, directoryName));
        }
        CopyDirectory(hostOutput, Path.Combine(stageRoot, "host"));

        var manifest = JsonSerializer.Serialize(new
        {
            name = "fila-agent",
            version,
            runtime = ".NET 8 self-contained",
            selfContained = true
        }, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(stageRoot, "package.json"), manifest, new System.Text.UTF8Encoding(false));

        ValidateReleaseFiles(stageRoot);
        if (!options.TestPackage) await EnsureOrcaSmokeAsync(agentRoot);

        if (File.Exists(zipPath)) File.Delete(zipPath);
        ZipFile.CreateFromDirectory(stageRoot, zipPath, CompressionLevel.Optimal, includeBaseDirectory: false);

        ResetDirectory(setupOutput, agentRoot);
        var certificatePath = options.SignDev ? Path.Combine(outputRoot, "Fila-Agent-Dev-Certificate.cer") : null;
        if (options.SignDev)
            await SignAsync(agentRoot, options.CertificatePfx, certificatePath!, [hostExecutable]);

        var setupPublishArguments = new List<string>
        {
            "publish", setupProject, "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "true", "--output", setupOutput,
            $"--property:FilaAgentPackagePath={zipPath}", $"--property:Version={version}", $"--property:InformationalVersion={version}"
        };
        if (options.NoRestore) setupPublishArguments.Add("--no-restore");
        await RunRequiredAsync(dotnet, setupPublishArguments, agentRoot);

        var setupExecutable = Path.Combine(setupOutput, "FilaAgentSetup.exe");
        if (!File.Exists(setupExecutable)) throw new FileNotFoundException("Executavel nativo do instalador nao foi gerado.", setupExecutable);
        await RunRequiredAsync(setupExecutable, ["--validate-embedded-package"], agentRoot, TimeSpan.FromMinutes(1));
        if (options.SignDev) await SignAsync(agentRoot, options.CertificatePfx, certificatePath!, [setupExecutable]);
        File.Copy(setupExecutable, installerPath, overwrite: true);

        if (options.SignDev && !File.Exists(certificatePath)) throw new InvalidDataException("Certificado publico do instalador nao foi exportado.");
        Console.WriteLine($"Pacote Windows: {zipPath}");
        Console.WriteLine($"Instalador autocontido: {installerPath}");
    }

    private static BuildOptions ParseOptions(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["--api-url"] = Environment.GetEnvironmentVariable("FILA_AGENT_API_URL") ??
                Environment.GetEnvironmentVariable("PRINTFLOW_API_URL") ?? "https://printflow-api-4y5l.onrender.com",
            ["--output-dir"] = "dist",
            ["--package-name"] = "Fila-Agent-Windows",
            ["--installer-name"] = "Fila-Agent-Setup",
            ["--certificate-pfx"] = Path.Combine("certs", "PrintFlow-Agent-Dev-CodeSigning.pfx")
        };
        var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            var argument = args[index];
            if (argument.Equals("--sign-dev", StringComparison.OrdinalIgnoreCase) ||
                argument.Equals("--require-persisted-certificate", StringComparison.OrdinalIgnoreCase) ||
                argument.Equals("--test-package", StringComparison.OrdinalIgnoreCase) ||
                argument.Equals("--no-restore", StringComparison.OrdinalIgnoreCase))
            {
                flags.Add(argument);
                continue;
            }
            if (!values.ContainsKey(argument) || index + 1 >= args.Length)
                throw new ArgumentException($"Opcao de build desconhecida ou incompleta: {argument}");
            values[argument] = args[++index];
        }

        if (flags.Contains("--require-persisted-certificate") && !flags.Contains("--sign-dev"))
            throw new ArgumentException("--require-persisted-certificate exige --sign-dev.");

        return new BuildOptions(
            values["--api-url"], values["--output-dir"], values["--package-name"], values["--installer-name"], values["--certificate-pfx"],
            flags.Contains("--sign-dev"), flags.Contains("--require-persisted-certificate"), flags.Contains("--test-package"), flags.Contains("--no-restore"));
    }

    private static async Task EnsureOrcaSmokeAsync(string agentRoot)
    {
        var smokeProject = Path.Combine(agentRoot, "windows-runtime-live-smoke", "FilaAgent.OrcaStore.LiveSmoke.csproj");
        var dotnet = await RunAsync("dotnet.exe", ["run", "--project", smokeProject, "--configuration", "Release"], agentRoot, TimeSpan.FromMinutes(8));
        if (dotnet.ExitCode == 0) return;
        if (!dotnet.Details.Contains("OrcaSlicer Store validado nao foi localizado", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Smoke C# do OrcaSlicer falhou: {dotnet.Details}");

        var winget = ResolveWinget();
        if (winget is null) throw new InvalidOperationException("OrcaSlicer nao foi localizado e o WinGet nao esta disponivel. Instale o OrcaSlicer pela Microsoft Store e tente novamente.");
        await RunRequiredAsync(winget,
            ["install", "--id", OrcaStoreProductId, "--exact", "--source", "msstore", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity", "--silent"],
            agentRoot, TimeSpan.FromMinutes(20));

        var retry = await RunAsync("dotnet.exe", ["run", "--project", smokeProject, "--configuration", "Release"], agentRoot, TimeSpan.FromMinutes(8));
        if (retry.ExitCode != 0) throw new InvalidOperationException($"OrcaSlicer Store nao passou no smoke local: {retry.Details}");
    }

    private static async Task ValidateReleaseAsync(string[] args)
    {
        var agentRoot = FindAgentRoot();
        var repositoryRoot = Directory.GetParent(agentRoot)!.FullName;
        var tag = ReadOption(args, "--tag") ?? throw new ArgumentException("--tag obrigatoria.");
        var minimum = ReadOption(args, "--minimum-supported-version") ??
            Environment.GetEnvironmentVariable("FILA_AGENT_MINIMUM_SUPPORTED_VERSION") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_MINIMUM_SUPPORTED_VERSION") ?? "0.1.10";
        ValidateTagAndMinimum(tag, GetAgentVersion(agentRoot), minimum);
        await RunRequiredAsync(FindNode(), [Path.Combine("scripts", "check-agent-release-contract.mjs")], repositoryRoot);
        await RunRequiredAsync(FindNode(), [Path.Combine("scripts", "validate-agent-package.mjs")], repositoryRoot);
    }

    private static async Task PrepareReleaseAsync(string[] args)
    {
        var agentRoot = FindAgentRoot();
        var repositoryRoot = Directory.GetParent(agentRoot)!.FullName;
        var tag = ReadOption(args, "--tag") ?? throw new ArgumentException("--tag obrigatoria.");
        var minimum = ReadOption(args, "--minimum-supported-version") ??
            Environment.GetEnvironmentVariable("FILA_AGENT_MINIMUM_SUPPORTED_VERSION") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_MINIMUM_SUPPORTED_VERSION") ?? "0.1.10";
        var version = GetAgentVersion(agentRoot);
        ValidateTagAndMinimum(tag, version, minimum);

        var dist = Path.Combine(agentRoot, "dist");
        var certificatePath = Path.Combine(dist, "Fila-Agent-Dev-Certificate.cer");
        var setupPath = Path.Combine(dist, "Fila-Agent-Setup.exe");
        var legacyCertificatePath = Path.Combine(dist, "PrintFlow-Agent-Dev-Certificate.cer");
        var legacySetupPath = Path.Combine(dist, "PrintFlow-Agent-Setup.exe");
        var transitionPath = Path.Combine(dist, "Fila-Agent-Transition-Setup.exe");
        var legacyTransitionPath = Path.Combine(dist, "PrintFlow-Agent-Transition-Setup.exe");
        var zipPath = Path.Combine(dist, "Fila-Agent-Windows.zip");
        var legacyZipPath = Path.Combine(dist, "PrintFlow-Agent-Windows.zip");
        Console.WriteLine($"Diretorio de artefatos: {Path.GetFullPath(dist)}");
        foreach (var path in new[] { certificatePath, setupPath, zipPath })
            if (!File.Exists(path)) throw new FileNotFoundException($"Artefato obrigatorio ausente para preparar release: {Path.GetFullPath(path)}", path);

        File.Copy(setupPath, legacySetupPath, overwrite: true);
        File.Copy(setupPath, transitionPath, overwrite: true);
        File.Copy(transitionPath, legacyTransitionPath, overwrite: true);
        File.Copy(certificatePath, legacyCertificatePath, overwrite: true);
        File.Copy(zipPath, legacyZipPath, overwrite: true);
        using var certificate = new X509Certificate2(await File.ReadAllBytesAsync(certificatePath));
        var certificateSha256 = Convert.ToHexString(SHA256.HashData(certificate.RawData));
        if (!string.Equals(certificateSha256, ExpectedCertificateSha256, StringComparison.OrdinalIgnoreCase))
            throw new CryptographicException("Certificado publicado diverge da identidade fixada pelo atualizador.");
        await VerifySignedFileAsync(setupPath, certificate, repositoryRoot);
        await VerifySignedFileAsync(transitionPath, certificate, repositoryRoot);
        await VerifySignedFileAsync(legacySetupPath, certificate, repositoryRoot);
        await VerifySignedFileAsync(legacyTransitionPath, certificate, repositoryRoot);

        var metadata = JsonSerializer.Serialize(new
        {
            tag,
            version,
            minimumSupportedVersion = minimum,
            runtime = ".NET 8 self-contained",
            selfContained = true,
            signingMode = "DEV_SELF_SIGNED",
            productionTrusted = false,
            certificateSha256
        }, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(dist, "RELEASE-METADATA.json"), metadata, new System.Text.UTF8Encoding(false));

        var artifactNames = new[]
        {
            "Fila-Agent-Windows.zip", "Fila-Agent-Setup.exe", "Fila-Agent-Transition-Setup.exe", "Fila-Agent-Dev-Certificate.cer",
            "PrintFlow-Agent-Windows.zip", "PrintFlow-Agent-Setup.exe", "PrintFlow-Agent-Transition-Setup.exe",
            "PrintFlow-Agent-Dev-Certificate.cer", "RELEASE-METADATA.json"
        };
        var sums = new List<string>();
        foreach (var name in artifactNames)
        {
            var hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(dist, name))));
            sums.Add($"{hash}  Agent/dist/{name}");
        }
        await File.WriteAllTextAsync(Path.Combine(dist, "SHA256SUMS.txt"), string.Join(Environment.NewLine, sums) + Environment.NewLine, new System.Text.UTF8Encoding(false));
        await RunRequiredAsync(FindNode(), [Path.Combine("scripts", "validate-agent-release-artifacts.mjs"), $"--dist={dist}"], repositoryRoot);
    }

    private static async Task PublishReleaseAsync(string[] args)
    {
        var agentRoot = FindAgentRoot();
        var repositoryRoot = Directory.GetParent(agentRoot)!.FullName;
        var tag = ReadOption(args, "--tag") ?? throw new ArgumentException("--tag obrigatoria.");
        var repository = ReadOption(args, "--repository") ?? Environment.GetEnvironmentVariable("GITHUB_REPOSITORY") ?? "";
        if (string.IsNullOrWhiteSpace(repository) || !System.Text.RegularExpressions.Regex.IsMatch(repository, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"))
            throw new ArgumentException("--repository deve usar owner/repository.");
        var testCase = ReadOption(args, "--test-case");
        if (testCase is not null && !args.Contains("--test-mode", StringComparer.OrdinalIgnoreCase))
            throw new ArgumentException("--test-case somente pode ser usado com --test-mode.");

        var release = await RunGhAsync(["release", "view", tag, "--repo", repository, "--json", "tagName,isDraft,assets"], repositoryRoot, testCase);
        if (release.ExitCode == 0)
        {
            using var document = JsonDocument.Parse(release.Details);
            var root = document.RootElement;
            if (!string.Equals(root.GetProperty("tagName").GetString(), tag, StringComparison.Ordinal) || root.GetProperty("isDraft").GetBoolean())
                throw new InvalidOperationException("Release existente nao esta publicada com a tag esperada.");
            var names = root.GetProperty("assets").EnumerateArray().Select(asset => asset.GetProperty("name").GetString() ?? "").ToHashSet(StringComparer.OrdinalIgnoreCase);
            var currentAssets = ReleaseAssetNames();
            var legacyAssets = LegacyReleaseAssetNames();
            var requiredAssets = currentAssets.All(names.Contains)
                ? currentAssets
                : legacyAssets.All(names.Contains) ? legacyAssets : null;
            if (requiredAssets is null)
                throw new InvalidOperationException("Release existente incompleta: faltam artefatos Fila Agent ou o conjunto legado PrintFlow.");

            var tempRoot = Path.Combine(Path.GetTempPath(), "FilaAgent-existing-release-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(tempRoot);
                var downloadArguments = new List<string> { "release", "download", tag, "--repo", repository, "--dir", tempRoot };
                foreach (var name in requiredAssets) { downloadArguments.Add("--pattern"); downloadArguments.Add(name); }
                var download = await RunGhAsync(downloadArguments, repositoryRoot, testCase);
                if (download.ExitCode != 0) throw new InvalidOperationException("Nao foi possivel verificar os artefatos da release existente.");

                using var metadata = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(tempRoot, "RELEASE-METADATA.json")));
                var version = tag[7..];
                if (metadata.RootElement.GetProperty("tag").GetString() != tag || metadata.RootElement.GetProperty("version").GetString() != version)
                    throw new InvalidDataException("Manifesto da release existente diverge da tag.");
                await RunRequiredAsync(FindNode(), [Path.Combine("scripts", "validate-agent-release-artifacts.mjs"), $"--dist={tempRoot}"], repositoryRoot);
                var setupName = File.Exists(Path.Combine(tempRoot, "Fila-Agent-Setup.exe")) ? "Fila-Agent-Setup.exe" : "PrintFlow-Agent-Setup.exe";
                var certificateName = File.Exists(Path.Combine(tempRoot, "Fila-Agent-Dev-Certificate.cer")) ? "Fila-Agent-Dev-Certificate.cer" : "PrintFlow-Agent-Dev-Certificate.cer";
                using var certificate = new X509Certificate2(await File.ReadAllBytesAsync(Path.Combine(tempRoot, certificateName)));
                await VerifySignedFileAsync(Path.Combine(tempRoot, setupName), certificate, repositoryRoot);
                foreach (var transitionName in new[] { "Fila-Agent-Transition-Setup.exe", "PrintFlow-Agent-Transition-Setup.exe" })
                {
                    var transitionSetup = Path.Combine(tempRoot, transitionName);
                    if (File.Exists(transitionSetup)) await VerifySignedFileAsync(transitionSetup, certificate, repositoryRoot);
                }
                Console.WriteLine($"Release {tag} ja publicada e validada; artefatos preservados.");
                return;
            }
            finally
            {
                var tempBase = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                var absoluteTemp = Path.GetFullPath(tempRoot);
                if (!absoluteTemp.StartsWith(tempBase, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Diretorio temporario inesperado; limpeza bloqueada.");
                if (Directory.Exists(absoluteTemp)) Directory.Delete(absoluteTemp, recursive: true);
            }
        }

        if (!release.Details.Contains("release not found", StringComparison.OrdinalIgnoreCase) &&
            !release.Details.Contains("http 404", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Nao foi possivel consultar a release; publicacao cancelada.");

        var dist = Path.Combine(agentRoot, "dist");
        var artifactPaths = ReleaseAssetNames().Select(name => Path.Combine(dist, name)).ToArray();
        if (testCase is null)
            foreach (var artifact in artifactPaths)
                if (!File.Exists(artifact)) throw new FileNotFoundException("Artefato para publicacao ausente.", artifact);
        var createArguments = new List<string> { "release", "create", tag };
        createArguments.AddRange(artifactPaths);
        createArguments.AddRange(["--repo", repository, "--verify-tag", "--title", $"Fila Agent {tag} - Early Access / Pilot", "--notes",
            "Assinatura Early Access com certificado de desenvolvimento Fila Agent. As instalações anteriores continuam compatíveis durante a transição; o certificado de assinatura permanece o mesmo para permitir atualização das versões já instaladas. PRODUCTION_TRUSTED permanece pendente de certificado Code Signing confiável."]);
        var created = await RunGhAsync(createArguments, repositoryRoot, testCase);
        if (created.ExitCode != 0) throw new InvalidOperationException($"Publicacao da release falhou: {created.Details}");
        Console.WriteLine(created.Details);
    }

    private static async Task<CommandResult> RunGhAsync(IReadOnlyList<string> arguments, string workingDirectory, string? testCase)
    {
        if (testCase is null)
        {
            var gh = FindOnPath("gh.exe") ?? FindOnPath("gh") ?? throw new FileNotFoundException("GitHub CLI gh nao encontrado no PATH.");
            return await RunAsync(gh, arguments, workingDirectory, TimeSpan.FromMinutes(5));
        }

        var operation = arguments.Count > 1 ? arguments[1] : "";
        if (operation == "view")
        {
            if (testCase == "missing") return new CommandResult(1, "release not found");
            if (testCase == "lookup_failure") return new CommandResult(1, "HTTP 403");
            var assets = testCase == "incomplete" ? new[] { "PrintFlow-Agent-Windows.zip" } : ReleaseAssetNames();
            var json = JsonSerializer.Serialize(new { tagName = "agent-v0.1.22", isDraft = testCase == "draft", assets = assets.Select(name => new { name }) });
            return new CommandResult(0, json);
        }
        if (operation == "download" && testCase == "download_failure") return new CommandResult(1, "DOWNLOAD_FAILED");
        if (operation == "create")
            return new CommandResult(0, "CREATE_CALLED " + string.Join(" ", arguments.Skip(3).TakeWhile(argument => argument != "--repo").Select(Path.GetFileName)));
        return new CommandResult(1, "Unexpected gh operation");
    }

    private static async Task VerifySignedFileAsync(string filePath, X509Certificate2 expectedCertificate, string workingDirectory)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException("Arquivo assinado ausente.", filePath);
        using var rawSigner = X509Certificate.CreateFromSignedFile(filePath);
        using var signer = new X509Certificate2(rawSigner);
        var expectedSha256 = Convert.ToHexString(SHA256.HashData(expectedCertificate.RawData));
        var signerSha256 = Convert.ToHexString(SHA256.HashData(signer.RawData));
        if (!string.Equals(expectedSha256, signerSha256, StringComparison.OrdinalIgnoreCase))
            throw new CryptographicException($"Assinante diverge do certificado publicado: {Path.GetFileName(filePath)}.");

        var verify = await RunAsync(FindSignTool(), ["verify", "/pa", "/v", filePath], workingDirectory, TimeSpan.FromMinutes(2));
        var details = verify.Details;
        if (!AuthenticodeVerificationPolicy.IsAcceptable(verify.ExitCode, details))
            throw new CryptographicException($"Assinatura Authenticode invalida: {Path.GetFileName(filePath)}.");
        if (verify.ExitCode != 0) Console.Error.WriteLine($"Aviso: a cadeia do certificado Early Access nao e confiavel automaticamente neste computador ({Path.GetFileName(filePath)}).");
    }

    private static void ValidateTagAndMinimum(string tag, string version, string minimum)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(tag, @"^agent-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$"))
            throw new InvalidOperationException("Tag do Agent invalida.");
        if (!string.Equals(tag[7..], version, StringComparison.Ordinal))
            throw new InvalidOperationException($"Tag {tag[7..]} diverge da versao do Agent {version}.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(minimum, @"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$"))
            throw new InvalidOperationException("FILA_AGENT_MINIMUM_SUPPORTED_VERSION deve ser SemVer.");
    }

    private static string GetAgentVersion(string agentRoot)
    {
        using var package = JsonDocument.Parse(File.ReadAllText(Path.Combine(agentRoot, "package.json")));
        return package.RootElement.GetProperty("version").GetString() ?? throw new InvalidDataException("Versao do package.json ausente.");
    }

    private static string? ReadOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index++)
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        return null;
    }

    private static string[] ReleaseAssetNames() =>
    ["Fila-Agent-Windows.zip", "Fila-Agent-Setup.exe", "Fila-Agent-Transition-Setup.exe", "Fila-Agent-Dev-Certificate.cer", .. LegacyReleaseAssetNames()];

    private static string[] LegacyReleaseAssetNames() =>
    ["PrintFlow-Agent-Windows.zip", "PrintFlow-Agent-Setup.exe", "PrintFlow-Agent-Transition-Setup.exe", "PrintFlow-Agent-Dev-Certificate.cer", "RELEASE-METADATA.json", "SHA256SUMS.txt"];

    private static async Task SignAsync(string agentRoot, string pfxPath, string certificateOutput, IReadOnlyList<string> files)
    {
        var absolutePfx = ResolveInside(agentRoot, pfxPath);
        string? temporaryPfx = null;
        if (!File.Exists(absolutePfx))
        {
            var encoded = Environment.GetEnvironmentVariable("FILA_AGENT_DEV_CERT_PFX_BASE64") ??
                Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_DEV_CERT_PFX_BASE64");
            if (string.IsNullOrWhiteSpace(encoded)) throw new FileNotFoundException("PFX persistido obrigatorio para assinar o pacote.", absolutePfx);
            byte[] pfxBytes;
            try { pfxBytes = Convert.FromBase64String(encoded); }
            catch (FormatException error) { throw new CryptographicException("FILA_AGENT_DEV_CERT_PFX_BASE64 nao contem um PFX Base64 valido.", error); }
            temporaryPfx = Path.Combine(Path.GetTempPath(), $"FilaAgentSigning-{Guid.NewGuid():N}.pfx");
            await File.WriteAllBytesAsync(temporaryPfx, pfxBytes);
            absolutePfx = temporaryPfx;
        }

        try
        {
            await SignWithPfxAsync(agentRoot, absolutePfx, certificateOutput, files);
        }
        finally
        {
            if (temporaryPfx is not null) try { File.Delete(temporaryPfx); } catch { }
        }
    }

    private static async Task SignWithPfxAsync(string agentRoot, string absolutePfx, string certificateOutput, IReadOnlyList<string> files)
    {
        var password = Environment.GetEnvironmentVariable("FILA_AGENT_DEV_CERT_PASSWORD") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_DEV_CERT_PASSWORD");
        if (!File.Exists(absolutePfx)) throw new FileNotFoundException("PFX persistido obrigatorio para assinar o pacote.", absolutePfx);
        if (string.IsNullOrEmpty(password)) throw new InvalidOperationException("Defina FILA_AGENT_DEV_CERT_PASSWORD para abrir o PFX persistido.");

        using var certificate = new X509Certificate2(absolutePfx, password,
            X509KeyStorageFlags.UserKeySet | X509KeyStorageFlags.PersistKeySet | X509KeyStorageFlags.Exportable);
        if (!certificate.HasPrivateKey || certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow)
            throw new CryptographicException("O PFX nao possui chave privada de assinatura valida.");
        var sha256 = Convert.ToHexString(SHA256.HashData(certificate.RawData));
        if (!string.Equals(sha256, ExpectedCertificateSha256, StringComparison.OrdinalIgnoreCase))
            throw new CryptographicException("O certificado PFX nao corresponde a identidade fixada pelo atualizador.");
        var canCodeSign = certificate.Extensions.OfType<X509EnhancedKeyUsageExtension>()
            .SelectMany(extension => extension.EnhancedKeyUsages.Cast<System.Security.Cryptography.Oid>())
            .Any(oid => oid.Value == "1.3.6.1.5.5.7.3.3");
        if (!canCodeSign) throw new CryptographicException("Certificado PFX sem uso de assinatura de codigo.");

        Directory.CreateDirectory(Path.GetDirectoryName(certificateOutput)!);
        await File.WriteAllBytesAsync(certificateOutput, certificate.Export(X509ContentType.Cert));
        var signTool = FindSignTool();
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadWrite);
        var installed = store.Certificates.Find(X509FindType.FindByThumbprint, certificate.Thumbprint, validOnly: false)
            .Cast<X509Certificate2>().FirstOrDefault(item => item.HasPrivateKey);
        var importedForBuild = installed is null;
        var signingCertificate = installed ?? certificate;
        if (importedForBuild) store.Add(certificate);
        if (importedForBuild)
            signingCertificate = store.Certificates.Find(X509FindType.FindByThumbprint, certificate.Thumbprint, validOnly: false)
                .Cast<X509Certificate2>().First(item => item.HasPrivateKey);

        try
        {
            foreach (var file in files)
            {
                if (!File.Exists(file)) throw new FileNotFoundException("Binario para assinatura ausente.", file);
                await RunRequiredAsync(signTool,
                    ["sign", "/sha1", certificate.Thumbprint, "/fd", "SHA256", "/tr", TimestampUrl, "/td", "SHA256", file], agentRoot, TimeSpan.FromMinutes(3));
                await VerifySignedFileAsync(file, signingCertificate, agentRoot);
            }
        }
        finally
        {
            if (importedForBuild) store.Remove(signingCertificate);
        }
    }

    private static string FindSignTool()
    {
        var inPath = FindOnPath("signtool.exe");
        if (inPath is not null) return inPath;
        var kitsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Windows Kits", "10", "bin");
        if (Directory.Exists(kitsRoot))
        {
            var candidate = Directory.EnumerateFiles(kitsRoot, "signtool.exe", SearchOption.AllDirectories)
                .Where(path => path.EndsWith(Path.Combine("x64", "signtool.exe"), StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
            if (candidate is not null) return candidate;
        }
        throw new FileNotFoundException("signtool.exe nao encontrado. Instale Windows SDK Signing Tools for Desktop Apps.");
    }

    private static string FindNode() => FindOnPath("node.exe") ?? FindOnPath("node") ?? "node.exe";

    private static string? ResolveWinget()
    {
        var fromPath = FindOnPath("winget.exe");
        if (fromPath is not null) return fromPath;
        var localApps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "winget.exe");
        return File.Exists(localApps) ? localApps : null;
    }

    private static string? FindOnPath(string executable)
    {
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var path = Path.Combine(directory, executable);
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static void ValidateReleaseFiles(string stageRoot)
    {
        var forbidden = Directory.EnumerateFiles(stageRoot, "*", SearchOption.AllDirectories)
            .Where(path => Path.GetFileName(path).Equals("node.exe", StringComparison.OrdinalIgnoreCase) ||
                           new[] { ".node", ".ps1", ".psm1", ".vbs" }.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase))
            .ToArray();
        if (forbidden.Length > 0) throw new InvalidDataException("Pacote C# inclui arquivos legados: " + string.Join(", ", forbidden));

        var legalRoot = Path.Combine(stageRoot, "legal");
        var requiredLegalFiles = new[]
        {
            "THIRD-PARTY-NOTICES.txt",
            Path.Combine("third-party", "DOTNET-THIRD-PARTY-NOTICES.txt"),
            Path.Combine("third-party", "LICENSE-APACHE-2.0.txt"),
            Path.Combine("third-party", "LICENSE-BouncyCastle.txt"),
            Path.Combine("third-party", "LICENSE-DotNet-MIT.txt"),
            Path.Combine("third-party", "LICENSE-DotNet-Runtime.txt"),
            Path.Combine("third-party", "LICENSE-FluentFTP.txt"),
            Path.Combine("third-party", "LICENSE-MQTTnet.txt"),
            Path.Combine("third-party", "NOTICE-SQLitePCLRaw.txt")
        };
        var missingLegalFiles = requiredLegalFiles
            .Select(relative => Path.Combine(legalRoot, relative))
            .Where(path => !File.Exists(path))
            .ToArray();
        if (missingLegalFiles.Length > 0)
            throw new InvalidDataException("Pacote C# sem avisos/licencas de dependencias: " + string.Join(", ", missingLegalFiles));
        var notices = File.ReadAllText(Path.Combine(legalRoot, "THIRD-PARTY-NOTICES.txt"));
        if (!notices.Contains("OrcaSlicer is not included", StringComparison.Ordinal) ||
            !notices.Contains("SQLitePCLRaw.lib.e_sqlite3 2.1.12", StringComparison.Ordinal))
            throw new InvalidDataException("Aviso de licenca nao identifica corretamente OrcaSlicer e SQLitePCLRaw.");
    }

    private static void ValidateApiUrl(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || uri.IsLoopback ||
            uri.Host.Equals("0.0.0.0", StringComparison.OrdinalIgnoreCase) || uri.Host.Equals("::1", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("O pacote exige PRINTFLOW_API_URL HTTPS publico; localhost nao pode ser empacotado como Production.");
    }

    private static string FindAgentRoot()
    {
        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
        {
            var directory = new DirectoryInfo(Path.GetFullPath(start));
            while (directory is not null)
            {
                if (File.Exists(Path.Combine(directory.FullName, "windows-host", "FilaAgent.csproj")) &&
                    File.Exists(Path.Combine(directory.FullName, "package.json"))) return directory.FullName;
                directory = directory.Parent;
            }
        }
        throw new DirectoryNotFoundException("Nao foi possivel localizar a pasta Agent a partir do diretorio atual.");
    }

    private static string ResolveInside(string root, string path)
    {
        var absoluteRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var absolute = Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(root, path));
        if (!absolute.StartsWith(absoluteRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Caminho de saida deve permanecer dentro da pasta Agent.");
        return absolute;
    }

    private static void ResetDirectory(string path, string root)
    {
        var absoluteRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var absolute = Path.GetFullPath(path);
        if (!absolute.StartsWith(absoluteRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Recusa limpar uma pasta fora do destino configurado.");
        if (Directory.Exists(absolute)) Directory.Delete(absolute, recursive: true);
        Directory.CreateDirectory(absolute);
    }

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), overwrite: true);
        foreach (var directory in Directory.EnumerateDirectories(source)) CopyDirectory(directory, Path.Combine(target, Path.GetFileName(directory)));
    }

    private static async Task RunRequiredAsync(string executable, IReadOnlyList<string> arguments, string workingDirectory, TimeSpan? timeout = null)
    {
        var result = await RunAsync(executable, arguments, workingDirectory, timeout);
        if (result.ExitCode != 0) throw new InvalidOperationException($"{Path.GetFileName(executable)} terminou com codigo {result.ExitCode}. {result.Details}");
    }

    private static async Task<CommandResult> RunAsync(string executable, IReadOnlyList<string> arguments, string workingDirectory, TimeSpan? timeout = null)
    {
        var start = new ProcessStartInfo(executable)
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException($"Nao foi possivel iniciar {executable}.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var cancellation = new CancellationTokenSource(timeout ?? TimeSpan.FromMinutes(10));
        try { await process.WaitForExitAsync(cancellation.Token); }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException($"{Path.GetFileName(executable)} excedeu o limite de execucao.");
        }
        var details = $"{await stdout} {await stderr}".Trim();
        if (details.Length > 0) Console.WriteLine(details);
        return new CommandResult(process.ExitCode, details);
    }

    private sealed record BuildOptions(string ApiUrl, string OutputDirectory, string PackageName, string InstallerName, string CertificatePfx, bool SignDev, bool RequirePersistedCertificate, bool TestPackage, bool NoRestore);
    private sealed record CommandResult(int ExitCode, string Details);
}
