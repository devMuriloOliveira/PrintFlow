using System.Net;
using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed record AgentCredentialRotationResult(AgentCredentials Credentials, bool Deferred, string? Error = null);

public sealed class AgentCredentialRotationService(AgentCloudClient api, AgentCredentialStore store)
{
    public async Task<AgentCredentialRotationResult> RecoverAndRotateAsync(AgentCredentials credentials, CancellationToken cancellationToken = default)
    {
        var current = credentials;
        if (current.PendingCredentialVersion is not null)
        {
            var confirmation = await api.ConfirmCredentialRotationAsync(current, cancellationToken);
            current = current with
            {
                CredentialVersion = ReadVersion(confirmation),
                PendingCredentialVersion = null
            };
            await store.SaveAsync(current, cancellationToken);
        }

        JsonElement rotation;
        try
        {
            rotation = await api.RotateCredentialAsync(current, cancellationToken);
        }
        catch (AgentApiException error) when (error.StatusCode == HttpStatusCode.Conflict)
        {
            return new AgentCredentialRotationResult(current, true, error.Message);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            return new AgentCredentialRotationResult(current, true, error.Message);
        }

        if (!rotation.TryGetProperty("agentSecret", out var secretValue) || string.IsNullOrWhiteSpace(secretValue.GetString()))
            return new AgentCredentialRotationResult(current, false);

        if (!rotation.TryGetProperty("credentialVersion", out var versionValue) || !versionValue.TryGetInt32(out var pendingVersion))
            return new AgentCredentialRotationResult(current, true, "A API retornou uma versão de credencial pendente inválida.");

        var pending = current with
        {
            AgentSecret = secretValue.GetString()!,
            PendingCredentialVersion = pendingVersion
        };
        await store.SaveAsync(pending, cancellationToken);

        try
        {
            var confirmation = await api.ConfirmCredentialRotationAsync(pending, cancellationToken);
            var confirmed = pending with
            {
                CredentialVersion = ReadVersion(confirmation),
                PendingCredentialVersion = null
            };
            await store.SaveAsync(confirmed, cancellationToken);
            return new AgentCredentialRotationResult(confirmed, false);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error)
        {
            // Preserve the pending secret on disk for recovery after restart; keep
            // using the old credential in memory while the backend's grace window is open.
            return new AgentCredentialRotationResult(current, true, error.Message);
        }
    }

    private static int ReadVersion(JsonElement response) =>
        response.TryGetProperty("credentialVersion", out var version) && version.TryGetInt32(out var value)
            ? value
            : throw new InvalidDataException("A API nao confirmou a versao da credencial.");
}
