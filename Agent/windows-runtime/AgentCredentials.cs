namespace FilaAgent.Runtime;

public sealed record AgentCredentials
{
    public string AgentId { get; init; } = string.Empty;
    public string AgentSecret { get; init; } = string.Empty;
    public string TenantId { get; init; } = string.Empty;
    public string TenantName { get; init; } = string.Empty;
    public string MachineName { get; init; } = string.Empty;
    public int? CredentialVersion { get; init; }
    public int? PendingCredentialVersion { get; init; }
}

public sealed record PendingPairing(string Code, DateTimeOffset CreatedAt);
