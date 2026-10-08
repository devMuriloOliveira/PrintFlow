using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FilaAgent.Runtime;

public sealed record AgentPrintFileDescriptor(string StorageKey, string Hash, string Format, long SizeBytes, string? Name = null);
public sealed record CachedPrintFile(string StorageKey, string Hash, string Format, long SizeBytes, string LocalPath, bool Cached);
public sealed record PrintFileCacheStats(int Files, long Bytes, int PinnedFiles, int TemporaryFiles);
public sealed record PrinterPinMetadata(string? Protocol = null, string? ConnectionType = null, string? Name = null,
    string? Manufacturer = null, string? Model = null, string? Software = null, string? Ip = null, int? Port = null,
    int? BaudRate = null, string? Serial = null, string? Firmware = null);

public sealed class AgentPrintFileCache
{
    private const long MaxFileBytes = 2L * 1024 * 1024 * 1024;
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> FileLocks = new(StringComparer.OrdinalIgnoreCase);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    private readonly AgentCloudClient _cloudClient;
    private readonly string _directory;
    private readonly TimeSpan _maxAge;
    private readonly TimeSpan _tempMaxAge;
    private readonly TimeSpan _pinLease;
    private readonly long _maxTotalBytes;

    public AgentPrintFileCache(AgentCloudClient cloudClient, string cacheDirectory,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        _cloudClient = cloudClient ?? throw new ArgumentNullException(nameof(cloudClient));
        _directory = Path.GetFullPath(string.IsNullOrWhiteSpace(cacheDirectory)
            ? throw new ArgumentException("Diretório de cache obrigatório.", nameof(cacheDirectory))
            : cacheDirectory);
        environment ??= Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);

