using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace FilaAgent.Runtime;

public sealed record BambuNetworkCandidate(
    string ConnectionType,
    string Protocol,
    string Software,
    string Manufacturer,
    string Name,
    string? Model,
    string? Serial,
    string Ip,
    int Port,
    bool RequiresCredentials,
    IReadOnlyList<string> RequiredCredentials,
    bool Mock = false);

public static partial class BambuSsdpDiscoveryService
{
    private static readonly IPAddress GroupAddress = IPAddress.Parse("239.255.255.250");
    private const int GroupPort = 1990;

    public static BambuNetworkCandidate? ParseResponse(string message, string remoteAddress)
    {
        if (!IPAddress.TryParse(remoteAddress, out var address) || address.AddressFamily != AddressFamily.InterNetwork) return null;
        var headers = ParseHeaders(message);
        var fingerprint = string.Join(' ', message, Header(headers, "server"), Header(headers, "location"), Header(headers, "st"), Header(headers, "usn"), Header(headers, "device-type"));
        if (!fingerprint.Contains("bambu", StringComparison.OrdinalIgnoreCase)) return null;

        var serial = FirstHeader(headers, "serial", "serial-number", "device-serial", "x-serial", "x-device-serial");
        if (serial.Length == 0)
            serial = MatchGroup(message, "<(?:serialNumber|serial|deviceSerial)>\\s*([^<\\s]+)\\s*</")
                ?? MatchGroup(message, "(?:serial(?:[-_ ]?number)?|device[-_ ]?serial)\\s*[:=]\\s*([A-Za-z0-9._-]+)")
                ?? string.Empty;

        var model = FirstHeader(headers, "model", "device-model", "x-model");
        if (model.Length == 0) model = MatchGroup(message, "<(?:model|deviceModel)>\\s*([^<\\s]+)\\s*</") ?? string.Empty;

        return new BambuNetworkCandidate(
            "network", "bambu", "Bambu Lab", "Bambu Lab", "Bambu Lab", NullIfBlank(model), NullIfBlank(serial),
            address.ToString(), 8883, true, ["serial", "accessCode"]);
    }

    public static async Task<IReadOnlyList<BambuNetworkCandidate>> DiscoverAsync(int timeoutMilliseconds = 1200, CancellationToken cancellationToken = default)
    {
        using var udp = new UdpClient(AddressFamily.InterNetwork);
        udp.Client.Bind(new IPEndPoint(IPAddress.Any, 0));
        var request = Encoding.ASCII.GetBytes(string.Join("\r\n", [
            "M-SEARCH * HTTP/1.1",
            $"HOST: {GroupAddress}:{GroupPort}",
            "MAN: \"ssdp:discover\"",
            "MX: 1",
            "ST: ssdp:all",
            string.Empty,
            string.Empty
        ]));
        await udp.SendAsync(request, new IPEndPoint(GroupAddress, GroupPort), cancellationToken);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Math.Max(100, timeoutMilliseconds));
        var found = new Dictionary<string, BambuNetworkCandidate>(StringComparer.OrdinalIgnoreCase);
        while (!timeout.IsCancellationRequested)
        {
            UdpReceiveResult packet;
            try { packet = await udp.ReceiveAsync(timeout.Token); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { break; }
            var candidate = ParseResponse(Encoding.UTF8.GetString(packet.Buffer), packet.RemoteEndPoint.Address.ToString());
            if (candidate is null) continue;
            found[candidate.Ip] = candidate with
            {
                Serial = FirstNonBlank(candidate.Serial, found.GetValueOrDefault(candidate.Ip)?.Serial)
            };
        }
        cancellationToken.ThrowIfCancellationRequested();
        return found.Values.ToArray();
    }

    private static Dictionary<string, string> ParseHeaders(string message)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in message.Split(["\r\n", "\n"], StringSplitOptions.None).Skip(1))
        {
            var separator = line.IndexOf(':');
            if (separator <= 0) continue;
            var key = line[..separator].Trim();
            var value = line[(separator + 1)..].Trim();
            if (key.Length > 0 && value.Length > 0) headers[key] = value;
        }
        return headers;
    }

    private static string Header(IReadOnlyDictionary<string, string> headers, string key) => headers.GetValueOrDefault(key) ?? string.Empty;
    private static string FirstHeader(IReadOnlyDictionary<string, string> headers, params string[] keys) => keys.Select(key => Header(headers, key)).FirstOrDefault(value => value.Length > 0) ?? string.Empty;
    private static string? MatchGroup(string input, string pattern) => Regex.Match(input, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant).Groups[1].Value is { Length: > 0 } value ? value : null;
    private static string? NullIfBlank(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string? FirstNonBlank(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
