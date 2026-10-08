using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FilaAgent.Runtime;

public sealed record AgentLocalStatus(bool CloudConnected = false, bool UpdateBlocked = false, string? UpdateBlockedReason = null, int ActivePrintJobs = 0, string RealtimeMode = "offline");

public sealed partial class AgentLocalServer : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly TcpListener _listener;
    private readonly AgentCredentialStore _credentials;
    private readonly AgentDiagnosticsTokenStore? _diagnosticsToken;
    private readonly HashSet<string> _allowedOrigins;
    private readonly Func<AgentLocalStatus> _getStatus;
    private readonly Func<object>? _getDiagnostics;
    private readonly string _version;
    private readonly Stopwatch _uptime = Stopwatch.StartNew();
    private readonly CancellationTokenSource _stop = new();
    private readonly int _port;
    private Task? _acceptLoop;
    private int _disposed;

    public AgentLocalServer(int port, IEnumerable<string> allowedOrigins, AgentCredentialStore credentials,
        Func<AgentLocalStatus>? getStatus = null, string version = "0.1.26",
        AgentDiagnosticsTokenStore? diagnosticsToken = null, Func<object>? getDiagnostics = null)
    {
        _port = port is >= 1 and <= 65535 ? port : 17873;
        _listener = new TcpListener(IPAddress.Loopback, _port);
        _allowedOrigins = allowedOrigins.ToHashSet(StringComparer.Ordinal);
        _credentials = credentials;
        _diagnosticsToken = diagnosticsToken;
        _getStatus = getStatus ?? (() => new AgentLocalStatus());
        _getDiagnostics = getDiagnostics;
        _version = string.IsNullOrWhiteSpace(version) ? "0.0.0" : version.Trim();
    }

    public int Port => _port;

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _listener.Start(128);
        _acceptLoop = AcceptLoopAsync(_stop.Token);
        return Task.CompletedTask;
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(cancellationToken); }
            catch (OperationCanceledException) { break; }
            catch (SocketException) when (cancellationToken.IsCancellationRequested) { break; }
            _ = HandleAsync(client, cancellationToken);
        }
    }

    private async Task HandleAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        {
            var stream = client.GetStream();
            try
            {
                var request = await ReadRequestAsync(stream, cancellationToken);
                var origin = request.Headers.GetValueOrDefault("origin", string.Empty).Trim();
                if (origin.Length > 0 && !_allowedOrigins.Contains(origin))
                {
                    await WriteJsonAsync(stream, 403, new { ok = false, error = "Origem nao autorizada para o Agent local." }, string.Empty, cancellationToken);
                    return;
                }

                if (request.Method == "OPTIONS")
                {
                    await WriteJsonAsync(stream, 204, new { }, origin, cancellationToken);
                    return;
                }

                if (request.Method == "GET" && request.Path == "/healthz")
                {
                    var credentials = await _credentials.LoadAsync(cancellationToken);
                    var status = _getStatus();
                    await WriteJsonAsync(stream, 200, new
                    {
                        ok = true,
                        app = "fila-agent",
                        version = _version,
                        paired = !string.IsNullOrWhiteSpace(credentials?.AgentId),
                        updateBlocked = status.UpdateBlocked,
                        updateBlockedReason = status.UpdateBlockedReason,
                        cloudConnected = status.CloudConnected,
                        realtimeMode = status.RealtimeMode,
                        activePrintJobs = Math.Max(0, status.ActivePrintJobs)
                    }, origin, cancellationToken);
                    return;
                }

                if (request.Method == "GET" && request.Path == "/diagnostics")
                {
                    if (origin.Length > 0)
                    {
                        await WriteJsonAsync(stream, 403, new { ok = false, error = "Diagnostico disponivel somente para acesso local direto." }, string.Empty, cancellationToken);
                        return;
                    }
                    if (_diagnosticsToken is null || !_diagnosticsToken.IsAvailable)
                    {
                        await WriteJsonAsync(stream, 503, new { ok = false, error = "Diagnostico local nao configurado." }, string.Empty, cancellationToken);
                        return;
                    }
                    var providedToken = request.Headers.GetValueOrDefault("x-fila-agent-diagnostics-token",
                        request.Headers.GetValueOrDefault("x-printflow-diagnostics-token", string.Empty));
                    if (!HasValidDiagnosticsToken(providedToken, _diagnosticsToken.Token))
                    {
                        await WriteJsonAsync(stream, 401, new { ok = false, error = "Token local de diagnostico invalido." }, string.Empty, cancellationToken);
                        return;
                    }

                    var credentials = await _credentials.LoadAsync(cancellationToken);
                    var status = _getStatus();
                    var diagnostics = JsonSerializer.SerializeToNode(new
                    {
                        ok = true,
                        generatedAt = DateTimeOffset.UtcNow,
                        agent = new
                        {
                            version = _version,
                            paired = !string.IsNullOrWhiteSpace(credentials?.AgentId),
                            uptimeSeconds = Math.Max(0, (long)_uptime.Elapsed.TotalSeconds),
                            runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                            platform = "win32",
                            arch = GetArchitecture()
                        },
                        runtime = new
                        {
                            updateBlocked = status.UpdateBlocked,
                            updateBlockedReason = status.UpdateBlockedReason,
                            activePrintJobs = Math.Max(0, status.ActivePrintJobs)
                        },
                        network = new { interfaces = GetNetworkInterfaces() }
                    }, JsonOptions) as JsonObject ?? new JsonObject();
                    if (_getDiagnostics?.Invoke() is { } details && JsonSerializer.SerializeToNode(details, JsonOptions) is JsonObject detailsObject)
                    {
                        foreach (var property in detailsObject)
                        {
                            if (property.Key is "ok" or "generatedAt" or "agent" or "runtime" or "network") continue;
                            diagnostics[property.Key] = property.Value?.DeepClone();
                        }
                    }
                    await WriteJsonAsync(stream, 200, SanitizeDiagnostics(diagnostics) ?? new JsonObject(), string.Empty, cancellationToken);
                    return;
                }

                if (request.Method == "POST" && request.Path == "/pair")
                {
                    var existing = await _credentials.LoadAsync(cancellationToken);
                    if (!string.IsNullOrWhiteSpace(existing?.AgentId))
                    {
                        await WriteJsonAsync(stream, 409, new { ok = false, error = "Agent ja pareado. Revogue o vinculo atual antes de conectar outra empresa." }, origin, cancellationToken);
                        return;
                    }
                    if (request.Body.Length > 2048)
                    {
                        await WriteJsonAsync(stream, 413, new { ok = false, error = "Payload muito grande." }, origin, cancellationToken);
                        return;
                    }
                    using var document = JsonDocument.Parse(request.Body.Length == 0 ? "{}" : Encoding.UTF8.GetString(request.Body));
                    var code = document.RootElement.TryGetProperty("code", out var value) ? value.GetString()?.Trim().ToUpperInvariant() ?? string.Empty : string.Empty;
                    if (!PairingCode().IsMatch(code))
                    {
                        await WriteJsonAsync(stream, 400, new { ok = false, error = "Codigo de pareamento invalido." }, origin, cancellationToken);
                        return;
                    }
                    await _credentials.SavePendingPairingCodeAsync(code, cancellationToken);
                    await WriteJsonAsync(stream, 202, new { ok = true, status = "pairing_queued" }, origin, cancellationToken);
                    return;
                }

                await WriteJsonAsync(stream, 404, new { ok = false, error = "Rota local nao encontrada." }, origin, cancellationToken);
            }
            catch (JsonException)
            {
                await WriteJsonAsync(stream, 400, new { ok = false, error = "JSON invalido." }, string.Empty, cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException && stream.CanWrite)
            {
                try { await WriteJsonAsync(stream, 500, new { ok = false, error = error.Message }, string.Empty, cancellationToken); } catch { }
            }
        }
    }

    private static async Task<HttpRequestData> ReadRequestAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        using var headerBytes = new MemoryStream();
        var singleByte = new byte[1];
        var matched = 0;
        var terminator = new byte[] { 13, 10, 13, 10 };
        while (headerBytes.Length <= 16 * 1024)
        {
            var read = await stream.ReadAsync(singleByte, cancellationToken);
            if (read == 0) throw new InvalidDataException("Conexao HTTP encerrada antes dos cabecalhos.");
            headerBytes.WriteByte(singleByte[0]);
            matched = singleByte[0] == terminator[matched] ? matched + 1 : singleByte[0] == terminator[0] ? 1 : 0;
            if (matched == terminator.Length) break;
        }
        if (matched != terminator.Length) throw new InvalidDataException("Cabecalhos HTTP muito grandes.");

        var lines = Encoding.ASCII.GetString(headerBytes.ToArray()).Split("\r\n", StringSplitOptions.None);
        var requestLine = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (requestLine.Length < 2) throw new InvalidDataException("Linha de requisicao HTTP invalida.");
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1).Where(line => line.Length > 0))
        {
            var separator = line.IndexOf(':');
            if (separator <= 0) throw new InvalidDataException("Cabecalho HTTP invalido.");
            headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
        }
        if (headers.ContainsKey("Transfer-Encoding")) throw new InvalidDataException("Transfer-Encoding nao suportado.");
        if (!int.TryParse(headers.GetValueOrDefault("Content-Length", "0"), out var contentLength) || contentLength < 0 || contentLength > 16 * 1024)
            throw new InvalidDataException("Tamanho do corpo HTTP invalido.");
        var body = new byte[contentLength];
        if (contentLength > 0) await stream.ReadExactlyAsync(body, cancellationToken);
        var path = requestLine[1].Split('?', 2)[0];
        return new HttpRequestData(requestLine[0].ToUpperInvariant(), path, headers, body);
    }

    private static async Task WriteJsonAsync(NetworkStream stream, int statusCode, object payload, string origin, CancellationToken cancellationToken)
    {
        var body = statusCode == 204 ? [] : JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        var reason = statusCode switch
        {
            200 => "OK", 202 => "Accepted", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden",
            404 => "Not Found", 409 => "Conflict", 413 => "Payload Too Large", 503 => "Service Unavailable", _ => "Internal Server Error"
        };
        var headers = new StringBuilder()
            .Append("HTTP/1.1 ").Append(statusCode).Append(' ').Append(reason).Append("\r\n")
            .Append("Content-Type: application/json; charset=utf-8\r\n")
            .Append("Cache-Control: no-store\r\n")
            .Append("Connection: close\r\n")
            .Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
            .Append("Access-Control-Allow-Headers: Content-Type\r\n")
            .Append("Access-Control-Allow-Private-Network: true\r\n")
            .Append("Access-Control-Max-Age: 600\r\n");
        if (origin.Length > 0) headers.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\nVary: Origin\r\n");
        headers.Append("Content-Length: ").Append(body.Length).Append("\r\n\r\n");
        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers.ToString()), cancellationToken);
        if (body.Length > 0) await stream.WriteAsync(body, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1) return;
        _stop.Cancel();
        _listener.Stop();
        if (_acceptLoop is not null)
        {
            try { await _acceptLoop; } catch (SocketException) { }
        }
        _stop.Dispose();
        _diagnosticsToken?.Dispose();
    }

    private sealed record HttpRequestData(string Method, string Path, IReadOnlyDictionary<string, string> Headers, byte[] Body);

    private static bool HasValidDiagnosticsToken(string provided, string expected)
    {
        if (string.IsNullOrEmpty(provided) || provided.Length != expected.Length) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected));
    }

    private static object[] GetNetworkInterfaces()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .SelectMany(network => network.GetIPProperties().UnicastAddresses.Select(address => new
                {
                    name = network.Name,
                    family = address.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? "IPv4" : "IPv6",
                    @internal = IPAddress.IsLoopback(address.Address),
                    address = RedactAddress(address.Address)
                }))
                .Cast<object>()
                .ToArray();
        }
        catch { return []; }
    }

    private static string RedactAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return address.ToString();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var parts = address.ToString().Split('.');
            return parts.Length == 4 ? string.Join('.', parts[0], parts[1], parts[2], "x") : "[redacted]";
        }
        return "[ipv6-redacted]";
    }

    private static JsonNode? SanitizeDiagnostics(JsonNode? node, string? propertyName = null)
    {
        if (node is JsonObject objectNode)
        {
            var sanitized = new JsonObject();
            foreach (var property in objectNode)
            {
                if (Regex.IsMatch(property.Key, "(?:secret|token|password|access.?code|authorization|credential|api.?key)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) continue;
                sanitized[property.Key] = SanitizeDiagnostics(property.Value, property.Key);
            }
            return sanitized;
        }
        if (node is JsonArray arrayNode)
        {
            var sanitized = new JsonArray();
            foreach (var item in arrayNode) sanitized.Add(SanitizeDiagnostics(item));
            return sanitized;
        }
        if (node is JsonValue value && value.TryGetValue<string>(out var text))
        {
            if (propertyName is not null && Regex.IsMatch(propertyName, "^(?:ip|address|host|hostname)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            {
                if (IPAddress.TryParse(text, out var address)) return JsonValue.Create(RedactAddress(address));
                return JsonValue.Create(text);
            }
            if (propertyName is not null && Regex.IsMatch(propertyName, "serial", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                return JsonValue.Create(text.Length > 4 ? "***" + text[^4..] : "[redacted]");
        }
        return node?.DeepClone();
    }

    private static string GetArchitecture() => System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture switch
    {
        System.Runtime.InteropServices.Architecture.X64 => "x64",
        System.Runtime.InteropServices.Architecture.Arm64 => "arm64",
        System.Runtime.InteropServices.Architecture.X86 => "ia32",
        _ => System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant()
    };

    [GeneratedRegex("^[A-Z0-9-]{6,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex PairingCode();
}
