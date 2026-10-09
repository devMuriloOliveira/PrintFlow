namespace FilaAgent.ReleaseTool;

public static class AuthenticodeVerificationPolicy
{
    private const string ExpectedUntrustedRootMessage =
        "A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider";

    public static bool IsAcceptable(int exitCode, string output)
    {
        if (exitCode == 0) return true;
        var normalizedOutput = System.Text.RegularExpressions.Regex.Replace(output, @"\s+", " ");
        if (exitCode != 1 || !normalizedOutput.Contains(ExpectedUntrustedRootMessage, StringComparison.OrdinalIgnoreCase))
            return false;

        var lines = output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (lines.Any(line => line.Contains("warning", StringComparison.OrdinalIgnoreCase) &&
                              !line.Equals("Number of warnings: 0", StringComparison.OrdinalIgnoreCase))) return false;

        var errorLines = lines.Where(line => line.Contains("error", StringComparison.OrdinalIgnoreCase) &&
                                             !line.Equals("Number of errors: 1", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (errorLines.Length == 0 || errorLines.Any(line =>
                !line.Contains("SignTool Error: A certificate chain processed, but terminated in a root", StringComparison.OrdinalIgnoreCase) &&
                !line.Contains("signing verification failed", StringComparison.OrdinalIgnoreCase)))
            return false;

        var invalidSignatureMessages = new[]
        {
            "hash mismatch", "bad digest", "no signature found", "not signed", "invalid signature",
            "revoked", "expired"
        };
        return !invalidSignatureMessages.Any(message => output.Contains(message, StringComparison.OrdinalIgnoreCase));
    }
}
