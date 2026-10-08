using System.Buffers.Binary;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;

namespace FilaAgent.Runtime;

public sealed record LocalIpv4Network(string Interface, string Address, string Netmask);
public sealed record Ipv4HostRange(string Start, string End, bool Truncated, long TotalHosts);
public sealed record PrinterNetworkCandidate(
    string ConnectionType,
    string Protocol,
    string Software,
    string? Manufacturer,
    string Ip,
    int Port,
    string Name,
    bool RequiresCredentials,
    IReadOnlyList<string> RequiredCredentials,
    string? Model = null,
    string? Serial = null,
    bool Mock = false);
public sealed record NetworkDiscoveryResult(IReadOnlyList<PrinterNetworkCandidate> Printers, IReadOnlyList<string> Warnings);

public interface IPrinterPortConnectProbe
{
    Task<bool> IsOpenAsync(string host, int port, TimeSpan timeout, CancellationToken cancellationToken = default);
}

public sealed class TcpPrinterPortConnectProbe : IPrinterPortConnectProbe
{
    public async Task<bool> IsOpenAsync(string host, int port, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        using var client = new TcpClient();
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        try
        {
            await client.ConnectAsync(host, port, timeoutSource.Token);
            return true;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return false; }
        catch (Exception error) when (error is SocketException or IOException or ArgumentException) { return false; }
    }
}

public sealed class NetworkDiscoveryService : IDisposable
{
    private static readonly int[] PrinterPorts = [80, 7125, 5000, 8883];
    private readonly IPrinterPortConnectProbe _portProbe;
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly Func<CancellationToken, Task<IReadOnlyList<BambuNetworkCandidate>>> _ssdpDiscovery;

    public NetworkDiscoveryService(
        IPrinterPortConnectProbe? portProbe = null,
        HttpClient? httpClient = null,
        Func<CancellationToken, Task<IReadOnlyList<BambuNetworkCandidate>>>? ssdpDiscovery = null)
    {
        _portProbe = portProbe ?? new TcpPrinterPortConnectProbe();
        _httpClient = httpClient ?? new HttpClient();
        _ownsHttpClient = httpClient is null;
        _ssdpDiscovery = ssdpDiscovery ?? (token => BambuSsdpDiscoveryService.DiscoverAsync(1200, token));
    }

