using System.Globalization;
using System.Text.RegularExpressions;

namespace FilaAgent.Runtime;

public sealed class AgentEventOutboxService
{
    private readonly AgentCloudClient _cloudClient;
    private readonly AgentLocalOperationsStore _operationsStore;
    private readonly int _maxAttempts;
    private readonly Func<double> _random;
    private readonly Func<DateTimeOffset> _utcNow;

    public AgentEventOutboxService(AgentCloudClient cloudClient, AgentLocalOperationsStore operationsStore,
        int? maxAttempts = null, Func<double>? random = null, Func<DateTimeOffset>? utcNow = null)
    {
        _cloudClient = cloudClient ?? throw new ArgumentNullException(nameof(cloudClient));
        _operationsStore = operationsStore ?? throw new ArgumentNullException(nameof(operationsStore));
        _maxAttempts = Math.Max(1, maxAttempts ?? ReadMaxAttempts());
        _random = random ?? Random.Shared.NextDouble;
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public async Task<int> FlushAsync(AgentCredentials credentials, int limit = 20, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        var synchronized = 0;
        foreach (var item in _operationsStore.ListPendingEvents(limit, _utcNow()))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var payload = new
                {
                    id = item.Id.ToString(CultureInfo.InvariantCulture),
                    type = item.EventType,
                    payload = item.Payload,
                    createdAt = item.CreatedAt
                };
                await _cloudClient.SyncEventsAsync(credentials, [payload], cancellationToken);
                _operationsStore.AcknowledgeEvent(item.Id);
                synchronized++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error)
            {
                var attempts = item.Attempts + 1;
                var status = error is AgentApiException apiError ? (int)apiError.StatusCode : 0;
                var permanent = status is >= 400 and < 500 and not 408 and not 429;
                var safeError = Sanitize(error.Message);
                if (permanent || attempts >= _maxAttempts)
                {
                    _operationsStore.DeadLetterEvent(item.Id, safeError);
                    continue;
                }

                var backoffMilliseconds = Math.Min(60 * 60_000d, 5_000d * Math.Pow(2, Math.Min(10, attempts - 1)));
                var jitter = 0.8d + Math.Clamp(_random(), 0d, 1d) * 0.4d;
                var retryAt = _utcNow().AddMilliseconds(Math.Round(backoffMilliseconds * jitter));
                _operationsStore.MarkEventAttempted(item.Id, retryAt, safeError);
            }
        }
        return synchronized;
    }

    private static int ReadMaxAttempts()
    {
        var value = Environment.GetEnvironmentVariable("FILA_AGENT_OUTBOX_MAX_ATTEMPTS") ??
            Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_OUTBOX_MAX_ATTEMPTS");
        return int.TryParse(value, out var parsed) && parsed > 0 ? parsed : 10;
    }

    private static string Sanitize(string message)
    {
        var safe = Regex.Replace(message ?? string.Empty, @"(?i)(bearer\s+)[^\s]+", "$1[REDACTED]");
        safe = Regex.Replace(safe, @"(?i)([?&](?:token|secret|password|access_code|api_key)=)[^&\s]+", "$1[REDACTED]");
        return safe[..Math.Min(500, safe.Length)];
    }
}
