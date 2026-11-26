using System.Net;
using System.Net.Sockets;

namespace FilaAgent.Runtime;

public static class PrinterDestinationPolicy
{
    public static bool IsAllowed(string protocol, string? ip, int? port)
    {
        if (string.IsNullOrWhiteSpace(ip) || !IPAddress.TryParse(ip.Trim(), out var address) ||
            address.AddressFamily != AddressFamily.InterNetwork || !address.ToString().Equals(ip.Trim(), StringComparison.Ordinal))
            return false;

        var octets = address.GetAddressBytes();
        if (address.Equals(IPAddress.Parse("169.254.169.254"))) return false;
        var isLanAddress = octets[0] == 10 ||
            (octets[0] == 172 && octets[1] is >= 16 and <= 31) ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 169 && octets[1] == 254) ||
            (octets[0] == 100 && octets[1] is >= 64 and <= 127);
        if (!isLanAddress) return false;

        var allowedPorts = protocol.Trim().ToLowerInvariant() switch
        {
            "bambu" => new[] { 8883 },
            "moonraker" => new[] { 7125 },
            "octoprint" => new[] { 80, 5000, 7125 },
            "prusalink" => new[] { 80, 5000, 7125 },
            _ => []
        };
        return port is > 0 and <= 65535 && allowedPorts.Contains(port.Value);
    }

    public static void Validate(string protocol, string? ip, int? port)
    {
        if (!IsAllowed(protocol, ip, port))
            throw new InvalidDataException("Destino de impressora invalido ou nao permitido.");
    }
}
