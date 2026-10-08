namespace FilaAgent.Runtime;

public enum AgentStartupState
{
    AwaitingPairing,
    Ready
}

public sealed record AgentStartupResult(
    AgentStartupState State,
    AgentCredentials? Credentials,
    bool PairedThisRun = false,
    bool CredentialsRejected = false,
    AgentCredentialRotationResult? CredentialRotation = null,
    AgentPrinterReconnectSummary? PrinterReconnect = null,
    string? PrinterReconnectError = null,
    string? Error = null);

public sealed class AgentRuntimeStartupService
{
    private readonly AgentCloudClient _cloud;
    private readonly AgentCredentialStore _credentialStore;
    private readonly AgentPrinterConnectionManager _printers;
    private readonly string _machineName;
    private readonly string _platform;
    private readonly string _architecture;
    private readonly string _version;

    public AgentRuntimeStartupService(AgentCloudClient cloud, AgentCredentialStore credentialStore,
        AgentPrinterConnectionManager printers, string machineName, string platform, string architecture, string version)
    {
        _cloud = cloud ?? throw new ArgumentNullException(nameof(cloud));
        _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
        _printers = printers ?? throw new ArgumentNullException(nameof(printers));
        _machineName = Required(machineName, nameof(machineName));
        _platform = Required(platform, nameof(platform));
        _architecture = Required(architecture, nameof(architecture));
        _version = Required(version, nameof(version));
    }

    public async Task<AgentStartupResult> InitializeAsync(CancellationToken cancellationToken = default)
    {
        var credentials = await _credentialStore.LoadAsync(cancellationToken);
        var pairedThisRun = false;

        if (credentials is null)
        {
            var pairingCode = await _credentialStore.ConsumePendingPairingCodeAsync(cancellationToken: cancellationToken);
            if (pairingCode.Length == 0) return new AgentStartupResult(AgentStartupState.AwaitingPairing, null);

            try
            {
                credentials = await _cloud.PairAsync(pairingCode, _machineName, _platform, _architecture, _version, cancellationToken);
                await _credentialStore.SaveAsync(credentials, cancellationToken);
                pairedThisRun = true;
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception error)
            {
                return new AgentStartupResult(AgentStartupState.AwaitingPairing, null, Error: error.Message);
            }
        }
        else
        {
            // Match Node behavior: an incoming pairing code cannot silently replace an existing account.
            await _credentialStore.ConsumePendingPairingCodeAsync(cancellationToken: cancellationToken);
        }

        try
        {
            await _cloud.VerifyAsync(credentials, cancellationToken);
        }
        catch (AgentApiException error) when (error.HasInvalidCredentials)
        {
            await _credentialStore.ClearAsync(cancellationToken);
            return new AgentStartupResult(AgentStartupState.AwaitingPairing, null,
                PairedThisRun: pairedThisRun, CredentialsRejected: true, Error: error.Message);
        }

        var rotation = await new AgentCredentialRotationService(_cloud, _credentialStore)
            .RecoverAndRotateAsync(credentials, cancellationToken);
        credentials = rotation.Credentials;

        AgentPrinterReconnectSummary? reconnect = null;
        string? reconnectError = null;
        try
        {
            reconnect = await _printers.RestoreRegisteredPrintersAsync(credentials, cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            // Printer restore is best effort in Node; a cloud outage must not prevent the Agent from starting.
            reconnectError = error.Message;
        }

        return new AgentStartupResult(AgentStartupState.Ready, credentials, pairedThisRun,
            CredentialRotation: rotation, PrinterReconnect: reconnect, PrinterReconnectError: reconnectError);
    }

    private static string Required(string value, string name) => string.IsNullOrWhiteSpace(value)
        ? throw new ArgumentException("Valor obrigatorio.", name)
        : value.Trim();
}
