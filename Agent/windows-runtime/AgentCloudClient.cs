using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed class AgentApiException(HttpStatusCode statusCode, string message, string? code = null)
    : Exception(message)
{
    public HttpStatusCode StatusCode { get; } = statusCode;
    public string? Code { get; } = code;
    public bool HasInvalidCredentials => StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.NotFound ||
        Message.Contains("agent invalido", StringComparison.OrdinalIgnoreCase);
}

public sealed class AgentCloudClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;
    private readonly bool _ownsClient;
    private readonly TimeSpan _requestTimeout;
    private readonly Uri _apiUrl;

    public AgentCloudClient(Uri apiUrl, HttpClient? httpClient = null, TimeSpan? timeout = null)
    {
        _apiUrl = new Uri(apiUrl.AbsoluteUri.TrimEnd('/') + "/");
        _http = httpClient ?? new HttpClient();
        _ownsClient = httpClient is null;
        _requestTimeout = timeout ?? TimeSpan.FromSeconds(20);
        if (_ownsClient) _http.Timeout = Timeout.InfiniteTimeSpan;
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Fila-Agent", "0.1.28"));
    }

    public async Task<AgentCredentials> PairAsync(string code, string machineName, string platform, string architecture, string version, CancellationToken cancellationToken = default)
    {
        var body = new { code = code.Trim().ToUpperInvariant(), machineName, platform, architecture, version };
        using var request = new HttpRequestMessage(HttpMethod.Post, Resolve("api/agents/pair")) { Content = JsonContent.Create(body, options: JsonOptions) };
        using var response = await SendAsync(request, _requestTimeout, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        EnsureSuccess(response.StatusCode, json);
        var result = JsonSerializer.Deserialize<PairResponse>(json, JsonOptions) ?? throw new InvalidDataException("Resposta de pareamento vazia.");
        if (string.IsNullOrWhiteSpace(result.AgentId) || string.IsNullOrWhiteSpace(result.AgentSecret)) throw new InvalidDataException("A API retornou credenciais de pareamento incompletas.");
        return new AgentCredentials { AgentId = result.AgentId, AgentSecret = result.AgentSecret, TenantId = result.TenantId ?? string.Empty, TenantName = result.TenantName ?? string.Empty, MachineName = result.MachineName ?? machineName };
    }

    public async Task<JsonElement> VerifyAsync(AgentCredentials credentials, CancellationToken cancellationToken = default) =>
        await SendAuthenticatedAsync(HttpMethod.Post, "api/agents/verify", credentials, null, cancellationToken);

    public async Task<JsonElement> SendHeartbeatAsync(AgentCredentials credentials, object runtimeInfo, CancellationToken cancellationToken = default) =>
        await SendAuthenticatedAsync(HttpMethod.Post, "api/agents/heartbeat", credentials, runtimeInfo, cancellationToken);

    public async Task<JsonElement> GetPendingCommandAsync(AgentCredentials credentials, CancellationToken cancellationToken = default) =>
        await SendAuthenticatedAsync(HttpMethod.Get, "api/agents/commands/pending", credentials, null, cancellationToken);

    public async Task<JsonElement> GetRegisteredPrintersForReconnectAsync(AgentCredentials credentials, CancellationToken cancellationToken = default) =>
        await SendAuthenticatedAsync(HttpMethod.Get, "api/agents/printers/reconnect", credentials, null, cancellationToken);

    public async Task<JsonElement> RotateCredentialAsync(AgentCredentials credentials, CancellationToken cancellationToken = default) =>
        await SendAuthenticatedAsync(HttpMethod.Post, "api/agents/credential/rotate", credentials, new { }, cancellationToken);

    public async Task<JsonElement> ConfirmCredentialRotationAsync(AgentCredentials credentials, CancellationToken cancellationToken = default) =>
        await SendAuthenticatedAsync(HttpMethod.Post, "api/agents/credential/rotate/confirm", credentials, new { }, cancellationToken);

    public async Task<JsonElement> CompleteCommandAsync(AgentCredentials credentials, string commandId, bool success, object result, CancellationToken cancellationToken = default)
    {
        var body = new { success, result };
        return await SendAuthenticatedAsync(HttpMethod.Post, $"api/agents/commands/{Uri.EscapeDataString(commandId)}/complete", credentials, body, cancellationToken);
    }

    public async Task<JsonElement> ReportCommandProgressAsync(AgentCredentials credentials, string commandId, object progress, CancellationToken cancellationToken = default)
    {
        var body = new { progress };
        return await SendAuthenticatedAsync(HttpMethod.Post, $"api/agents/commands/{Uri.EscapeDataString(commandId)}/progress", credentials, body, cancellationToken);
    }

    public Task<JsonElement> SyncEventsAsync(AgentCredentials credentials, IReadOnlyCollection<object> events, CancellationToken cancellationToken = default)
    {
        if (events.Count == 0) return Task.FromResult(JsonSerializer.SerializeToElement(new { accepted = 0 }, JsonOptions));
        return SendAuthenticatedAsync(HttpMethod.Post, "api/agents/sync-events", credentials, new { events }, cancellationToken);
    }

    public Task<JsonElement> ReportPrintJobMetricsAsync(AgentCredentials credentials, string printJobId, object metrics,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(printJobId)) throw new ArgumentException("ID do Production Job obrigatorio.", nameof(printJobId));
        ArgumentNullException.ThrowIfNull(metrics);
        return SendAuthenticatedAsync(HttpMethod.Post,
            $"api/agents/print-jobs/{Uri.EscapeDataString(printJobId)}/metrics", credentials, metrics, cancellationToken);
    }

    public async Task<AgentPrintFileDownload> DownloadPrintFileAsync(AgentCredentials credentials, string printJobId,
        string storageKey, string partialPath, long startByte = 0, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(printJobId) || string.IsNullOrWhiteSpace(storageKey) || string.IsNullOrWhiteSpace(partialPath) || startByte < 0)
            throw new ArgumentException("Identificação do arquivo de Production Job inválida.");

        var query = $"api/agents/print-file?key={Uri.EscapeDataString(storageKey)}&printJobId={Uri.EscapeDataString(printJobId)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, Resolve(query));
        request.Headers.TryAddWithoutValidation("x-agent-id", credentials.AgentId);
        request.Headers.TryAddWithoutValidation("x-agent-secret", credentials.AgentSecret);
        if (startByte > 0) request.Headers.Range = new RangeHeaderValue(startByte, null);

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(TimeSpan.FromMinutes(2));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutSource.Token);
        var range = response.Content.Headers.ContentRange;
        if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
            return new AgentPrintFileDownload(response.StatusCode, 0, false, range?.From, range?.Length);

        if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.PartialContent))
        {
            var body = await response.Content.ReadAsStringAsync(timeoutSource.Token);
            EnsureSuccess(response.StatusCode, body);
            throw new InvalidOperationException("A API retornou um status inesperado no download do arquivo.");
        }

        var isPartial = response.StatusCode == HttpStatusCode.PartialContent;
        var resumed = startByte > 0 && isPartial && range?.From == startByte;
        if (startByte > 0 && isPartial && !resumed)
            return new AgentPrintFileDownload(response.StatusCode, 0, false, range?.From, range?.Length);
        if (startByte == 0 && isPartial && range?.From != 0)
            throw new InvalidDataException("A API retornou um intervalo de arquivo inesperado.");

        var fullPath = Path.GetFullPath(partialPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        var mode = resumed ? FileMode.Append : FileMode.Create;
        var originalLength = resumed && File.Exists(fullPath) ? new FileInfo(fullPath).Length : 0;
        await using (var output = new FileStream(fullPath, mode, FileAccess.Write, FileShare.None,
            128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
        await using (var input = await response.Content.ReadAsStreamAsync(timeoutSource.Token))
            await input.CopyToAsync(output, 128 * 1024, timeoutSource.Token);

        var written = new FileInfo(fullPath).Length - originalLength;
        return new AgentPrintFileDownload(response.StatusCode, written, resumed, range?.From, range?.Length);
    }

    public async Task<JsonElement> UploadSlicedPrintArtifactAsync(AgentCredentials credentials, string printJobId, OrcaSliceArtifact artifact,
        string idempotencyKey, PrintJobEstimate? metrics = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(artifact);
        if (string.IsNullOrWhiteSpace(artifact.OutputPath) || !File.Exists(artifact.OutputPath) || artifact.SizeBytes <= 0 ||
            string.IsNullOrWhiteSpace(artifact.Sha256) || string.IsNullOrWhiteSpace(artifact.Profile.Id) ||
            string.IsNullOrWhiteSpace(artifact.Profile.Version) || string.IsNullOrWhiteSpace(idempotencyKey))
            throw new InvalidDataException("Artefato local de slicing invalido.");

        var fileName = Path.GetFileName(artifact.OutputPath);
        if (string.IsNullOrWhiteSpace(fileName)) throw new InvalidDataException("Nome do artefato local invalido.");
        using var request = new HttpRequestMessage(HttpMethod.Post,
            Resolve($"api/agents/print-jobs/{Uri.EscapeDataString(printJobId)}/slicing-artifact"));
        request.Content = new StreamContent(new FileStream(artifact.OutputPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan));
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Headers.TryAddWithoutValidation("x-agent-id", credentials.AgentId);
        request.Headers.TryAddWithoutValidation("x-agent-secret", credentials.AgentSecret);
        request.Headers.TryAddWithoutValidation("x-agent-file-name", fileName);
        request.Headers.TryAddWithoutValidation("x-agent-file-format", artifact.Format);
        request.Headers.TryAddWithoutValidation("x-agent-slicer-profile-id", artifact.Profile.Id);
        request.Headers.TryAddWithoutValidation("x-agent-slicer-profile-version", artifact.Profile.Version);
        request.Headers.TryAddWithoutValidation("x-agent-idempotency-key", idempotencyKey);
        if (metrics?.EstimatedPrintSeconds is { } seconds)
        {
            request.Headers.TryAddWithoutValidation("x-agent-estimated-print-seconds", seconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        if (metrics?.EstimatedFilamentGrams is { } grams)
        {
            request.Headers.TryAddWithoutValidation("x-agent-estimated-filament-grams", grams.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        if (metrics?.EstimatedFilamentMillimeters is { } millimeters)
        {
            request.Headers.TryAddWithoutValidation("x-agent-estimated-filament-millimeters", millimeters.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        using var response = await SendAsync(request, TimeSpan.FromMinutes(2), cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        EnsureSuccess(response.StatusCode, json);
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private async Task<JsonElement> SendAuthenticatedAsync(HttpMethod method, string path, AgentCredentials credentials, object? body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, Resolve(path));
        request.Headers.TryAddWithoutValidation("x-agent-id", credentials.AgentId);
        request.Headers.TryAddWithoutValidation("x-agent-secret", credentials.AgentSecret);
        if (body is not null) request.Content = JsonContent.Create(body, options: JsonOptions);
        using var response = await SendAsync(request, _requestTimeout, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        EnsureSuccess(response.StatusCode, json);
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        return await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeoutSource.Token);
    }

    private Uri Resolve(string relativePath) => new(_apiUrl, relativePath);

    private static void EnsureSuccess(HttpStatusCode statusCode, string body)
    {
        if ((int)statusCode is >= 200 and < 300) return;
        string message = $"API do Agent respondeu {(int)statusCode}.";
        string? code = null;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error)) message = error.GetString() ?? message;
            if (document.RootElement.TryGetProperty("code", out var codeValue)) code = codeValue.GetString();
        }
        catch (JsonException) { }
        throw new AgentApiException(statusCode, message, code);
    }

    public void Dispose() { if (_ownsClient) _http.Dispose(); }

    private sealed record PairResponse(string AgentId, string AgentSecret, string? TenantId, string? TenantName, string? MachineName);
}

public sealed record PrintJobEstimate(double? EstimatedPrintSeconds = null, double? EstimatedFilamentGrams = null, double? EstimatedFilamentMillimeters = null);
public sealed record AgentPrintFileDownload(HttpStatusCode StatusCode, long BytesWritten, bool Resumed, long? RangeStart, long? TotalBytes);
