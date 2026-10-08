using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed class AgentCommandPollingService(
    AgentCloudClient cloudClient,
    AgentLocalOperationsStore operationsStore,
    AgentPrinterCommandHandler printerCommands,
    ProductionJobSlicingCommandHandler slicingCommands,
    int? maxPendingOperations = null,
    Action<string>? log = null)
{
    private readonly int _maxPendingOperations = Math.Max(100, maxPendingOperations ?? ReadMaxPendingOperations());
    private readonly ProductionMetricOutboxService _metricsOutbox = new(cloudClient, operationsStore);
    private readonly AgentEventOutboxService _eventsOutbox = new(cloudClient, operationsStore);

    public async Task<AgentCommandDispatchResult> PollOnceAsync(AgentCredentials credentials,
        CancellationToken cancellationToken = default)
    {
        if (cancellationToken.IsCancellationRequested) return new AgentCommandDispatchResult(false, "cancelled");

        try
        {
            await _metricsOutbox.FlushAsync(credentials, cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            log?.Invoke($"Outbox de metricas continuara tentando: {error.GetType().Name}: {error.Message}");
        }

        try
        {
            await _eventsOutbox.FlushAsync(credentials, cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            log?.Invoke($"Outbox de eventos continuara tentando: {error.GetType().Name}: {error.Message}");
        }

        await printerCommands.FlushPendingCompletionsAsync(credentials, cancellationToken);
        if (operationsStore.GetPendingCounts().Total >= _maxPendingOperations)
            return new AgentCommandDispatchResult(false, "queue-blocked");

        var pending = await cloudClient.GetPendingCommandAsync(credentials, cancellationToken);
        if (!pending.TryGetProperty("command", out var command) || command.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return new AgentCommandDispatchResult(false, "empty");

        var slicing = await slicingCommands.TryDispatchPendingAsync(credentials, pending, cancellationToken);
        var result = slicing.Handled
            ? slicing
            : await printerCommands.TryDispatchPendingAsync(credentials, pending, cancellationToken);
        if (result.Handled && result.Status == "completed")
        {
            try { await _eventsOutbox.FlushAsync(credentials, cancellationToken: cancellationToken); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error) { log?.Invoke($"Evento de comando permanece na outbox: {error.GetType().Name}"); }
        }
        return result;
    }

    private static int ReadMaxPendingOperations()
    {
        var value = Environment.GetEnvironmentVariable("FILA_AGENT_MAX_PENDING_OPERATIONS") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_MAX_PENDING_OPERATIONS");
        return int.TryParse(value, out var parsed) && parsed > 0 ? parsed : 5_000;
    }
}
