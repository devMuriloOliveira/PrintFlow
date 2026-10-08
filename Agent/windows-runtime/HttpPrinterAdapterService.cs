using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FilaAgent.Runtime;

public sealed record NetworkPrinterDescriptor(string Protocol, string Ip, int? Port = null, string? Name = null, string? Manufacturer = null);

public sealed record HttpPrinterConnection(
    string Protocol,
    string BaseUrl,
    NetworkPrinterDescriptor Printer,
    bool Connected,
    string? ApiKey,
    string? Username,
    string? Password,
    JsonElement VersionOrInfo,
    DateTimeOffset ConnectedAtUtc);

public sealed record HttpPrinterStatus(
    bool Connected,
    string Protocol,
    string? Manufacturer,
    string Name,
    string Ip,
    int Port,
    string State,
    double? Progress,
    int? RemainingMinutes,
    double? ActualPrintSeconds,
    double? ActualFilamentGrams,
    double? ActualFilamentMillimeters,
    double? NozzleTemperature,
    double? NozzleTargetTemperature,
    double? BedTemperature,
    double? BedTargetTemperature,
    string? File,
    JsonElement Raw);

public sealed record HttpPrinterCommandResult(bool Success, bool Uploaded = false, bool Started = false, string? File = null, JsonElement? Response = null);

public sealed class HttpPrinterAdapterService(HttpClient? httpClient = null) : IDisposable
{
    private readonly HttpClient _httpClient = httpClient ?? new HttpClient();
    private readonly bool _ownsClient = httpClient is null;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan UploadTimeout = TimeSpan.FromSeconds(120);

    public async Task<HttpPrinterConnection> ConnectAsync(NetworkPrinterDescriptor printer, IReadOnlyDictionary<string, string?>? options = null, CancellationToken cancellationToken = default)
    {
        var protocol = NormalizeProtocol(printer.Protocol);
        var port = printer.Port ?? DefaultPort(protocol);
        var baseUrl = new UriBuilder(Uri.UriSchemeHttp, printer.Ip, port).Uri.GetLeftPart(UriPartial.Authority);
        options ??= new Dictionary<string, string?>();
        var apiKey = NonBlank(options.GetValueOrDefault("apiKey"));
        var username = protocol == "prusalink" ? NonBlank(options.GetValueOrDefault("username")) ?? "maker" : null;
        var password = protocol == "prusalink" ? NonBlank(options.GetValueOrDefault("password")) ?? string.Empty : null;
        var path = protocol switch
        {
            "octoprint" => "/api/version",
            "moonraker" => "/server/info",
            "prusalink" => "/api/version",
            _ => throw new NotSupportedException($"Protocolo HTTP nao suportado: {printer.Protocol}.")
        };
        using var response = await SendAsync(HttpMethod.Get, baseUrl + path, protocol, apiKey, username, password, null, null, RequestTimeout, cancellationToken);
        var versionOrInfo = await ReadJsonAsync(response, cancellationToken);
        return new HttpPrinterConnection(protocol, baseUrl, printer, true, apiKey, username, password, versionOrInfo, DateTimeOffset.UtcNow);
    }

    public HttpPrinterConnection Disconnect(HttpPrinterConnection? connection) =>
        connection is null ? throw new ArgumentNullException(nameof(connection)) : connection with { Connected = false };

