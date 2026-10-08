using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace FilaAgent.Runtime;

public interface IAgentRealtimeNotificationClient
{
    Task RunAsync(AgentCredentials credentials, Action commandAvailable, Action<string> modeChanged,
        CancellationToken cancellationToken = default);
}

public sealed class AgentRealtimeNotificationClient : IAgentRealtimeNotificationClient, IDisposable
{
    private static readonly TimeSpan InitialReconnectDelay = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaximumReconnectDelay = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan WebSocketConnectTimeout = TimeSpan.FromSeconds(15);
    private const int MaximumWebSocketMessageBytes = 4096;
    private const int MaximumSseLineCharacters = 8192;
    private readonly AgentConfiguration _configuration;
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private readonly Action<string>? _log;
    private bool _disposed;

    public AgentRealtimeNotificationClient(AgentConfiguration configuration, HttpClient? httpClient = null,
        Action<string>? log = null)
    {
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _http = httpClient ?? new HttpClient();
        _ownsHttp = httpClient is null;
        if (_ownsHttp) _http.Timeout = Timeout.InfiniteTimeSpan;
        _log = log;
    }

    public async Task RunAsync(AgentCredentials credentials, Action commandAvailable, Action<string> modeChanged,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(credentials);
        ArgumentNullException.ThrowIfNull(commandAvailable);
        ArgumentNullException.ThrowIfNull(modeChanged);

        using var stateChanged = new SemaphoreSlim(0, 1);
        var webSocketConnected = 0;
        var sseConnected = 0;
        var currentMode = "offline";

        void UpdateMode()
        {
            var mode = Volatile.Read(ref webSocketConnected) == 1
                ? "websocket"
                : Volatile.Read(ref sseConnected) == 1 ? "sse" : "offline";
            if (string.Equals(Interlocked.Exchange(ref currentMode, mode), mode, StringComparison.Ordinal)) return;
            modeChanged(mode);
        }

        void SetWebSocketConnected(bool connected)
        {
            Interlocked.Exchange(ref webSocketConnected, connected ? 1 : 0);
            try { stateChanged.Release(); } catch (SemaphoreFullException) { }
            UpdateMode();
        }

        void SetSseConnected(bool connected)
        {
            Interlocked.Exchange(ref sseConnected, connected ? 1 : 0);
            UpdateMode();
        }

        async Task WaitForWebSocketStateAsync(bool expected, CancellationToken token)
        {
            while ((Volatile.Read(ref webSocketConnected) == 1) != expected)
                await stateChanged.WaitAsync(token);
        }

        var firstWebSocketAttempt = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var webSocketLoop = WebSocketLoopAsync(credentials, commandAvailable, SetWebSocketConnected,
            firstWebSocketAttempt, cancellationToken);
        var sseLoop = SseFallbackLoopAsync(credentials, commandAvailable, SetSseConnected,
            () => Volatile.Read(ref webSocketConnected) == 1, WaitForWebSocketStateAsync,
            firstWebSocketAttempt.Task, cancellationToken);

        try { await Task.WhenAll(webSocketLoop, sseLoop); }
        finally
        {
            SetWebSocketConnected(false);
            SetSseConnected(false);
        }
    }

