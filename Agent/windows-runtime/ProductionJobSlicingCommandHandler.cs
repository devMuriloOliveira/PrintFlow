using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed record AgentCommandDispatchResult(bool Handled, string Status, JsonElement? Result = null);

public sealed class ProductionJobSlicingCommandHandler(
    AgentCloudClient cloudClient,
    AgentLocalOperationsStore operationsStore,
    ProductionJobSlicingService slicingService)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<AgentCommandDispatchResult> TryDispatchPendingAsync(
        AgentCredentials credentials,
        JsonElement pendingResponse,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetProperty(pendingResponse, "command", out var command) || command.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return new AgentCommandDispatchResult(false, "empty");

        var commandType = GetString(command, "type") ?? string.Empty;
        if (!string.Equals(commandType, "slice_print_job", StringComparison.Ordinal))
            return new AgentCommandDispatchResult(false, "unsupported");

        var commandId = GetRequiredText(command, "id");
        var start = operationsStore.Begin(new AgentCommand(commandId, commandType));
        if (start.Status == "processing") return new AgentCommandDispatchResult(true, "processing");
        if (start.Status == "completed")
        {
            if (!cancellationToken.IsCancellationRequested)
                await TryDeliverCompletionAsync(credentials, commandId, cancellationToken);
            return new AgentCommandDispatchResult(true, "completed", start.Result);
        }

        object result;
        try
        {
            var request = ParseRequest(command);
            var sliced = await slicingService.PrepareAsync(credentials, request, cancellationToken);
            result = new
            {
                success = sliced.Success,
                artifact = sliced.Artifact,
                profile = sliced.Profile,
                metrics = sliced.Metrics
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            result = new { success = false, error = "Preparacao do G-code cancelada.", code = "cancelled" };
        }
        catch (Exception error)
        {
            result = new { success = false, error = error.Message };
        }

        operationsStore.RecordResult(commandId, result, commandType);
        var persisted = operationsStore.Begin(new AgentCommand(commandId, commandType));
        if (!cancellationToken.IsCancellationRequested)
            await TryDeliverCompletionAsync(credentials, commandId, cancellationToken);
        return new AgentCommandDispatchResult(true, "completed", persisted.Result);
    }

    public async Task<int> FlushPendingCompletionsAsync(AgentCredentials credentials, CancellationToken cancellationToken = default)
    {
        if (cancellationToken.IsCancellationRequested) return 0;
        var completions = operationsStore.ListPendingCompletions(limit: 100);
        foreach (var completion in completions)
            await TryDeliverCompletionAsync(credentials, completion, cancellationToken);
        return completions.Count;
    }

    private async Task TryDeliverCompletionAsync(AgentCredentials credentials, string commandId, CancellationToken cancellationToken)
    {
        var completion = operationsStore.ListPendingCompletions(limit: 100)
            .FirstOrDefault(item => string.Equals(item.CommandId, commandId, StringComparison.Ordinal));
        if (completion is null) return;

        await TryDeliverCompletionAsync(credentials, completion, cancellationToken);
    }

    private async Task TryDeliverCompletionAsync(AgentCredentials credentials, PendingCompletion completion, CancellationToken cancellationToken)
    {
        var commandId = completion.CommandId;
        var success = TryGetProperty(completion.Result, "success", out var successValue) &&
            successValue.ValueKind == JsonValueKind.True;
        try
        {
            await cloudClient.CompleteCommandAsync(credentials, commandId, success, completion.Result, cancellationToken);
            operationsStore.AcknowledgeCompletion(commandId);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            operationsStore.RetryCompletion(commandId, error: error.GetType().Name);
        }
    }

    private static ProductionJobSlicingRequest ParseRequest(JsonElement command)
    {
        if (!TryGetProperty(command, "payload", out var payload) || payload.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Payload do comando de Production Job ausente.");
        if (!TryGetProperty(payload, "job", out var job) || job.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Production Job ausente no comando.");
        if (!TryGetProperty(payload, "printer", out var printer) || printer.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Dados da impressora nao foram enviados.");
        if (!TryGetProperty(job, "printFile", out var printFile) || printFile.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Arquivo do Production Job ausente.");

        var jobId = GetRequiredText(job, "id");
        var descriptor = JsonSerializer.Deserialize<AgentPrintFileDescriptor>(printFile.GetRawText(), JsonOptions)
            ?? throw new InvalidDataException("Metadados do arquivo do Production Job invalidos.");
        var printerMetadata = JsonSerializer.Deserialize<PrinterPinMetadata>(printer.GetRawText(), JsonOptions)
            ?? throw new InvalidDataException("Metadados da impressora invalidos.");
        if (string.IsNullOrWhiteSpace(printerMetadata.Serial) && GetString(printer, "serialNumber") is { Length: > 0 } serialNumber)
            printerMetadata = printerMetadata with { Serial = serialNumber };

        return new ProductionJobSlicingRequest(jobId, descriptor, printerMetadata);
    }

    private static string GetRequiredText(JsonElement element, string propertyName)
    {
        var value = GetString(element, propertyName);
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidDataException($"Comando sem identificador {propertyName}.")
            : value;
    }

    private static string? GetString(JsonElement element, string propertyName)
    {
        if (!TryGetProperty(element, propertyName, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null
        };
    }

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
}
