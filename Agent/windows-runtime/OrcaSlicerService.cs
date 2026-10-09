using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace FilaAgent.Runtime;

public sealed record OrcaProfile(string Id, string Version, IReadOnlyList<string> SettingsPaths, IReadOnlyList<string> FilamentPaths, string Sha256 = "");
public sealed record OrcaProcessResult(int ExitCode, string Stdout, string Stderr);
public sealed record OrcaSliceArtifact(string Format, string OutputPath, string Sha256, long SizeBytes, OrcaProfile Profile, string Stdout, string Stderr);
public sealed record OrcaSliceModelResult(OrcaModelAnalysis Analysis, OrcaProfile Profile, OrcaSliceArtifact Artifact, OrcaGcodeMetrics Metrics);

public interface IExternalProcessRunner
{
    Task<OrcaProcessResult> RunAsync(ProcessStartInfo startInfo, TimeSpan timeout, CancellationToken cancellationToken = default);
}

public sealed class ExternalProcessRunner : IExternalProcessRunner
{
    public async Task<OrcaProcessResult> RunAsync(ProcessStartInfo startInfo, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        if (!process.Start()) throw new InvalidOperationException("Nao foi possivel iniciar o OrcaSlicer.");
        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(timeoutSource.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            await process.WaitForExitAsync(CancellationToken.None);
            if (cancellationToken.IsCancellationRequested) throw;
            throw new TimeoutException($"OrcaSlicer excedeu o timeout de {timeout.TotalMilliseconds:0} ms.");
        }
        return new OrcaProcessResult(process.ExitCode, await stdoutTask, await stderrTask);
    }
}

public sealed class OrcaSlicerService(IExternalProcessRunner? processRunner = null)
{
    private const string StorePackageFamily = "OrcaSlicer.OrcaSlicer_";
    private const string KnownStorePackageVersion = "2.4.3.0";
    private const string StorePackageSuffix = "_x64__3qd7h69xpne0g";
    private const string StorePackageFamilyName = "OrcaSlicer.OrcaSlicer_3qd7h69xpne0g";
    private const string StoreEngineVersion = "2.4.2";
    private readonly IExternalProcessRunner _processRunner = processRunner ?? new ExternalProcessRunner();
    private static readonly IReadOnlyDictionary<string, (string Id, string Machine, string Process, string Filament)> Profiles =
        new Dictionary<string, (string, string, string, string)>(StringComparer.OrdinalIgnoreCase)
        {
            ["bambu lab p1s"] = ("bambu-p1s-pla-basic", "Bambu Lab P1S", "0.20mm Standard @BBL X1C.json", "Bambu PLA Basic @BBL X1C.json"),
            ["bambu lab p1p"] = ("bambu-p1p-pla-basic", "Bambu Lab P1P", "0.20mm Standard @BBL P1P.json", "Bambu PLA Basic @BBL X1C.json"),
            ["bambu lab x1 carbon"] = ("bambu-x1-carbon-pla-basic", "Bambu Lab X1 Carbon", "0.20mm Standard @BBL X1C.json", "Bambu PLA Basic @BBL X1C.json"),
            ["bambu lab a1"] = ("bambu-a1-pla-basic", "Bambu Lab A1", "0.20mm Standard @BBL A1.json", "Bambu PLA Basic @BBL A1.json"),
            ["bambu lab a1 mini"] = ("bambu-a1-mini-pla-basic", "Bambu Lab A1 mini", "0.20mm Standard @BBL A1M.json", "Bambu PLA Basic @BBL A1M.json")
        };