    public static IReadOnlyList<LocalIpv4Network> GetLocalNetworks()
    {
        var networks = new List<LocalIpv4Network>();
        foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (networkInterface.NetworkInterfaceType == NetworkInterfaceType.Loopback || networkInterface.OperationalStatus != OperationalStatus.Up) continue;
            var properties = networkInterface.GetIPProperties();
            foreach (var unicast in properties.UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork || unicast.IPv4Mask is null) continue;
                networks.Add(new LocalIpv4Network(networkInterface.Name, unicast.Address.ToString(), unicast.IPv4Mask.ToString()));
            }
        }
        return networks;
    }

    public static Ipv4HostRange? GetHostRange(string address, string netmask, int maxHosts = 1024)
    {
        if (!TryToUInt32(address, out var addressValue) || !TryToUInt32(netmask, out var maskValue)) return null;
        var network = addressValue & maskValue;
        var broadcast = network | ~maskValue;
        var firstHost = (ulong)network + 1;
        if ((ulong)broadcast <= firstHost) return null;
        var lastHost = (ulong)broadcast - 1;
        if (firstHost > lastHost || firstHost > uint.MaxValue) return null;

        var boundedMax = Math.Clamp(maxHosts > 0 ? maxHosts : 1024, 1, 4096);
        var end = Math.Min(lastHost, firstHost + (ulong)boundedMax - 1);
        return new Ipv4HostRange(ToIpv4((uint)firstHost), ToIpv4((uint)end), end < lastHost, (long)broadcast - network - 1);
    }

    public async Task<IReadOnlyList<int>> FindOpenPrinterPortsAsync(string ip, CancellationToken cancellationToken = default)
    {
        var results = await Task.WhenAll(PrinterPorts.Select(async port =>
            (Port: port, Open: await _portProbe.IsOpenAsync(ip, port, TimeSpan.FromMilliseconds(350), cancellationToken))));
        cancellationToken.ThrowIfCancellationRequested();
        return results.Where(result => result.Open).Select(result => result.Port).ToArray();
    }

    public async Task<PrinterNetworkCandidate?> IdentifyPrinterAsync(string ip, CancellationToken cancellationToken = default)
    {
        foreach (var port in await FindOpenPrinterPortsAsync(ip, cancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (port == 8883) return CreateBambuCandidate(ip);
            var moonraker = await DetectMoonrakerAsync(ip, port, cancellationToken);
            if (moonraker is not null) return moonraker;
            var octoPrint = await DetectOctoPrintAsync(ip, port, cancellationToken);
            if (octoPrint is not null) return octoPrint;
            var prusaLink = await DetectPrusaLinkAsync(ip, port, cancellationToken);
            if (prusaLink is not null) return prusaLink;
        }
        return null;
    }

    public async Task<NetworkDiscoveryResult> ScanAsync(
        IReadOnlyList<LocalIpv4Network>? networks = null,
        Action<PrinterNetworkCandidate>? onPrinterDiscovered = null,
        IReadOnlyDictionary<string, string?>? environment = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        environment ??= Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);

        var warnings = new List<string>();
        var printers = new List<PrinterNetworkCandidate>();
        if (IsMockBambuEnabled(environment))
        {
            var mock = new PrinterNetworkCandidate("network", "bambu", "Bambu Lab", "Bambu Lab", "192.168.2.250", 8883,
                "Bambu Lab - Ambiente de Teste", false, ["serial"], Serial: "PFMOCKBAMBU001", Mock: true);
            onPrinterDiscovered?.Invoke(mock);
            return new NetworkDiscoveryResult([mock], warnings);
        }

        networks ??= GetLocalNetworks();
        if (networks.Count == 0)
            warnings.Add("Nenhuma interface IPv4 ativa foi encontrada. Conecte o computador à mesma rede da impressora ou cadastre o IP manualmente.");

        try
        {
            foreach (var candidate in await _ssdpDiscovery(cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();
                AddUnique(printers, candidate.ToPrinterCandidate(), onPrinterDiscovered);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch
        {
            warnings.Add("A descoberta multicast (SSDP) foi bloqueada ou indisponível. Em VLANs, redes de convidados ou firewalls, cadastre a impressora pelo IP manualmente.");
        }

        var maxHosts = ReadMaxHosts(environment);
        foreach (var network in networks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var range = GetHostRange(network.Address, network.Netmask, maxHosts);
            if (range is null) continue;
            if (range.Truncated)
                warnings.Add($"A rede {network.Interface} possui muitos dispositivos; a busca foi limitada. Se não encontrar a impressora, cadastre o IP manualmente.");

            if (!TryToUInt32(range.Start, out var start) || !TryToUInt32(range.End, out var end)) continue;
            const uint batchSize = 20;
            for (ulong batchStart = start; batchStart <= end; batchStart += batchSize)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var batchEnd = Math.Min((ulong)end, batchStart + batchSize - 1);
                var tasks = new List<Task<PrinterNetworkCandidate?>>();
                for (var host = batchStart; host <= batchEnd; host++)
                {
                    var ip = ToIpv4((uint)host);
                    if (ip.Equals(network.Address, StringComparison.OrdinalIgnoreCase)) continue;
                    tasks.Add(IdentifyPrinterAsync(ip, cancellationToken));
                }
                foreach (var candidate in await Task.WhenAll(tasks))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (candidate is not null) AddUnique(printers, candidate, onPrinterDiscovered);
                }
            }
        }

        if (printers.Count == 0 && warnings.Count == 0)
            warnings.Add("Nenhuma impressora respondeu na rede local. Verifique se computador e impressora estão na mesma rede, se o firewall permite a conexão e tente cadastrar o IP manualmente.");
        return new NetworkDiscoveryResult(printers, warnings.Distinct(StringComparer.Ordinal).ToArray());
    }

    private async Task<PrinterNetworkCandidate?> DetectMoonrakerAsync(string ip, int port, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendGetAsync(ip, port, "/server/info", allowClientError: false, cancellationToken);
            if (response is null || !response.IsSuccessStatusCode) return null;
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            if (document.RootElement.ValueKind != JsonValueKind.Object) return null;
            var hostname = document.RootElement.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Object &&
                result.TryGetProperty("hostname", out var name) && name.ValueKind == JsonValueKind.String
                ? name.GetString()
                : null;
            return new PrinterNetworkCandidate("network", "moonraker", "Moonraker / Klipper", null, ip, port,
                string.IsNullOrWhiteSpace(hostname) ? "Klipper" : hostname, false, []);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return null; }
    }

    private async Task<PrinterNetworkCandidate?> DetectOctoPrintAsync(string ip, int port, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendGetAsync(ip, port, "/api/version", allowClientError: true, cancellationToken);
            if (response is null || (int)response.StatusCode >= 500) return null;
            var server = string.Join(' ', response.Headers.Server).ToLowerInvariant();
            var body = (await response.Content.ReadAsStringAsync(cancellationToken)).ToLowerInvariant();
            if (!server.Contains("octoprint", StringComparison.Ordinal) && !body.Contains("octoprint", StringComparison.Ordinal)) return null;
            return new PrinterNetworkCandidate("network", "octoprint", "OctoPrint", null, ip, port, "OctoPrint", true, ["apiKey"]);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return null; }
    }

    private async Task<PrinterNetworkCandidate?> DetectPrusaLinkAsync(string ip, int port, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendGetAsync(ip, port, "/api/version", allowClientError: true, cancellationToken);
            if (response is null || (int)response.StatusCode >= 500) return null;
            var headers = string.Join(' ', response.Headers.SelectMany(header => header.Value)).ToLowerInvariant();
            var body = (await response.Content.ReadAsStringAsync(cancellationToken)).ToLowerInvariant();
            if (!headers.Contains("prusa", StringComparison.Ordinal) && !body.Contains("prusalink", StringComparison.Ordinal) && !body.Contains("prusa", StringComparison.Ordinal)) return null;
            return new PrinterNetworkCandidate("network", "prusalink", "PrusaLink", "Prusa", ip, port, "Prusa", true, ["username", "password"]);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return null; }
    }

    private async Task<HttpResponseMessage?> SendGetAsync(string ip, int port, string path, bool allowClientError, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(1));
        try
        {
            var response = await _httpClient.GetAsync($"http://{ip}:{port}{path}", timeout.Token);
            if (!allowClientError && !response.IsSuccessStatusCode)
            {
                response.Dispose();
                return null;
            }
            return response;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }

    private static PrinterNetworkCandidate CreateBambuCandidate(string ip) =>
        new("network", "bambu", "Bambu Lab", "Bambu Lab", ip, 8883, "Bambu Lab", true, ["serial", "accessCode"]);

    private static bool IsMockBambuEnabled(IReadOnlyDictionary<string, string?> environment)
    {
        var environmentName = environment.GetValueOrDefault("FILA_AGENT_ENVIRONMENT") ?? environment.GetValueOrDefault("PRINTFLOW_ENVIRONMENT");
        var mockValue = environment.GetValueOrDefault("FILA_AGENT_DEV_MOCK_BAMBU") ?? environment.GetValueOrDefault("PRINTFLOW_DEV_MOCK_BAMBU");
        return environmentName?.Equals("DEVELOPMENT", StringComparison.OrdinalIgnoreCase) == true &&
            mockValue?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static int ReadMaxHosts(IReadOnlyDictionary<string, string?> environment)
    {
        var value = environment.GetValueOrDefault("FILA_AGENT_DISCOVERY_MAX_HOSTS") ?? environment.GetValueOrDefault("PRINTFLOW_DISCOVERY_MAX_HOSTS");
        return int.TryParse(value, out var maxHosts) && maxHosts != 0 ? Math.Clamp(maxHosts, 1, 4096) : 1024;
    }

    private static void AddUnique(List<PrinterNetworkCandidate> printers, PrinterNetworkCandidate candidate, Action<PrinterNetworkCandidate>? onDiscovered)
    {
        if (printers.Any(existing => existing.Ip.Equals(candidate.Ip, StringComparison.OrdinalIgnoreCase) && existing.Protocol.Equals(candidate.Protocol, StringComparison.OrdinalIgnoreCase))) return;
        printers.Add(candidate);
        onDiscovered?.Invoke(candidate);
    }

    private static bool TryToUInt32(string value, out uint result)
    {
        result = 0;
        if (!IPAddress.TryParse(value, out var address) || address.AddressFamily != AddressFamily.InterNetwork) return false;
        result = BinaryPrimitives.ReadUInt32BigEndian(address.GetAddressBytes());
        return true;
    }

    private static string ToIpv4(uint value)
    {
        Span<byte> bytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(bytes, value);
        return new IPAddress(bytes).ToString();
    }

    public void Dispose()
    {
        if (_ownsHttpClient) _httpClient.Dispose();
    }
}

public static class BambuNetworkCandidateMapping
{
    public static PrinterNetworkCandidate ToPrinterCandidate(this BambuNetworkCandidate candidate) =>
        new(candidate.ConnectionType, candidate.Protocol, candidate.Software, candidate.Manufacturer, candidate.Ip,
            candidate.Port, candidate.Name, candidate.RequiresCredentials, candidate.RequiredCredentials, candidate.Model, candidate.Serial, candidate.Mock);
}
