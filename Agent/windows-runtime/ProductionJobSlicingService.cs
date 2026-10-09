using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed record ProductionJobSlicingRequest(string PrintJobId, AgentPrintFileDescriptor PrintFile, PrinterPinMetadata Printer);
public sealed record ProductionJobSlicingResult(bool Success, JsonElement Artifact, OrcaProfile Profile, OrcaGcodeMetrics Metrics);

public sealed class ProductionJobSlicingService(
    AgentCloudClient cloudClient,
    AgentPrintFileCache fileCache,
    OrcaSlicerService? slicer = null,
    IReadOnlyDictionary<string, string?>? environment = null)
{
    private readonly OrcaSlicerService _slicer = slicer ?? new OrcaSlicerService();
    private readonly IReadOnlyDictionary<string, string?> _environment = environment ?? ReadEnvironment();

    public async Task<ProductionJobSlicingResult> PrepareAsync(AgentCredentials credentials,
        ProductionJobSlicingRequest job, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        ArgumentNullException.ThrowIfNull(job);
        if (string.IsNullOrWhiteSpace(job.PrintJobId) || job.PrintFile is null ||
            string.IsNullOrWhiteSpace(job.PrintFile.StorageKey) || !string.Equals(job.PrintFile.Format, "3mf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("O Production Job precisa de um arquivo 3MF disponível para preparar o G-code.");
        if (string.IsNullOrWhiteSpace(job.Printer?.Manufacturer) || string.IsNullOrWhiteSpace(job.Printer.Model))
            throw new InvalidDataException("Impressora com fabricante e modelo obrigatórios para preparar o G-code.");

        var executablePath = OrcaSlicerService.ResolveConfiguredExecutable(_environment);
        if (string.IsNullOrWhiteSpace(executablePath))
        {
            var unsupportedVersion = OrcaSlicerService.FindUnvalidatedStorePackageVersion();
            if (unsupportedVersion is not null)
                throw new FileNotFoundException(
                    $"OrcaSlicer Store {unsupportedVersion} está instalado, mas ainda não foi validado com esta versão do Fila Agent. " +
                    "A geração de G-code foi interrompida; atualize o Fila Agent quando essa versão do Orca tiver sido validada.");
            throw new FileNotFoundException("OrcaSlicer Store validado não encontrado. Instale-o pelo canal oficial ou informe FILA_AGENT_ORCA_SLICER_PATH.");
        }

        var source = await fileCache.EnsureCachedAsync(credentials, job.PrintJobId, job.PrintFile, cancellationToken);
        var pinned = false;
        string? tempDirectory = null;
        try
        {
            await fileCache.PinAsync(source.LocalPath, job.PrintJobId, job.Printer, cancellationToken);
            pinned = true;
            tempDirectory = Directory.CreateTempSubdirectory("fila-agent-slice-").FullName;
            var bambu = string.Equals(job.Printer.Protocol, "bambu", StringComparison.OrdinalIgnoreCase);
            var outputPath = Path.Combine(tempDirectory, bambu ? "production-job.gcode.3mf" : "production-job.gcode");
            var sliced = await _slicer.SliceModelAsync(executablePath, source.LocalPath, outputPath,
                job.Printer.Manufacturer!, job.Printer.Model, cancellationToken: cancellationToken, exportGcode3mf: bambu);
            var idempotencyKey = $"slice-{job.PrintJobId}-{sliced.Artifact.Sha256}";
            var upload = await cloudClient.UploadSlicedPrintArtifactAsync(credentials, job.PrintJobId,
                sliced.Artifact, idempotencyKey,
                new PrintJobEstimate(sliced.Metrics.EstimatedPrintSeconds, sliced.Metrics.EstimatedFilamentGrams, sliced.Metrics.EstimatedFilamentMillimeters),
                cancellationToken);

            var artifact = upload.TryGetProperty("artifact", out var storedArtifact)
                ? storedArtifact.Clone()
                : JsonSerializer.SerializeToElement(new
                {
                    fileName = Path.GetFileName(sliced.Artifact.OutputPath),
                    format = sliced.Artifact.Format,
                    sha256 = sliced.Artifact.Sha256,
                    sizeBytes = sliced.Artifact.SizeBytes
                });
            return new ProductionJobSlicingResult(true, artifact, sliced.Profile, sliced.Metrics);
        }
        finally
        {
            try
            {
                if (pinned) await fileCache.UnpinAsync(source.LocalPath);
            }
            finally
            {
                if (tempDirectory is not null && Directory.Exists(tempDirectory)) Directory.Delete(tempDirectory, recursive: true);
            }
        }
    }

    private static IReadOnlyDictionary<string, string?> ReadEnvironment() => Environment.GetEnvironmentVariables()
        .Cast<System.Collections.DictionaryEntry>()
        .Where(entry => entry.Key is string)
        .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);
}