    public async Task<HttpPrinterStatus> GetStatusAsync(HttpPrinterConnection connection, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        if (connection.Protocol == "octoprint")
        {
            using var jobResponse = await SendAsync(HttpMethod.Get, connection.BaseUrl + "/api/job", connection.Protocol, connection.ApiKey, null, null, null, null, RequestTimeout, cancellationToken);
            using var printerResponse = await SendAsync(HttpMethod.Get, connection.BaseUrl + "/api/printer", connection.Protocol, connection.ApiKey, null, null, null, null, RequestTimeout, cancellationToken);
            var job = await ReadJsonAsync(jobResponse, cancellationToken);
            var printer = await ReadJsonAsync(printerResponse, cancellationToken);
            var rawNode = JsonNode.Parse(job.GetRawText()) as JsonObject ?? new JsonObject();
            rawNode["temperature"] = printer.TryGetProperty("temperature", out var temperature) ? JsonNode.Parse(temperature.GetRawText()) : new JsonObject();
            var raw = JsonSerializer.SerializeToElement(rawNode);
            return NormalizeOctoPrint(raw, connection.Printer);
        }

        if (connection.Protocol == "moonraker")
        {
            using var response = await SendAsync(HttpMethod.Get,
                connection.BaseUrl + "/printer/objects/query?print_stats&display_status&extruder&heater_bed",
                connection.Protocol, connection.ApiKey, null, null, null, null, RequestTimeout, cancellationToken);
            return NormalizeMoonraker(await ReadJsonAsync(response, cancellationToken), connection.Printer);
        }

        using var prusaPrinterResponse = await SendAsync(HttpMethod.Get, connection.BaseUrl + "/api/printer", connection.Protocol, null,
            connection.Username, connection.Password, null, null, RequestTimeout, cancellationToken);
        var printerJson = await ReadJsonAsync(prusaPrinterResponse, cancellationToken);
        JsonElement jobJson;
        try
        {
            using var jobResponse = await SendAsync(HttpMethod.Get, connection.BaseUrl + "/api/job", connection.Protocol, null,
                connection.Username, connection.Password, null, null, RequestTimeout, cancellationToken);
            jobJson = await ReadJsonAsync(jobResponse, cancellationToken);
        }
        catch (HttpRequestException) when (!cancellationToken.IsCancellationRequested)
        {
            jobJson = JsonSerializer.SerializeToElement(new { });
        }
        var prusaRaw = JsonSerializer.SerializeToElement(new { printer = printerJson, job = jobJson });
        return NormalizePrusaLink(prusaRaw, connection.Printer);
    }

