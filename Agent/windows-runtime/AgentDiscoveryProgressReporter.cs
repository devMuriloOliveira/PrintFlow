namespace FilaAgent.Runtime;

internal sealed class AgentDiscoveryProgressReporter : IAsyncDisposable
{
    private const int MaxPrinters = 50;
    private static readonly TimeSpan PublishInterval = TimeSpan.FromSeconds(1);
    private static readonly HashSet<string> AllowedCredentialFields = new(StringComparer.Ordinal)
    {
        "serial", "accessCode", "apiKey", "password", "username"
    };

    private readonly AgentCloudClient _cloudClient;
    private readonly AgentCredentials _credentials;
    private readonly string _commandId;
    private readonly CancellationToken _cancellationToken;
    private readonly object _sync = new();
    private readonly SemaphoreSlim _flushLock = new(1, 1);
    private readonly Dictionary<string, DiscoveredPrinter> _printers = new(StringComparer.OrdinalIgnoreCase);
    private Timer? _timer;
    private bool _dirty;

    public AgentDiscoveryProgressReporter(AgentCloudClient cloudClient, AgentCredentials credentials, string commandId,
        CancellationToken cancellationToken)
    {
        _cloudClient = cloudClient;
        _credentials = credentials;
        _commandId = commandId;
        _cancellationToken = cancellationToken;
    }

    public void Add(PrinterNetworkCandidate printer) => Add(new DiscoveredPrinter(
        printer.ConnectionType, printer.Protocol, printer.Software, printer.Manufacturer, printer.Name, printer.Ip,
        printer.Serial, printer.Model, printer.Port, null, null, printer.RequiresCredentials, printer.RequiredCredentials,
        printer.Mock ? true : null));

    public void Add(MarlinUsbPrinter printer) => Add(new DiscoveredPrinter(
        printer.ConnectionType, printer.Protocol, null, printer.Manufacturer, printer.Name, null, null, null,
        printer.Port, printer.Firmware, null, printer.RequiresCredentials, printer.RequiredCredentials, null));

    private void Add(DiscoveredPrinter printer)
    {
        var protocol = Clean(printer.Protocol);
        var identity = Clean(printer.Serial) ?? Clean(printer.Ip) ?? Clean(printer.Port?.ToString());
        if (protocol is null || identity is null) return;

        lock (_sync)
        {
            if (_printers.Count >= MaxPrinters || !_printers.TryAdd($"{protocol}:{identity}", Normalize(printer))) return;
            _dirty = true;
            _timer ??= new Timer(static state => _ = ((AgentDiscoveryProgressReporter)state!).FlushSafelyAsync(), this,
                PublishInterval, PublishInterval);
        }
    }

    public async Task FlushAsync(CancellationToken cancellationToken = default)
    {
        await _flushLock.WaitAsync(cancellationToken);
        try
        {
            DiscoveredPrinter[] snapshot;
            lock (_sync)
            {
                if (!_dirty) return;
                _dirty = false;
                snapshot = _printers.Values.ToArray();
            }

            try
            {
                await _cloudClient.ReportCommandProgressAsync(_credentials, _commandId,
                    new DiscoveryProgress(snapshot.Length, snapshot, DateTimeOffset.UtcNow), cancellationToken);
            }
            catch
            {
                lock (_sync) _dirty = true;
            }
        }
        finally
        {
            _flushLock.Release();
        }
    }

    private async Task FlushSafelyAsync()
    {
        try { await FlushAsync(_cancellationToken); }
        catch (OperationCanceledException) when (_cancellationToken.IsCancellationRequested) { }
        catch { }
    }

    private static DiscoveredPrinter Normalize(DiscoveredPrinter printer)
    {
        var requiredCredentials = printer.RequiredCredentials is null
            ? []
            : printer.RequiredCredentials.Where(AllowedCredentialFields.Contains).Distinct(StringComparer.Ordinal).Take(5).ToArray();
        return printer with
        {
            ConnectionType = Clean(printer.ConnectionType),
            Protocol = Clean(printer.Protocol),
            Software = Clean(printer.Software),
            Manufacturer = Clean(printer.Manufacturer),
            Name = Clean(printer.Name),
            Ip = Clean(printer.Ip),
            Serial = Clean(printer.Serial),
            Model = Clean(printer.Model),
            Port = printer.Port is string portName ? Clean(portName) : printer.Port,
            Firmware = Clean(printer.Firmware),
            RequiredCredentials = requiredCredentials
        };
    }

    private static string? Clean(string? value)
    {
        var text = value?.Trim();
        return string.IsNullOrEmpty(text) ? null : text[..Math.Min(text.Length, 120)];
    }

    public async ValueTask DisposeAsync()
    {
        var timer = Interlocked.Exchange(ref _timer, null);
        if (timer is not null) await timer.DisposeAsync();
        _flushLock.Dispose();
    }

    private sealed record DiscoveryProgress(int DiscoveredCount, IReadOnlyList<DiscoveredPrinter> Printers,
        DateTimeOffset UpdatedAt)
    {
        public string Type { get; } = "discovery";
    }

    private sealed record DiscoveredPrinter(string? ConnectionType, string? Protocol, string? Software, string? Manufacturer,
        string? Name, string? Ip, string? Serial, string? Model, object? Port, string? Firmware, int? BaudRate,
        bool RequiresCredentials, IReadOnlyList<string>? RequiredCredentials, bool? Mock);
}