        var maxAgeDays = ReadDouble(environment, "FILA_AGENT_CACHE_MAX_AGE_DAYS", "PRINTFLOW_AGENT_CACHE_MAX_AGE_DAYS", 14);
        var maxBytes = ReadLong(environment, "FILA_AGENT_CACHE_MAX_BYTES", "PRINTFLOW_AGENT_CACHE_MAX_BYTES", MaxFileBytes);
        var tempMaxAgeMs = ReadDouble(environment, "FILA_AGENT_CACHE_TEMP_MAX_AGE_MS", "PRINTFLOW_AGENT_CACHE_TEMP_MAX_AGE_MS", 60 * 60 * 1000);
        var pinLeaseHours = ReadDouble(environment, "FILA_AGENT_CACHE_PIN_LEASE_HOURS", "PRINTFLOW_AGENT_CACHE_PIN_LEASE_HOURS", 24);
        _maxAge = TimeSpan.FromDays(Math.Max(0, maxAgeDays));
        _maxTotalBytes = Math.Clamp(maxBytes, 0, MaxFileBytes);
        _tempMaxAge = TimeSpan.FromMilliseconds(Math.Max(0, tempMaxAgeMs));
        _pinLease = TimeSpan.FromHours(Math.Max(1, pinLeaseHours));
    }

    public PrintFileCacheStats GetStats()
    {
        if (!Directory.Exists(_directory)) return new PrintFileCacheStats(0, 0, 0, 0);
        var files = 0;
        var pinned = 0;
        var temporary = 0;
        long bytes = 0;
        foreach (var path in Directory.EnumerateFiles(_directory, "*", SearchOption.TopDirectoryOnly))
        {
            if (path.EndsWith(".pin", StringComparison.OrdinalIgnoreCase) ||
                path.EndsWith(".pin.tmp", StringComparison.OrdinalIgnoreCase)) continue;
            var info = new FileInfo(path);
            files++;
            bytes += info.Length;
            if (File.Exists(path + ".pin")) pinned++;
            if (info.Name.Contains(".tmp-", StringComparison.OrdinalIgnoreCase) ||
                info.Extension.Equals(".part", StringComparison.OrdinalIgnoreCase)) temporary++;
        }
        return new PrintFileCacheStats(files, bytes, pinned, temporary);
    }

    public async Task<CachedPrintFile> EnsureCachedAsync(AgentCredentials credentials, string printJobId,
        AgentPrintFileDescriptor printFile, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        ArgumentNullException.ThrowIfNull(printFile);
        Validate(printJobId, printFile);

        var hash = printFile.Hash.ToLowerInvariant();
        var format = printFile.Format.ToLowerInvariant();
        var finalPath = Path.Combine(_directory, $"{hash}.{format}");
        var partialPath = finalPath + ".part";
        var gate = FileLocks.GetOrAdd(finalPath, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_directory);
            await CleanupAsync(cancellationToken: cancellationToken);
            if (await HasExpectedContentAsync(finalPath, hash, printFile.SizeBytes, cancellationToken))
            {
                File.SetLastWriteTimeUtc(finalPath, DateTime.UtcNow);
                return new CachedPrintFile(printFile.StorageKey, hash, format, new FileInfo(finalPath).Length, finalPath, true);
            }

            if (File.Exists(finalPath) && File.Exists(finalPath + ".pin"))
                throw new InvalidDataException("O arquivo de cache está fixado para uma impressão e não pode ser substituído.");

            var partialBytes = File.Exists(partialPath) ? new FileInfo(partialPath).Length : 0;
            if (partialBytes > MaxFileBytes || (printFile.SizeBytes > 0 && partialBytes >= printFile.SizeBytes))
            {
                File.Delete(partialPath);
                partialBytes = 0;
            }

            for (var attempt = 0; attempt < 2; attempt++)
            {
                var download = await _cloudClient.DownloadPrintFileAsync(credentials, printJobId,
                    printFile.StorageKey, partialPath, partialBytes, cancellationToken);
                if (download.StatusCode == System.Net.HttpStatusCode.RequestedRangeNotSatisfiable)
                {
                    File.Delete(partialPath);
                    partialBytes = 0;
                    if (attempt == 0) continue;
                    throw new InvalidDataException("A API rejeitou a retomada do download do arquivo.");
                }
                if (partialBytes > 0 && download.StatusCode == System.Net.HttpStatusCode.PartialContent && !download.Resumed)
                {
                    File.Delete(partialPath);
                    partialBytes = 0;
                    if (attempt == 0) continue;
                    throw new InvalidDataException("A API retornou um intervalo incompatível para o arquivo.");
                }

                var actualSize = new FileInfo(partialPath).Length;
                if (actualSize <= 0 || actualSize > MaxFileBytes || (_maxTotalBytes > 0 && actualSize > _maxTotalBytes))
                    throw new InvalidDataException("Tamanho do arquivo baixado excede o limite do cache.");
                if (printFile.SizeBytes > 0 && actualSize != printFile.SizeBytes)
                    throw new InvalidDataException("Tamanho do arquivo baixado não confere.");

                var actualHash = await HashFileAsync(partialPath, cancellationToken);
                if (!actualHash.Equals(hash, StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(partialPath);
                    throw new InvalidDataException("Hash do arquivo baixado não confere.");
                }

                File.Move(partialPath, finalPath, overwrite: true);
                await CleanupAsync(cancellationToken: cancellationToken);
                return new CachedPrintFile(printFile.StorageKey, hash, format, actualSize, finalPath, false);
            }

            throw new InvalidDataException("Não foi possível concluir o download do arquivo.");
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task PinAsync(string localPath, string printJobId, PrinterPinMetadata? printer = null,
        CancellationToken cancellationToken = default)
    {
        var fullPath = EnsureCachePath(localPath);
        if (!File.Exists(fullPath)) throw new FileNotFoundException("Arquivo de cache para fixação não encontrado.", fullPath);
        if (string.IsNullOrWhiteSpace(printJobId)) throw new ArgumentException("ID do Production Job obrigatório.", nameof(printJobId));
        var marker = new PinMarker(1, DateTimeOffset.UtcNow, printJobId.Trim(), printer);
        var markerPath = fullPath + ".pin";
        var tempPath = markerPath + ".tmp";
        await File.WriteAllTextAsync(tempPath, JsonSerializer.Serialize(marker, JsonOptions), cancellationToken);
        File.Move(tempPath, markerPath, overwrite: true);
    }

    public Task UnpinAsync(string localPath)
    {
        var fullPath = EnsureCachePath(localPath);
        File.Delete(fullPath + ".pin");
        return Task.CompletedTask;
    }

    public async Task<int> UnpinByPrintJobIdAsync(string printJobId, CancellationToken cancellationToken = default)
    {
        var expectedId = printJobId?.Trim() ?? string.Empty;
        if (expectedId.Length == 0 || !Directory.Exists(_directory)) return 0;
        var removed = 0;
        foreach (var markerPath in Directory.EnumerateFiles(_directory, "*.pin", SearchOption.TopDirectoryOnly))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                PinMarker? marker;
                await using (var stream = File.OpenRead(markerPath))
                    marker = await JsonSerializer.DeserializeAsync<PinMarker>(stream, JsonOptions, cancellationToken);
                if (!string.Equals(marker?.PrintJobId, expectedId, StringComparison.Ordinal)) continue;
                File.Delete(markerPath);
                removed++;
            }
            catch (JsonException) { }
            catch (FileNotFoundException) { }
        }
        return removed;
    }

    public async Task<StalePrintFilePinRecoveryResult> RecoverStalePinsAsync(
        IReadOnlyCollection<string> activePrintJobIds,
        bool hasActivePrints,
        Func<PrinterPinMetadata, string, CancellationToken, Task<bool>> isPrinterIdle,
        DateTimeOffset? asOf = null,
        TimeSpan? pinLease = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(activePrintJobIds);
        ArgumentNullException.ThrowIfNull(isPrinterIdle);
        if (hasActivePrints || !Directory.Exists(_directory)) return new StalePrintFilePinRecoveryResult(0, 0);

        var activeIds = activePrintJobIds.Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id.Trim()).ToHashSet(StringComparer.Ordinal);
        var now = asOf ?? DateTimeOffset.UtcNow;
        var lease = pinLease ?? _pinLease;
        if (lease < TimeSpan.FromHours(1)) lease = TimeSpan.FromHours(1);
        var released = 0;
        var retained = 0;
        foreach (var markerPath in Directory.EnumerateFiles(_directory, "*.pin", SearchOption.TopDirectoryOnly))
        {
            cancellationToken.ThrowIfCancellationRequested();
            PinMarker? marker;
            DateTimeOffset modifiedAt;
            try
            {
                var info = new FileInfo(markerPath);
                modifiedAt = info.LastWriteTimeUtc;
                await using var stream = File.OpenRead(markerPath);
                marker = await JsonSerializer.DeserializeAsync<PinMarker>(stream, JsonOptions, cancellationToken);
            }
            catch (Exception error) when (error is JsonException or IOException)
            {
                retained++;
                continue;
            }

            var printJobId = marker?.PrintJobId?.Trim() ?? string.Empty;
            var createdAt = marker?.CreatedAt is { } timestamp && timestamp > DateTimeOffset.MinValue ? timestamp : modifiedAt;
            if (now - createdAt < lease || printJobId.Length == 0 || marker?.Printer is null || activeIds.Contains(printJobId))
            {
                retained++;
                continue;
            }

            var printerIdle = false;
            try { printerIdle = await isPrinterIdle(marker.Printer, printJobId, cancellationToken) == true; }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch { }
            if (!printerIdle)
            {
                retained++;
                continue;
            }

            File.Delete(markerPath);
            released++;
        }

        return new StalePrintFilePinRecoveryResult(released, retained);
    }

    public Task<PrintFileCacheCleanupResult> CleanupAsync(DateTimeOffset? asOf = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!Directory.Exists(_directory)) return Task.FromResult(new PrintFileCacheCleanupResult(0, 0, 0, 0));
        var now = asOf ?? DateTimeOffset.UtcNow;
        var files = Directory.EnumerateFiles(_directory, "*", SearchOption.TopDirectoryOnly)
            .Where(path => !path.EndsWith(".pin", StringComparison.OrdinalIgnoreCase) &&
                !path.EndsWith(".pin.tmp", StringComparison.OrdinalIgnoreCase))
            .Select(path =>
            {
                var info = new FileInfo(path);
                return new CacheEntry(path, info.Length, info.LastWriteTimeUtc,
                    info.Name.Contains(".tmp-", StringComparison.OrdinalIgnoreCase) || info.Extension.Equals(".part", StringComparison.OrdinalIgnoreCase),
                    File.Exists(path + ".pin"));
            }).ToList();

        var removed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long removedBytes = 0;
        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var age = now.UtcDateTime - file.ModifiedUtc;
            var staleTemp = file.IsTemp && !file.IsPinned && age >= _tempMaxAge;
            var staleFile = !file.IsTemp && !file.IsPinned && _maxAge > TimeSpan.Zero && age >= _maxAge;
            if (!staleTemp && !staleFile) continue;
            File.Delete(file.Path);
            removed.Add(file.Path);
            removedBytes += file.SizeBytes;
        }

        var remaining = files.Where(file => !removed.Contains(file.Path)).ToArray();
        var remainingBytes = remaining.Sum(file => file.SizeBytes);
        foreach (var file in remaining.Where(file => !file.IsTemp && !file.IsPinned).OrderBy(file => file.ModifiedUtc))
        {
            if (_maxTotalBytes == 0 || remainingBytes <= _maxTotalBytes) break;
            cancellationToken.ThrowIfCancellationRequested();
            File.Delete(file.Path);
            removed.Add(file.Path);
            removedBytes += file.SizeBytes;
            remainingBytes -= file.SizeBytes;
        }

        return Task.FromResult(new PrintFileCacheCleanupResult(removed.Count, removedBytes, files.Count - removed.Count, remainingBytes));
    }

    private string EnsureCachePath(string path)
    {
        var fullPath = Path.GetFullPath(string.IsNullOrWhiteSpace(path) ? throw new ArgumentException("Caminho de cache obrigatório.", nameof(path)) : path);
        var relative = Path.GetRelativePath(_directory, fullPath);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("O caminho solicitado está fora do cache do Agent.");
        return fullPath;
    }

    private static void Validate(string printJobId, AgentPrintFileDescriptor printFile)
    {
        if (string.IsNullOrWhiteSpace(printJobId) || string.IsNullOrWhiteSpace(printFile.StorageKey) ||
            string.IsNullOrWhiteSpace(printFile.Hash) || printFile.Hash.Length != 64 || !printFile.Hash.All(Uri.IsHexDigit))
            throw new InvalidDataException("Production Job sem chave de arquivo ou hash SHA-256 válido.");
        if (string.IsNullOrWhiteSpace(printFile.Format) || !printFile.Format.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_'))
            throw new InvalidDataException("Formato de arquivo inválido para o cache.");
        if (printFile.SizeBytes < 0 || printFile.SizeBytes > MaxFileBytes)
            throw new InvalidDataException("Tamanho de arquivo inválido para o cache.");
    }

    private static async Task<bool> HasExpectedContentAsync(string path, string expectedHash, long expectedSize, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return false;
        var info = new FileInfo(path);
        if (info.Length == 0 || (expectedSize > 0 && info.Length != expectedSize)) return false;
        return string.Equals(await HashFileAsync(path, cancellationToken), expectedHash, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string> HashFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
    }

    private static double ReadDouble(IReadOnlyDictionary<string, string?> environment, string currentName, string legacyName, double fallback)
    {
        var value = FirstNonBlank(environment.GetValueOrDefault(currentName), environment.GetValueOrDefault(legacyName));
        return double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed) &&
            double.IsFinite(parsed) ? parsed : fallback;
    }

    private static long ReadLong(IReadOnlyDictionary<string, string?> environment, string currentName, string legacyName, long fallback)
    {
        var value = FirstNonBlank(environment.GetValueOrDefault(currentName), environment.GetValueOrDefault(legacyName));
        return long.TryParse(value, out var parsed) ? parsed : fallback;
    }

    private static string FirstNonBlank(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    private sealed record PinMarker(int Version, DateTimeOffset CreatedAt, string PrintJobId, PrinterPinMetadata? Printer);
    private sealed record CacheEntry(string Path, long SizeBytes, DateTime ModifiedUtc, bool IsTemp, bool IsPinned);
}

public sealed record PrintFileCacheCleanupResult(int Removed, long RemovedBytes, int Kept, long RemainingBytes);
public sealed record StalePrintFilePinRecoveryResult(int Released, int Retained);
