namespace FilaAgent.Runtime;

public sealed class AgentRuntimeStatusState
{
    private int _cloudConnected;
    private int _activePrintJobs;
    private int _realtimeMode;

    public AgentLocalStatus Snapshot => new(
        CloudConnected: Volatile.Read(ref _cloudConnected) == 1,
        ActivePrintJobs: Math.Max(0, Volatile.Read(ref _activePrintJobs)),
        RealtimeMode: Volatile.Read(ref _realtimeMode) switch { 1 => "websocket", 2 => "sse", _ => "offline" });

    public void SetCloudConnected(bool connected) => Volatile.Write(ref _cloudConnected, connected ? 1 : 0);
    public void SetActivePrintJobs(int count) => Volatile.Write(ref _activePrintJobs, Math.Max(0, count));
    public void SetRealtimeMode(string mode) => Volatile.Write(ref _realtimeMode, mode switch
    {
        "websocket" => 1,
        "sse" => 2,
        _ => 0
    });
}

public sealed class AgentRuntimeLoop(
    AgentRuntimeStartupService startup,
    AgentCredentialStore credentialStore,
    AgentCloudClient cloudClient,
    AgentCommandPollingService commandPolling,
    AgentLocalServer localServer,
    AgentRuntimeStatusState status,
    Func<object> runtimeInfo,
    Action<string>? log = null,
    TimeSpan? heartbeatInterval = null,
    TimeSpan? commandPollInterval = null,
    TimeSpan? commandPollMaxInterval = null,
    TimeSpan? retryInitialInterval = null,
    TimeSpan? retryMaxInterval = null,
    ProductionJobMonitorService? productionJobMonitors = null,
    IAgentRealtimeNotificationClient? realtimeNotifications = null,
    TimeSpan? webSocketCommandPollInterval = null,
    TimeSpan? sseCommandPollInterval = null)
{
    private readonly TimeSpan _heartbeatInterval = heartbeatInterval ?? TimeSpan.FromSeconds(30);
    private readonly TimeSpan _commandPollInterval = commandPollInterval ?? TimeSpan.FromSeconds(5);
    private readonly TimeSpan _commandPollMaxInterval = commandPollMaxInterval ?? TimeSpan.FromSeconds(30);
    private readonly TimeSpan _retryInitialInterval = retryInitialInterval ?? TimeSpan.FromSeconds(2);
    private readonly TimeSpan _retryMaxInterval = retryMaxInterval ?? TimeSpan.FromSeconds(30);
    private readonly ProductionJobMonitorService? _productionJobMonitors = productionJobMonitors;
    private readonly IAgentRealtimeNotificationClient? _realtimeNotifications = realtimeNotifications;
    private readonly TimeSpan _webSocketCommandPollInterval = webSocketCommandPollInterval ?? TimeSpan.FromSeconds(90);
    private readonly TimeSpan _sseCommandPollInterval = sseCommandPollInterval ?? TimeSpan.FromSeconds(45);

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await localServer.StartAsync(cancellationToken);
            var retryDelay = _retryInitialInterval;
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var initialized = await startup.InitializeAsync(cancellationToken);
                    if (initialized.State != AgentStartupState.Ready || initialized.Credentials is null)
                    {
                        status.SetCloudConnected(false);
                        if (!string.IsNullOrWhiteSpace(initialized.Error))
                        {
                            log?.Invoke($"Pareamento aguardando: {initialized.Error}");
                            await Task.Delay(retryDelay, cancellationToken);
                            retryDelay = NextDelay(retryDelay, _retryMaxInterval);
                        }
                        else
                        {
                            // A pairing code may arrive locally at any time; keep polling promptly when none is pending.
                            retryDelay = _retryInitialInterval;
                            await Task.Delay(_retryInitialInterval, cancellationToken);
                        }
                        continue;
                    }

                    retryDelay = _retryInitialInterval;
                    log?.Invoke($"Conectado ao Filamind como {initialized.Credentials.MachineName}.");
                    await RunConnectedAsync(initialized.Credentials, cancellationToken);
                }
                catch (AgentCredentialsRejectedException error)
                {
                    status.SetCloudConnected(false);
                    await credentialStore.ClearAsync(cancellationToken);
                    log?.Invoke($"Credencial do Agent recusada; aguardando novo pareamento: {error.Message}");
                    retryDelay = _retryInitialInterval;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception error)
                {
                    status.SetCloudConnected(false);
                    log?.Invoke($"Falha no ciclo do Agent: {error.GetType().Name}: {error.Message}");
                    await Task.Delay(retryDelay, cancellationToken);
                    retryDelay = NextDelay(retryDelay, _retryMaxInterval);
                }
            }
        }
        finally
        {
            status.SetCloudConnected(false);
            await localServer.DisposeAsync();
        }
    }

    private async Task RunConnectedAsync(AgentCredentials credentials, CancellationToken cancellationToken)
    {
        using var connectedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        using var commandWake = new SemaphoreSlim(0, 1);
        _productionJobMonitors?.StartPending(credentials, connectedCancellation.Token);
        var heartbeat = HeartbeatLoopAsync(credentials, connectedCancellation.Token);
        var commands = CommandLoopAsync(credentials, commandWake, connectedCancellation.Token);
        var realtime = _realtimeNotifications is null
            ? null
            : _realtimeNotifications.RunAsync(credentials,
                () => { try { commandWake.Release(); } catch (SemaphoreFullException) { } },
                mode =>
                {
                    status.SetRealtimeMode(mode);
                    try { commandWake.Release(); } catch (SemaphoreFullException) { }
                    log?.Invoke($"NotificaÃ§Ã£o de comandos: {mode}.");
                }, connectedCancellation.Token);
        Task completed = realtime is null
            ? await Task.WhenAny(heartbeat, commands)
            : await Task.WhenAny(heartbeat, commands, realtime);
        connectedCancellation.Cancel();
        try
        {
            if (realtime is null) await Task.WhenAll(heartbeat, commands);
            else await Task.WhenAll(heartbeat, commands, realtime);
        }
        catch (OperationCanceledException) when (connectedCancellation.IsCancellationRequested) { }
        finally { status.SetRealtimeMode("offline"); }
        if (cancellationToken.IsCancellationRequested) return;
        await completed;
        throw new InvalidOperationException("Um ciclo contínuo do Agent terminou inesperadamente.");
    }

    private async Task HeartbeatLoopAsync(AgentCredentials credentials, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await cloudClient.SendHeartbeatAsync(credentials, runtimeInfo(), cancellationToken);
                status.SetCloudConnected(true);
            }
            catch (AgentApiException error) when (error.HasInvalidCredentials)
            {
                throw new AgentCredentialsRejectedException(error.Message, error);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                status.SetCloudConnected(false);
                log?.Invoke($"Heartbeat falhou: {error.GetType().Name}: {error.Message}");
            }

            await Task.Delay(_heartbeatInterval, cancellationToken);
        }
    }

    private async Task CommandLoopAsync(AgentCredentials credentials, SemaphoreSlim commandWake,
        CancellationToken cancellationToken)
    {
        var delay = _commandPollInterval;
        while (!cancellationToken.IsCancellationRequested)
        {
            var mode = status.Snapshot.RealtimeMode;
            try
            {
                var result = await commandPolling.PollOnceAsync(credentials, cancellationToken);
                delay = mode switch
                {
                    "websocket" => _webSocketCommandPollInterval,
                    "sse" => _sseCommandPollInterval,
                    _ => result.Handled && result.Status == "completed"
                        ? _commandPollInterval
                        : NextDelay(delay, _commandPollMaxInterval)
                };
            }
            catch (AgentApiException error) when (error.HasInvalidCredentials)
            {
                throw new AgentCredentialsRejectedException(error.Message, error);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                log?.Invoke($"Consulta de comandos falhou: {error.GetType().Name}: {error.Message}");
                delay = mode switch
                {
                    "websocket" => _webSocketCommandPollInterval,
                    "sse" => _sseCommandPollInterval,
                    _ => NextDelay(delay, _commandPollMaxInterval)
                };
            }

            if (await WaitForWakeOrDelayAsync(commandWake, delay, cancellationToken))
            {
                delay = status.Snapshot.RealtimeMode switch
                {
                    "websocket" => _webSocketCommandPollInterval,
                    "sse" => _sseCommandPollInterval,
                    _ => _commandPollInterval
                };
            }
        }
    }

    private static async Task<bool> WaitForWakeOrDelayAsync(SemaphoreSlim commandWake, TimeSpan delay,
        CancellationToken cancellationToken)
    {
        using var waitCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var wake = commandWake.WaitAsync(waitCancellation.Token);
        var timer = Task.Delay(delay, waitCancellation.Token);
        var completed = await Task.WhenAny(wake, timer);
        waitCancellation.Cancel();
        try { await completed; }
        catch (OperationCanceledException) when (waitCancellation.IsCancellationRequested) { }
        cancellationToken.ThrowIfCancellationRequested();
        return completed == wake;
    }

    private static TimeSpan NextDelay(TimeSpan current, TimeSpan maximum)
    {
        var doubledTicks = current.Ticks > maximum.Ticks / 2 ? maximum.Ticks : current.Ticks * 2;
        return TimeSpan.FromTicks(Math.Clamp(doubledTicks, 1, maximum.Ticks));
    }

    private sealed class AgentCredentialsRejectedException(string message, Exception innerException)
        : Exception(message, innerException);
}