    public static Uri BuildWebSocketEndpoint(Uri configuredBase)
    {
        ArgumentNullException.ThrowIfNull(configuredBase);
        var builder = new UriBuilder(configuredBase)
        {
            Path = "/api/agents/ws",
            Query = string.Empty,
            Fragment = string.Empty
        };
        if (string.Equals(builder.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            builder.Scheme = "wss";
        else if (string.Equals(builder.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
            builder.Scheme = "ws";
        return builder.Uri;
    }

    public static Uri BuildSseEndpoint(Uri apiUrl) => new(apiUrl, "/api/agents/events");

    private async Task WebSocketLoopAsync(AgentCredentials credentials, Action commandAvailable,
        Action<bool> setConnected, TaskCompletionSource firstAttempt, CancellationToken cancellationToken)
    {
        var reconnectDelay = InitialReconnectDelay;
        var isFirstAttempt = true;
        while (!cancellationToken.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("x-agent-id", credentials.AgentId);
            socket.Options.SetRequestHeader("x-agent-secret", credentials.AgentSecret);
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

            try
            {
                using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                connectTimeout.CancelAfter(WebSocketConnectTimeout);
                await socket.ConnectAsync(BuildWebSocketEndpoint(_configuration.WebSocketUrl), connectTimeout.Token);
                firstAttempt.TrySetResult();
                isFirstAttempt = false;
                reconnectDelay = InitialReconnectDelay;
                setConnected(true);
                await ReceiveWebSocketEventsAsync(socket, commandAvailable, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (OperationCanceledException)
            {
                _log?.Invoke("Conexao WebSocket do Agent excedeu o tempo limite.");
            }
            catch (Exception error)
            {
                _log?.Invoke($"WebSocket do Agent indisponivel: {error.GetType().Name}: {error.Message}");
            }
            finally
            {
                if (isFirstAttempt)
                {
                    firstAttempt.TrySetResult();
                    isFirstAttempt = false;
                }
                setConnected(false);
            }

            await DelayBeforeReconnectAsync(reconnectDelay, cancellationToken);
            reconnectDelay = NextReconnectDelay(reconnectDelay);
        }
    }

    private async Task SseFallbackLoopAsync(AgentCredentials credentials, Action commandAvailable,
        Action<bool> setConnected, Func<bool> isWebSocketConnected,
        Func<bool, CancellationToken, Task> waitForWebSocketState, Task firstWebSocketAttempt,
        CancellationToken cancellationToken)
    {
        await firstWebSocketAttempt.WaitAsync(cancellationToken);
        var reconnectDelay = InitialReconnectDelay;
        while (!cancellationToken.IsCancellationRequested)
        {
            if (isWebSocketConnected())
            {
                await waitForWebSocketState(false, cancellationToken);
                continue;
            }

            using var session = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var streamTask = ReadSseSessionAsync(credentials, commandAvailable, setConnected, session.Token);
            var webSocketTask = waitForWebSocketState(true, session.Token);
            var completed = await Task.WhenAny(streamTask, webSocketTask);
            session.Cancel();

            if (completed == webSocketTask && isWebSocketConnected())
            {
                try { await streamTask; } catch (OperationCanceledException) when (session.IsCancellationRequested) { }
                reconnectDelay = InitialReconnectDelay;
                continue;
            }

            try { await streamTask; }
            catch (OperationCanceledException) when (session.IsCancellationRequested && cancellationToken.IsCancellationRequested) { throw; }
            catch (OperationCanceledException) when (session.IsCancellationRequested) { }
            catch (Exception error) { _log?.Invoke($"SSE do Agent indisponivel: {error.GetType().Name}: {error.Message}"); }
            finally { setConnected(false); }

            if (cancellationToken.IsCancellationRequested) break;
            await DelayBeforeReconnectAsync(reconnectDelay, cancellationToken);
            reconnectDelay = NextReconnectDelay(reconnectDelay);
        }
    }

    private async Task ReadSseSessionAsync(AgentCredentials credentials, Action commandAvailable,
        Action<bool> setConnected, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, BuildSseEndpoint(_configuration.ApiUrl));
        request.Headers.TryAddWithoutValidation("x-agent-id", credentials.AgentId);
        request.Headers.TryAddWithoutValidation("x-agent-secret", credentials.AgentSecret);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"SSE do Agent indisponivel (HTTP {(int)response.StatusCode}).");
        if (!string.Equals(response.Content.Headers.ContentType?.MediaType, "text/event-stream", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("A API respondeu com um tipo de conteudo inesperado para SSE.");

        setConnected(true);
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        await ConsumeSseEventsAsync(stream, commandAvailable, cancellationToken);
        throw new IOException("A conexao SSE do Agent foi encerrada pelo servidor.");
    }

    private static async Task ReceiveWebSocketEventsAsync(ClientWebSocket socket, Action commandAvailable,
        CancellationToken cancellationToken)
    {
        var receiveBuffer = new byte[1024];
        using var message = new MemoryStream();
        while (socket.State is WebSocketState.Open or WebSocketState.CloseSent)
        {
            var result = await socket.ReceiveAsync(receiveBuffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                if (socket.State == WebSocketState.CloseReceived)
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", cancellationToken);
                return;
            }
            if (result.MessageType != WebSocketMessageType.Text)
            {
                message.SetLength(0);
                continue;
            }

            message.Write(receiveBuffer, 0, result.Count);
            if (message.Length > MaximumWebSocketMessageBytes)
                throw new InvalidDataException("Evento WebSocket do Agent excedeu o limite permitido.");
            if (!result.EndOfMessage) continue;

            if (IsCommandAvailableMessage(Encoding.UTF8.GetString(message.GetBuffer(), 0, checked((int)message.Length))))
                commandAvailable();
            message.SetLength(0);
        }
    }

    private static async Task ConsumeSseEventsAsync(Stream stream, Action commandAvailable,
        CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true,
            bufferSize: 1024, leaveOpen: true);
        var eventName = "message";
        var data = new List<string>();
        var dataLength = 0;
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (line.Length > MaximumSseLineCharacters) throw new InvalidDataException("Linha SSE do Agent excedeu o limite permitido.");
            if (line.Length == 0)
            {
                if (IsCommandAvailableEvent(eventName, data)) commandAvailable();
                eventName = "message";
                data.Clear();
                dataLength = 0;
                continue;
            }
            if (line[0] == ':') continue;
            var separator = line.IndexOf(':');
            var field = separator < 0 ? line : line[..separator];
            var value = separator < 0 ? string.Empty : line[(separator + 1)..].TrimStart(' ');
            if (field == "event") eventName = value;
            else if (field == "data")
            {
                dataLength += value.Length;
                if (dataLength > MaximumWebSocketMessageBytes)
                    throw new InvalidDataException("Evento SSE do Agent excedeu o limite permitido.");
                data.Add(value);
            }
        }
    }

    private static bool IsCommandAvailableEvent(string eventName, IReadOnlyList<string> data) =>
        string.Equals(eventName, "command", StringComparison.Ordinal) &&
        IsCommandAvailableMessage(string.Join('\n', data));

    private static bool IsCommandAvailableMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return false;
        try
        {
            using var document = JsonDocument.Parse(message);
            return document.RootElement.ValueKind == JsonValueKind.Object &&
                document.RootElement.TryGetProperty("type", out var type) &&
                type.ValueKind == JsonValueKind.String &&
                string.Equals(type.GetString(), "command_available", StringComparison.Ordinal);
        }
        catch (JsonException) { return false; }
    }

    private static async Task DelayBeforeReconnectAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        var jitterMilliseconds = Random.Shared.Next(0, 251);
        await Task.Delay(delay + TimeSpan.FromMilliseconds(jitterMilliseconds), cancellationToken);
    }

    private static TimeSpan NextReconnectDelay(TimeSpan current) =>
        TimeSpan.FromTicks(Math.Min(current.Ticks * 2, MaximumReconnectDelay.Ticks));

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_ownsHttp) _http.Dispose();
    }
}
