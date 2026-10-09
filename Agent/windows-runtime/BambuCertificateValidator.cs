using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Net.Security;

namespace FilaAgent.Runtime;

public static class BambuCertificateValidator
{
    private const string BundleResourceName = "FilaAgent.Runtime.BambuPrinterCaBundle.pem";
    private static readonly Lazy<X509Certificate2Collection> TrustBundle = new(LoadTrustBundleCore);

    public static void SetTlsTargetHost(SslClientAuthenticationOptions options, string expectedSerial)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrWhiteSpace(expectedSerial)) throw new ArgumentException("Serial Bambu obrigatório para TLS.", nameof(expectedSerial));
        options.TargetHost = expectedSerial;
    }

    public static bool Validate(X509Certificate? certificate, X509Chain? peerChain, string expectedSerial) =>
        Validate(certificate, peerChain, expectedSerial, TrustBundle.Value);

    public static bool Validate(
        X509Certificate? certificate,
        X509Chain? peerChain,
        string expectedSerial,
        X509Certificate2Collection trustBundle)
    {
        if (certificate is null || string.IsNullOrWhiteSpace(expectedSerial) || trustBundle.Count == 0) return false;

        try
        {
            using var leaf = new X509Certificate2(certificate);
            if (!string.Equals(leaf.GetNameInfo(X509NameType.SimpleName, forIssuer: false), expectedSerial, StringComparison.Ordinal))
                return false;

            using var chain = new X509Chain();
            chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
            chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
            chain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;

            foreach (var authority in trustBundle)
            {
                if (authority.SubjectName.RawData.AsSpan().SequenceEqual(authority.IssuerName.RawData))
                    chain.ChainPolicy.CustomTrustStore.Add(authority);
                else
                    chain.ChainPolicy.ExtraStore.Add(authority);
            }

            if (peerChain is not null)
            {
                foreach (var element in peerChain.ChainElements)
                {
                    if (!element.Certificate.RawData.AsSpan().SequenceEqual(leaf.RawData))
                        chain.ChainPolicy.ExtraStore.Add(element.Certificate);
                }
            }

            return chain.Build(leaf);
        }
        catch (CryptographicException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    public static X509Certificate2Collection LoadTrustBundle()
    {
        var copies = new X509Certificate2Collection();
        foreach (var certificate in TrustBundle.Value) copies.Add(new X509Certificate2(certificate));
        return copies;
    }

    private static X509Certificate2Collection LoadTrustBundleCore()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(BundleResourceName)
            ?? throw new InvalidOperationException("Bundle de certificados Bambu não está incluído no runtime.");
        using var reader = new StreamReader(stream);
        var pem = reader.ReadToEnd();
        var certificates = new X509Certificate2Collection();
        certificates.ImportFromPem(pem);
        if (certificates.Count == 0) throw new InvalidOperationException("Bundle de certificados Bambu está vazio ou inválido.");
        return certificates;
    }
}
