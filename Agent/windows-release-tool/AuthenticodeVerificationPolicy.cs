namespace FilaAgent.ReleaseTool;

public static class AuthenticodeVerificationPolicy
{
    private const string ExpectedUntrustedRootMessage =
        "A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider";

    public static bool IsAcceptable(int exitCode, string output)
    {
        if (exitCode == 0) return true;
        if (exitCode != 1 || !output.Contains(ExpectedUntrustedRootMessage, StringComparison.OrdinalIgnoreCase))
            return false;

        var lines = output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (lines.Any(line => line.Contains("warning", StringComparison.OrdinalIgnoreCase))) return false;

        var errorLines = lines.Where(line => line.Contains("error", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (errorLines.Length == 0 || errorLines.Any(line =>
                !line.Contains(ExpectedUntrustedRootMessage, StringComparison.OrdinalIgnoreCase) &&
                !line.Contains("signing verification failed", StringComparison.OrdinalIgnoreCase)))
            return false;

        var invalidSignatureMessages = new[]
        {
            "hash mismatch", "bad digest", "no signature found", "not signed", "invalid signature",
            "revoked", "expired", "timestamp"
        };
        return !invalidSignatureMessages.Any(message => output.Contains(message, StringComparison.OrdinalIgnoreCase));
    }
}