    public static string ResolveConfiguredExecutable(IReadOnlyDictionary<string, string?> environment, string? programFiles = null)
    {
        var configured = FirstNonBlank(environment.GetValueOrDefault("FILA_AGENT_ORCA_SLICER_PATH"), environment.GetValueOrDefault("PRINTFLOW_ORCA_SLICER_PATH"));
        if (configured.Length > 0) return Path.GetFullPath(configured);
        var installedVersion = ReadRegisteredStoreEngineVersion();
        var installRoot = Path.Combine(programFiles ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "OrcaSlicer");
        var registeredExecutable = ResolveRegisteredDesktopExecutable(installRoot, installedVersion);
        if (registeredExecutable.Length > 0) return registeredExecutable;

        if (programFiles is null)
        {
            foreach (var packageFullName in GetStorePackageFullNames()
                .Select(name => (Name: name, Valid: TryParseStorePackageFullName(name, out var version), Version: version))
                .Where(item => item.Valid)
                .OrderByDescending(item => item.Version)
                .Select(item => item.Name))
            {
                var packagePath = GetStorePackagePath(packageFullName);
                var packageExecutable = string.IsNullOrWhiteSpace(packagePath) ? string.Empty : Path.Combine(packagePath, "orca-slicer.exe");
                if (File.Exists(packageExecutable)) return packageExecutable;
            }
            return string.Empty;
        }

        var windowsApps = Path.Combine(programFiles ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsApps");
        try
        {
            foreach (var package in Directory.EnumerateDirectories(windowsApps)
                .Select(path => (Path: path, Name: Path.GetFileName(path)))
                .Where(item => TryParseStorePackageFullName(item.Name, out _))
                .Select(item => (item.Path, Version: ParseStorePackageVersion(Path.GetFileName(item.Path))))
                .OrderByDescending(item => item.Version))
            {
                var executable = Path.Combine(package.Path, "orca-slicer.exe");
                if (File.Exists(executable)) return executable;
            }
        }
        catch (UnauthorizedAccessException) { }
        catch (IOException) { }
        catch (System.Security.SecurityException) { }
        return string.Empty;
    }

    public static string? FindUnvalidatedStorePackageVersion(string? programFiles = null)
    {
        if (programFiles is null)
            return FindUnvalidatedStorePackageVersion(GetStorePackageFullNames());

        var windowsApps = Path.Combine(programFiles ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsApps");
        if (!Directory.Exists(windowsApps)) return null;

        Version? newestVersion = null;
        try
        {
            foreach (var directory in Directory.EnumerateDirectories(windowsApps))
            {
                var name = Path.GetFileName(directory);
                if (!name.StartsWith(StorePackageFamily, StringComparison.OrdinalIgnoreCase) ||
                    !name.EndsWith(StorePackageSuffix, StringComparison.OrdinalIgnoreCase)) continue;

                var versionText = name[StorePackageFamily.Length..^StorePackageSuffix.Length];
                if (!Version.TryParse(versionText, out var version) ||
                    string.Equals(version.ToString(), KnownStorePackageVersion, StringComparison.Ordinal) ||
                    !File.Exists(Path.Combine(directory, "orca-slicer.exe"))) continue;
                if (newestVersion is null || version > newestVersion) newestVersion = version;
            }
        }
        catch (UnauthorizedAccessException) { }
        catch (IOException) { }
        catch (System.Security.SecurityException) { }

        return newestVersion?.ToString();
    }

    public static string? FindUnvalidatedStorePackageVersion(IEnumerable<string> packageFullNames)
    {
        ArgumentNullException.ThrowIfNull(packageFullNames);
        Version? newestVersion = null;
        foreach (var packageFullName in packageFullNames)
        {
            if (!TryParseStorePackageFullName(packageFullName, out var version) ||
                string.Equals(version.ToString(), KnownStorePackageVersion, StringComparison.Ordinal)) continue;
            if (newestVersion is null || version > newestVersion) newestVersion = version;
        }
        return newestVersion?.ToString();
    }

    private static IReadOnlyList<string> GetStorePackageFullNames()
    {
        if (!OperatingSystem.IsWindows()) return [];
        try
        {
            uint count = 0;
            uint bufferLength = 0;
            var result = GetPackagesByPackageFamily(StorePackageFamilyName, ref count, IntPtr.Zero, ref bufferLength, IntPtr.Zero);
            if (count == 0) return [];
            if (result != ErrorInsufficientBuffer || bufferLength == 0) return [];

            var namesSize = checked((int)count * IntPtr.Size);
            var bufferSize = checked((int)bufferLength * sizeof(char));
            var names = Marshal.AllocHGlobal(namesSize);
            var buffer = Marshal.AllocHGlobal(bufferSize);
            try
            {
                result = GetPackagesByPackageFamily(StorePackageFamilyName, ref count, names, ref bufferLength, buffer);
                if (result != ErrorSuccess) return [];

                var packageNames = new List<string>(checked((int)count));
                for (var index = 0; index < count; index++)
                {
                    var namePointer = Marshal.ReadIntPtr(names, checked((int)index * IntPtr.Size));
                    var packageName = Marshal.PtrToStringUni(namePointer);
                    if (!string.IsNullOrWhiteSpace(packageName)) packageNames.Add(packageName);
                }
                return packageNames;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
                Marshal.FreeHGlobal(names);
            }
        }
        catch (DllNotFoundException) { return []; }
        catch (EntryPointNotFoundException) { return []; }
        catch (OverflowException) { return []; }
    }

    private static string GetStorePackagePath(string packageFullName)
    {
        uint pathLength = 0;
        var result = GetPackagePathByFullName(packageFullName, ref pathLength, IntPtr.Zero);
        if (result != ErrorInsufficientBuffer || pathLength == 0) return string.Empty;
        var path = Marshal.AllocHGlobal(checked((int)pathLength * sizeof(char)));
        try
        {
            result = GetPackagePathByFullName(packageFullName, ref pathLength, path);
            return result == ErrorSuccess ? Marshal.PtrToStringUni(path) ?? string.Empty : string.Empty;
        }
        finally { Marshal.FreeHGlobal(path); }
    }

    private static bool TryParseStorePackageFullName(string? packageFullName, out Version version)
    {
        version = new Version(0, 0);
        if (string.IsNullOrWhiteSpace(packageFullName) ||
            !packageFullName.StartsWith(StorePackageFamily, StringComparison.OrdinalIgnoreCase) ||
            !packageFullName.EndsWith(StorePackageSuffix, StringComparison.OrdinalIgnoreCase)) return false;
        var versionText = packageFullName[StorePackageFamily.Length..^StorePackageSuffix.Length];
        if (!Version.TryParse(versionText, out var parsedVersion) || parsedVersion is null) return false;
        version = parsedVersion;
        return true;
    }

    private static Version ParseStorePackageVersion(string packageFullName)
    {
        if (!TryParseStorePackageFullName(packageFullName, out var version))
            throw new InvalidDataException("Nome de pacote OrcaSlicer Store inválido.");
        return version;
    }

    private const int ErrorSuccess = 0;
    private const int ErrorInsufficientBuffer = 122;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetPackagesByPackageFamily(string packageFamilyName, ref uint count,
        IntPtr packageFullNames, ref uint bufferLength, IntPtr buffer);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetPackagePathByFullName(string packageFullName, ref uint pathLength, IntPtr path);

    public static string ResolveRegisteredDesktopExecutable(string installRoot, string? installedVersion)
    {
        if (!string.Equals(installedVersion, StoreEngineVersion, StringComparison.Ordinal)) return string.Empty;
        var root = Path.GetFullPath(Required(installRoot, nameof(installRoot)));
        var executable = Path.Combine(root, "orca-slicer.exe");
        var mainLibrary = Path.Combine(root, "OrcaSlicer.dll");
        var profileDirectory = Path.Combine(root, "resources", "profiles", "BBL");
        return File.Exists(executable) && File.Exists(mainLibrary) && Directory.Exists(profileDirectory) ? executable : string.Empty;
    }

    private static string? ReadRegisteredStoreEngineVersion()
    {
        if (!OperatingSystem.IsWindows()) return null;
        var uninstallKeys = new[]
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        };
        foreach (var registryRoot in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            foreach (var uninstallPath in uninstallKeys)
            {
                using var uninstall = registryRoot.OpenSubKey(uninstallPath);
                if (uninstall is null) continue;
                foreach (var name in uninstall.GetSubKeyNames())
                {
                    using var application = uninstall.OpenSubKey(name);
                    if (!string.Equals(application?.GetValue("DisplayName") as string, "OrcaSlicer", StringComparison.OrdinalIgnoreCase) ||
                        !string.Equals(application?.GetValue("Publisher") as string, "SoftFever", StringComparison.OrdinalIgnoreCase)) continue;
                    var version = application?.GetValue("DisplayVersion") as string;
                    if (string.Equals(version, StoreEngineVersion, StringComparison.Ordinal)) return version;
                }
            }
        }
        return null;
    }

    public static OrcaProfile ResolveOfficialProfile(string manufacturer, string model, string executablePath, string version = "2.4.2", string nozzle = "0.4")
    {
        var key = NormalizePrinterKey(manufacturer, model);
        if (!Profiles.TryGetValue(key, out var preset)) throw new InvalidOperationException($"Perfil OrcaSlicer oficial nao cadastrado para: {key}.");
        var resources = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(executablePath))!, "resources", "profiles", "BBL");
        return new OrcaProfile(preset.Id, version,
            [Path.Combine(resources, "machine", $"{preset.Machine} {nozzle} nozzle.json"), Path.Combine(resources, "process", preset.Process)],
            [Path.Combine(resources, "filament", preset.Filament)]);
    }

    public static string NormalizePrinterKey(string manufacturer, string model) =>
        Regex.Replace($"{manufacturer} {model}".Trim().ToLowerInvariant(), "\\s+", " ");

    public static IReadOnlyList<string> BuildArguments(string inputPath, string outputPath, OrcaProfile profile, bool exportGcode3mf = false)
    {
        var input = Path.GetFullPath(Required(inputPath, nameof(inputPath)));
        var output = Path.GetFullPath(Required(outputPath, nameof(outputPath)));
        if (exportGcode3mf && !output.EndsWith(".gcode.3mf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("O caminho de exportacao Bambu deve terminar em .gcode.3mf.");
        if (profile.SettingsPaths.Count == 0) throw new InvalidOperationException("profile.settingsPaths e obrigatorio.");
        var args = new List<string> { input, "--slice", "0", "--load-settings", string.Join(';', profile.SettingsPaths.Select(Path.GetFullPath)) };
        if (profile.FilamentPaths.Count > 0)
        {
            args.Add("--load-filaments");
            args.Add(string.Join(';', profile.FilamentPaths.Select(Path.GetFullPath)));
        }
        if (exportGcode3mf)
        {
            args.Add("--export-3mf");
            args.Add(Path.GetFileName(output));
            args.Add("--min-save");
        }
        args.Add("--outputdir");
        args.Add(Path.GetDirectoryName(output)!);
        return args;
    }

    public async Task<OrcaSliceArtifact> SliceAsync(string executablePath, string inputPath, string outputPath, OrcaProfile profile,
        TimeSpan? timeout = null, CancellationToken cancellationToken = default, bool exportGcode3mf = false)
    {
        var executable = Path.GetFullPath(Required(executablePath, nameof(executablePath)));
        var input = Path.GetFullPath(Required(inputPath, nameof(inputPath)));
        var output = Path.GetFullPath(Required(outputPath, nameof(outputPath)));
        if (!File.Exists(executable)) throw new FileNotFoundException("Executavel OrcaSlicer nao encontrado.", executable);
        if (!File.Exists(input)) throw new FileNotFoundException("Modelo de entrada nao encontrado.", input);
        foreach (var settings in profile.SettingsPaths) if (!File.Exists(settings)) throw new FileNotFoundException("Arquivo de perfil OrcaSlicer ausente.", settings);
        foreach (var filament in profile.FilamentPaths) if (!File.Exists(filament)) throw new FileNotFoundException("Arquivo de filamento OrcaSlicer ausente.", filament);
        if (profile.Sha256.Length > 0)
        {
            var actualProfileHash = await HashFileAsync(profile.SettingsPaths[0], cancellationToken);
            if (!actualProfileHash.Hash.Equals(profile.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Hash do perfil OrcaSlicer divergente: {profile.Id}.");
        }

        var outputDirectory = Path.GetDirectoryName(output)!;
        Directory.CreateDirectory(outputDirectory);
        var previousFiles = Directory.EnumerateFiles(outputDirectory).Select(Path.GetFileName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var previousOutput = await GetFileSnapshotAsync(output, cancellationToken);
        var args = BuildArguments(input, output, profile, exportGcode3mf);
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var argument in args) startInfo.ArgumentList.Add(argument);
        var result = await _processRunner.RunAsync(startInfo, timeout ?? TimeSpan.FromMinutes(15), cancellationToken);
        if (result.ExitCode != 0)
        {
            var diagnostic = (string.IsNullOrWhiteSpace(result.Stderr) ? result.Stdout : result.Stderr).Trim();
            if (diagnostic.Length > 2000) diagnostic = diagnostic[^2000..];
            throw new InvalidOperationException($"OrcaSlicer terminou com codigo {result.ExitCode}. {diagnostic}".Trim());
        }

        var outputSnapshot = await GetFileSnapshotAsync(output, cancellationToken);
        var outputIsNew = outputSnapshot is not null && (previousOutput is null || outputSnapshot.Value.ModifiedUtc > previousOutput.Value.ModifiedUtc || outputSnapshot.Value.SizeBytes != previousOutput.Value.SizeBytes);
        if (!outputIsNew)
        {
            var generated = Directory.EnumerateFiles(outputDirectory)
                .Where(path => !previousFiles.Contains(Path.GetFileName(path)) && Path.GetExtension(path).Equals(".gcode", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (generated.Length == 1 && previousOutput is null && !generated[0].Equals(output, StringComparison.OrdinalIgnoreCase))
            {
                File.Move(generated[0], output);
                outputSnapshot = await GetFileSnapshotAsync(output, cancellationToken);
            }
        }
        if (outputSnapshot is null || outputSnapshot.Value.SizeBytes == 0) throw new InvalidDataException("OrcaSlicer terminou sem gerar um G-code valido.");
        await ValidateGeneratedEngineVersionAsync(output, profile.Version, cancellationToken);
        var hash = await HashFileAsync(output, cancellationToken);
        return new OrcaSliceArtifact("gcode", output, hash.Hash, hash.SizeBytes, profile, result.Stdout, result.Stderr);
    }

    private static readonly Regex GeneratedByVersion = new(@"^;\s*generated by OrcaSlicer\s+([0-9]+(?:\.[0-9]+){1,3})\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(2));

    private static async Task ValidateGeneratedEngineVersionAsync(string outputPath, string expectedVersion, CancellationToken cancellationToken)
    {
        string? actualVersion;
        if (Path.GetFileName(outputPath).EndsWith(".gcode.3mf", StringComparison.OrdinalIgnoreCase))
        {
            await using var packageStream = new FileStream(outputPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var archive = new ZipArchive(packageStream, ZipArchiveMode.Read, leaveOpen: true);
            var entry = archive.Entries
                .Where(item => item.FullName.StartsWith("Metadata/plate_", StringComparison.OrdinalIgnoreCase) && item.FullName.EndsWith(".gcode", StringComparison.OrdinalIgnoreCase))
                .OrderBy(item => item.FullName, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
            if (entry is null)
                throw new InvalidDataException("Artefato gcode.3mf não contém G-code de placa para validar a versão do motor.");

            await using var gcodeStream = entry.Open();
            actualVersion = await ReadGeneratedEngineVersionAsync(gcodeStream, cancellationToken);
        }
        else
        {
            await using var gcodeStream = new FileStream(outputPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            actualVersion = await ReadGeneratedEngineVersionAsync(gcodeStream, cancellationToken);
        }

        if (!string.Equals(actualVersion, expectedVersion, StringComparison.Ordinal))
            throw new InvalidDataException($"OrcaSlicer gerou G-code com o motor {actualVersion ?? "sem versão identificada"}; esta versão do Fila Agent exige o motor validado {expectedVersion}. O artefato não será enviado ao sistema.");
    }

    private static async Task<string?> ReadGeneratedEngineVersionAsync(Stream gcodeStream, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(gcodeStream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 4096, leaveOpen: true);
        for (var lineNumber = 0; lineNumber < 64; lineNumber++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line is null) break;
            var match = GeneratedByVersion.Match(line);
            if (match.Success) return match.Groups[1].Value;
        }
        return null;
    }

    public async Task<OrcaSliceModelResult> SliceModelAsync(string executablePath, string inputPath, string outputPath,
        string manufacturer, string model, string version = "2.4.2", string nozzle = "0.4", TimeSpan? timeout = null,
        CancellationToken cancellationToken = default, bool exportGcode3mf = false)
    {
        var analysis = await OrcaModelAnalyzer.AnalyzeAsync(inputPath, cancellationToken);
        var profile = ResolveOfficialProfile(manufacturer, model, executablePath, version, nozzle);
        var artifact = await SliceAsync(executablePath, inputPath, outputPath, profile, timeout, cancellationToken, exportGcode3mf);
        var metrics = await OrcaGcodeMetricsReader.ReadAsync(artifact.OutputPath, cancellationToken);
        return new OrcaSliceModelResult(analysis, profile, artifact, metrics);
    }

    private static async Task<(string Hash, long SizeBytes)> HashFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return (Convert.ToHexString(hash).ToLowerInvariant(), stream.Length);
    }

    private static async Task<(DateTime ModifiedUtc, long SizeBytes)?> GetFileSnapshotAsync(string path, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var info = new FileInfo(path);
        if (!info.Exists) return null;
        return await Task.FromResult<(DateTime, long)?>((info.LastWriteTimeUtc, info.Length));
    }

    private static string Required(string value, string name) => string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"{name} e obrigatorio.") : value.Trim();
    private static string FirstNonBlank(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}
