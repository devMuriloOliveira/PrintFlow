using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using FilaAgent.Runtime;

internal static class BambuCertificateValidationChecks
{
    public static void Run(Action<bool, string> check)
    {
        var officialBundle = new X509Certificate2Collection();
        officialBundle.AddRange(BambuCertificateValidator.LoadTrustBundle());
        check(officialBundle.Count >= 3 && officialBundle.Cast<X509Certificate2>().Any(certificate =>
                certificate.GetNameInfo(X509NameType.SimpleName, false) == "BBL CA"),
            "runtime inclui o bundle oficial Bambu de autoridades TLS");

        using var rootKey = RSA.Create(2048);
        var rootRequest = new CertificateRequest("CN=Fila Agent TLS Test CA", rootKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        rootRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        rootRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        using var root = rootRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-10), DateTimeOffset.UtcNow.AddDays(10));
        using var intermediateKey = RSA.Create(2048);
        var intermediateRequest = new CertificateRequest("CN=Fila Agent TLS Test Intermediate", intermediateKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        intermediateRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        intermediateRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        using var intermediatePublic = intermediateRequest.Create(root, DateTimeOffset.UtcNow.AddDays(-5), DateTimeOffset.UtcNow.AddDays(5), RandomNumberGenerator.GetBytes(16));
        using var intermediate = intermediatePublic.CopyWithPrivateKey(intermediateKey);
        using var leafKey = RSA.Create(2048);
        var trustedRoots = new X509Certificate2Collection { root, intermediate };
        using var matchingLeaf = CreateLeaf(leafKey, intermediate, "PF-CERT-TEST-001", DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        check(BambuCertificateValidator.Validate(matchingLeaf, null, "PF-CERT-TEST-001", trustedRoots),
            "validação Bambu aceita cadeia confiável com CN igual ao serial");
        check(!BambuCertificateValidator.Validate(matchingLeaf, null, "PF-CERT-OTHER-002", trustedRoots),
            "validação Bambu rejeita certificado confiável com CN de outro serial");

        using var otherRootKey = RSA.Create(2048);
        var otherRootRequest = new CertificateRequest("CN=Untrusted Test CA", otherRootKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        otherRootRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        otherRootRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        using var otherRoot = otherRootRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        using var otherLeafKey = RSA.Create(2048);
        using var untrustedLeaf = CreateLeaf(otherLeafKey, otherRoot, "PF-CERT-TEST-001", DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        check(!BambuCertificateValidator.Validate(untrustedLeaf, null, "PF-CERT-TEST-001", trustedRoots),
            "validação Bambu rejeita certificado assinado por autoridade fora do bundle confiável");

        using var expiredLeafKey = RSA.Create(2048);
        using var expiredLeaf = CreateLeaf(expiredLeafKey, intermediate, "PF-CERT-TEST-001", DateTimeOffset.UtcNow.AddDays(-3), DateTimeOffset.UtcNow.AddDays(-2));
        check(!BambuCertificateValidator.Validate(expiredLeaf, null, "PF-CERT-TEST-001", trustedRoots),
            "validação Bambu rejeita certificado expirado");
    }

    private static X509Certificate2 CreateLeaf(RSA key, X509Certificate2 issuer, string serial, DateTimeOffset notBefore, DateTimeOffset notAfter)
    {
        var request = new CertificateRequest($"CN={serial}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        var serialBytes = RandomNumberGenerator.GetBytes(16);
        return request.Create(issuer, notBefore, notAfter, serialBytes);
    }
}
