using System.IO.Ports;
using System.Text;

namespace FilaAgent.Runtime;

public sealed record SerialPortCandidate(string Port, string Name, string? Manufacturer = null, string? Description = null, string? PnpDeviceId = null);

public sealed record MarlinUsbPrinter(
    string ConnectionType,
    string Protocol,
    string Port,
    string Name,
    string? Manufacturer,
    string? Description,
    string? PnpDeviceId,
    bool Identified,
    string Firmware,
    int BaudRate,
    bool RequiresCredentials,
    IReadOnlyList<string> RequiredCredentials);

public interface ISerialPortCatalog
{
    IReadOnlyList<SerialPortCandidate> ListPorts();
}

public interface IMarlinFirmwareProbe
{
    Task<string?> ReadFirmwareAsync(string port, int baudRate, TimeSpan timeout, CancellationToken cancellationToken = default);
}

public sealed class WindowsSerialPortCatalog : ISerialPortCatalog
{
    public IReadOnlyList<SerialPortCandidate> ListPorts()
    {
        if (!OperatingSystem.IsWindows()) return [];
        return SerialPort.GetPortNames()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(PortNumber)
            .Select(port => new SerialPortCandidate(port, $"Dispositivo serial ({port})"))
            .ToArray();
    }

    private static int PortNumber(string value)
    {
        if (!value.StartsWith("COM", StringComparison.OrdinalIgnoreCase)) return int.MaxValue;
        return int.TryParse(value.AsSpan("COM".Length), out var number) ? number : int.MaxValue;
    }
}

public sealed class MarlinSerialFirmwareProbe : IMarlinFirmwareProbe
{
    public async Task<string?> ReadFirmwareAsync(string port, int baudRate, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        using var serial = new SerialPort(port, baudRate, Parity.None, 8, StopBits.One)
        {
            ReadTimeout = 250,
            WriteTimeout = 1000,
            DtrEnable = false,
            RtsEnable = false,
            NewLine = "\n"
        };
        var response = new StringBuilder();
        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var responseLock = new object();

        void OnDataReceived(object? _, SerialDataReceivedEventArgs __)
        {
            try
            {
                var chunk = serial.ReadExisting();
                if (string.IsNullOrEmpty(chunk)) return;
                string content;
                lock (responseLock)
                {
                    response.Append(chunk);
                    content = response.ToString();
                }
                if (IsMarlinResponse(content)) completion.TrySetResult(content.Trim());
            }
            catch (InvalidOperationException) { completion.TrySetResult(null); }
            catch (IOException) { completion.TrySetResult(null); }
        }

        void OnErrorReceived(object? _, SerialErrorReceivedEventArgs __) => completion.TrySetResult(null);

        serial.DataReceived += OnDataReceived;
        serial.ErrorReceived += OnErrorReceived;
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        try
        {
            serial.Open();
            await Task.Delay(TimeSpan.FromMilliseconds(500), timeoutSource.Token);
            serial.Write("M115\n");
            return await completion.Task.WaitAsync(timeoutSource.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
        {
            return null;
        }
        finally
        {
            serial.DataReceived -= OnDataReceived;
            serial.ErrorReceived -= OnErrorReceived;
            if (serial.IsOpen)
            {
                try { serial.Close(); } catch (IOException) { }
            }
        }
    }

    private static bool IsMarlinResponse(string value)
    {
        var normalized = value.ToLowerInvariant();
        return normalized.Contains("firmware_name", StringComparison.Ordinal) || normalized.Contains("marlin", StringComparison.Ordinal);
    }
}

public sealed class UsbDiscoveryService(ISerialPortCatalog? portCatalog = null, IMarlinFirmwareProbe? firmwareProbe = null)
{
    private static readonly int[] BaudRates = [115200, 250000];
    private readonly ISerialPortCatalog _portCatalog = portCatalog ?? new WindowsSerialPortCatalog();
    private readonly IMarlinFirmwareProbe _firmwareProbe = firmwareProbe ?? new MarlinSerialFirmwareProbe();

    public async Task<IReadOnlyList<MarlinUsbPrinter>> ScanAsync(
        Action<MarlinUsbPrinter>? onPrinterDiscovered = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows() && _portCatalog is WindowsSerialPortCatalog) return [];

        var printers = new List<MarlinUsbPrinter>();
        foreach (var device in _portCatalog.ListPorts().Where(item => !string.IsNullOrWhiteSpace(item.Port)))
        {
            cancellationToken.ThrowIfCancellationRequested();
            foreach (var baudRate in BaudRates)
            {
                var firmware = await _firmwareProbe.ReadFirmwareAsync(device.Port, baudRate, TimeSpan.FromSeconds(3), cancellationToken);
                if (string.IsNullOrWhiteSpace(firmware)) continue;
                var printer = new MarlinUsbPrinter(
                    "usb", "marlin", device.Port,
                    FirstNonBlank(device.Name, device.Description, device.Port),
                    device.Manufacturer, device.Description, device.PnpDeviceId,
                    true, firmware, baudRate, false, []);
                printers.Add(printer);
                onPrinterDiscovered?.Invoke(printer);
                break;
            }
        }
        return printers;
    }

    private static string FirstNonBlank(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}