    public async Task<HttpPrinterCommandResult> StartPrintAsync(HttpPrinterConnection connection, string localPath, string? fileName = null, string? checksum = null, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        var file = RequirePrintFile(localPath, fileName);
        if (connection.Protocol == "octoprint")
        {
            var form = new MultipartFormDataContent();
            var fileContent = new StreamContent(OpenPrintFile(file.Path));
            form.Add(fileContent, "file", file.Name);
            form.Add(new StringContent("true"), "select");
            form.Add(new StringContent("true"), "print");
            using var response = await SendAsync(HttpMethod.Post, connection.BaseUrl + "/api/files/local", connection.Protocol,
                connection.ApiKey, null, null, form, null, UploadTimeout, cancellationToken);
            return new HttpPrinterCommandResult(true, true, true, file.Name, await ReadOptionalJsonAsync(response, cancellationToken));
        }

        if (connection.Protocol == "moonraker")
        {
            var form = new MultipartFormDataContent();
            form.Add(new StringContent("gcodes"), "root");
            form.Add(new StringContent(file.Name), "path");
            form.Add(new StringContent("true"), "print");
            if (!string.IsNullOrWhiteSpace(checksum)) form.Add(new StringContent(checksum), "checksum");
            form.Add(new StreamContent(OpenPrintFile(file.Path)), "file", file.Name);
            using var response = await SendAsync(HttpMethod.Post, connection.BaseUrl + "/server/files/upload", connection.Protocol,
                connection.ApiKey, null, null, form, null, UploadTimeout, cancellationToken);
            return new HttpPrinterCommandResult(true, true, true, file.Name, await ReadOptionalJsonAsync(response, cancellationToken));
        }

        var bytes = await File.ReadAllBytesAsync(file.Path, cancellationToken);
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Headers.ContentLength = bytes.LongLength;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Print-After-Upload"] = "?1",
            ["Overwrite"] = "?1"
        };
        var encodedName = Uri.EscapeDataString(file.Name);
        using var prusaResponse = await SendAsync(HttpMethod.Put, connection.BaseUrl + "/api/v1/files/local/" + encodedName,
            connection.Protocol, null, connection.Username, connection.Password, content, headers, UploadTimeout, cancellationToken);
        return new HttpPrinterCommandResult(true, true, true, file.Name, await ReadOptionalJsonAsync(prusaResponse, cancellationToken));
    }

    public Task<HttpPrinterCommandResult> PauseAsync(HttpPrinterConnection connection, CancellationToken cancellationToken = default) =>
        SendPrinterCommandAsync(connection, "pause", cancellationToken);

    public Task<HttpPrinterCommandResult> ResumeAsync(HttpPrinterConnection connection, CancellationToken cancellationToken = default) =>
        SendPrinterCommandAsync(connection, "resume", cancellationToken);

    public Task<HttpPrinterCommandResult> CancelAsync(HttpPrinterConnection connection, CancellationToken cancellationToken = default) =>
        SendPrinterCommandAsync(connection, "cancel", cancellationToken);

    private async Task<HttpPrinterCommandResult> SendPrinterCommandAsync(HttpPrinterConnection connection, string action, CancellationToken cancellationToken)
    {
        RequireConnection(connection);
        if (connection.Protocol == "prusalink")
        {
            var status = await GetStatusAsync(connection, cancellationToken);
            var jobId = GetPrusaJobId(status.Raw);
            if (string.IsNullOrWhiteSpace(jobId)) throw new InvalidOperationException("Nao foi possivel identificar o job ativo no PrusaLink.");
            var uri = action switch
            {
                "pause" => connection.BaseUrl + "/api/v1/job/" + Uri.EscapeDataString(jobId) + "/pause",
                "resume" => connection.BaseUrl + "/api/v1/job/" + Uri.EscapeDataString(jobId) + "/resume",
                "cancel" => connection.BaseUrl + "/api/v1/job/" + Uri.EscapeDataString(jobId),
                _ => throw new ArgumentOutOfRangeException(nameof(action))
            };
            using var response = await SendAsync(action == "cancel" ? HttpMethod.Delete : HttpMethod.Put, uri, connection.Protocol,
                null, connection.Username, connection.Password, action == "cancel" ? null : new ByteArrayContent([]), null, RequestTimeout, cancellationToken);
            return new HttpPrinterCommandResult(true, Response: await ReadOptionalJsonAsync(response, cancellationToken));
        }

        string uriPath;
        byte[] body;
        if (connection.Protocol == "octoprint")
        {
            uriPath = "/api/job";
            object payload = action == "cancel" ? new { command = "cancel" } : new { command = "pause", action };
            body = JsonSerializer.SerializeToUtf8Bytes(payload);
        }
        else if (connection.Protocol == "moonraker")
        {
            uriPath = $"/printer/print/{action}";
            body = JsonSerializer.SerializeToUtf8Bytes(new { });
        }
        else throw new NotSupportedException($"Protocolo HTTP nao suportado: {connection.Protocol}.");
        using var content = new ByteArrayContent(body);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var commandResponse = await SendAsync(HttpMethod.Post, connection.BaseUrl + uriPath, connection.Protocol,
            connection.ApiKey, null, null, content, null, RequestTimeout, cancellationToken);
        return new HttpPrinterCommandResult(true, Response: await ReadOptionalJsonAsync(commandResponse, cancellationToken));
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string uri, string protocol, string? apiKey, string? username,
        string? password, HttpContent? content, IReadOnlyDictionary<string, string>? extraHeaders, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, uri) { Content = content };
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            if (protocol == "moonraker") request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            else request.Headers.TryAddWithoutValidation("X-Api-Key", apiKey);
        }
        if (protocol == "prusalink")
        {
            var value = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username ?? "maker"}:{password ?? string.Empty}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", value);
        }
        if (extraHeaders is not null)
            foreach (var header in extraHeaders) request.Headers.TryAddWithoutValidation(header.Key, header.Value);

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeoutSource.Token);
        if (!response.IsSuccessStatusCode)
        {
            var statusCode = response.StatusCode;
            response.Dispose();
            throw new HttpRequestException($"A impressora respondeu HTTP {(int)statusCode}.", null, statusCode);
        }
        return response;
    }

    private static HttpPrinterStatus NormalizeOctoPrint(JsonElement raw, NetworkPrinterDescriptor printer)
    {
        var state = GetPath(raw, "state", "text");
        return new HttpPrinterStatus(true, "octoprint", printer.Manufacturer, printer.Name ?? "OctoPrint", printer.Ip, printer.Port ?? 80,
            StringValue(state) ?? "unknown", Number(GetPath(raw, "progress", "completion")), MinutesFromSeconds(GetPath(raw, "progress", "printTimeLeft")),
            Number(GetPath(raw, "progress", "printTime")), Number(GetPath(raw, "job", "filamentUsed")), Number(GetPath(raw, "job", "filamentUsedMm")),
            Number(GetPath(raw, "temperature", "tool0", "actual")), Number(GetPath(raw, "temperature", "tool0", "target")),
            Number(GetPath(raw, "temperature", "bed", "actual")), Number(GetPath(raw, "temperature", "bed", "target")),
            StringValue(GetPath(raw, "job", "file", "name")), raw);
    }

    private static HttpPrinterStatus NormalizeMoonraker(JsonElement raw, NetworkPrinterDescriptor printer)
    {
        var printStats = GetPath(raw, "result", "status", "print_stats");
        var display = GetPath(raw, "result", "status", "display_status");
        var progress = Number(GetPath(display, "progress"));
        return new HttpPrinterStatus(true, "moonraker", printer.Manufacturer, printer.Name ?? "Moonraker / Klipper", printer.Ip, printer.Port ?? 7125,
            StringValue(GetPath(printStats, "state")) ?? "unknown", progress is null ? null : Math.Round(progress.Value * 100, MidpointRounding.AwayFromZero), null,
            Number(GetPath(printStats, "print_duration")), Number(GetPath(printStats, "filament_used")), Number(GetPath(printStats, "filament_used_mm")),
            Number(GetPath(raw, "result", "status", "extruder", "temperature")), Number(GetPath(raw, "result", "status", "extruder", "target")),
            Number(GetPath(raw, "result", "status", "heater_bed", "temperature")), Number(GetPath(raw, "result", "status", "heater_bed", "target")),
            StringValue(GetPath(printStats, "filename")), raw);
    }

    private static HttpPrinterStatus NormalizePrusaLink(JsonElement raw, NetworkPrinterDescriptor printer)
    {
        var printerData = GetPath(raw, "printer");
        var job = GetPath(raw, "job");
        var state = StringValue(GetPath(printerData, "state")) ?? StringValue(GetPath(job, "state")) ?? "unknown";
        var nozzle = Number(GetPath(printerData, "temp_nozzle")) ?? Number(GetPath(printerData, "temperature", "tool0", "actual"));
        var nozzleTarget = Number(GetPath(printerData, "target_nozzle")) ?? Number(GetPath(printerData, "temperature", "tool0", "target"));
        var bed = Number(GetPath(printerData, "temp_bed")) ?? Number(GetPath(printerData, "temperature", "bed", "actual"));
        var bedTarget = Number(GetPath(printerData, "target_bed")) ?? Number(GetPath(printerData, "temperature", "bed", "target"));
        return new HttpPrinterStatus(true, "prusalink", "Prusa", printer.Name ?? "PrusaLink", printer.Ip, printer.Port ?? 80, state,
            Number(GetPath(job, "progress")), MinutesFromSeconds(GetPath(job, "time_remaining")),
            Number(GetPath(job, "time_printed")) ?? Number(GetPath(job, "print_time")), Number(GetPath(job, "filamentUsed")),
            Number(GetPath(job, "filamentUsedMm")), nozzle, nozzleTarget, bed, bedTarget,
            StringValue(GetPath(job, "file", "name")) ?? StringValue(GetPath(job, "name")), raw);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement?> ReadOptionalJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }

    private static JsonElement GetPath(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out var next)) return default;
            current = next;
        }
        return current;
    }

    private static double? Number(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number)) return number;
        if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out number) && double.IsFinite(number)) return number;
        return null;
    }

    private static string? StringValue(JsonElement value) => value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static int? MinutesFromSeconds(JsonElement value) => Number(value) is { } seconds && seconds != 0 ? (int)Math.Ceiling(seconds / 60) : null;

    private static string? GetPrusaJobId(JsonElement raw)
    {
        foreach (var candidate in new[] { GetPath(raw, "job", "id"), GetPath(raw, "id"), GetPath(raw, "job_id") })
        {
            if (candidate.ValueKind == JsonValueKind.String) return candidate.GetString();
            if (candidate.ValueKind == JsonValueKind.Number) return candidate.GetRawText();
        }
        return null;
    }

    private static (string Path, string Name) RequirePrintFile(string localPath, string? fileName)
    {
        if (string.IsNullOrWhiteSpace(localPath) || !File.Exists(localPath)) throw new FileNotFoundException("Arquivo local nao encontrado para envio a impressora.", localPath);
        var name = string.IsNullOrWhiteSpace(fileName) ? Path.GetFileName(localPath) : Path.GetFileName(fileName.Trim());
        if (string.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("Nome do arquivo local invalido.");
        return (Path.GetFullPath(localPath), name);
    }

    private static FileStream OpenPrintFile(string path) => new(path, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
    private static string NormalizeProtocol(string value) => value.Trim().ToLowerInvariant() switch
    {
        "octoprint" => "octoprint",
        "moonraker" => "moonraker",
        "prusalink" => "prusalink",
        _ => throw new NotSupportedException($"Protocolo HTTP nao suportado: {value}.")
    };
    private static int DefaultPort(string protocol) => protocol == "moonraker" ? 7125 : 80;
    private static string? NonBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static void RequireConnection(HttpPrinterConnection? connection)
    {
        if (connection is null || !connection.Connected) throw new InvalidOperationException("Impressora nao esta conectada.");
    }

    public void Dispose()
    {
        if (_ownsClient) _httpClient.Dispose();
    }
}
