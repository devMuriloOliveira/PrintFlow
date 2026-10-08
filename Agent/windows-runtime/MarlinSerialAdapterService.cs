using System.IO.Ports;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Channels;

namespace FilaAgent.Runtime;

public interface IMarlinSerialChannel : IAsyncDisposable
{
    bool IsOpen { get; }
    Task<IReadOnlyList<string>> SendCommandAsync(string command, TimeSpan timeout, CancellationToken cancellationToken = default);
    Task WriteRawCommandAsync(string command, CancellationToken cancellationToken = default);
}

public interface IMarlinSerialChannelFactory
{
    IMarlinSerialChannel Open(string port, int baudRate);
}

public sealed class SystemIoMarlinSerialChannelFactory : IMarlinSerialChannelFactory
{
    public IMarlinSerialChannel Open(string port, int baudRate) => new SystemIoMarlinSerialChannel(port, baudRate);
}

internal sealed class SystemIoMarlinSerialChannel : IMarlinSerialChannel
{
    private readonly SerialPort _port;
    private readonly Channel<string> _received = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
    private readonly StringBuilder _buffer = new();
    private readonly object _bufferLock = new();
    private bool _disposed;

    public SystemIoMarlinSerialChannel(string port, int baudRate)
    {
        _port = new SerialPort(port, baudRate, Parity.None, 8, StopBits.One)
        {
            Encoding = Encoding.ASCII,
            ReadTimeout = 1000,
            WriteTimeout = 8000
        };
        _port.DataReceived += OnDataReceived;
        _port.ErrorReceived += OnErrorReceived;
        try { _port.Open(); }
        catch { _port.Dispose(); throw; }
    }

    public bool IsOpen => !_disposed && _port.IsOpen;

    public async Task<IReadOnlyList<string>> SendCommandAsync(string command, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        while (_received.Reader.TryRead(out _)) { }
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        try
        {
            await WriteAsync(command, timeoutSource.Token);
            var lines = new List<string>();
            while (true)
            {
                var line = (await _received.Reader.ReadAsync(timeoutSource.Token)).Trim();
                if (line.Length == 0) continue;
                lines.Add(line);
                if (line.StartsWith("Error", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException(line);
                if (line.Equals("ok", StringComparison.OrdinalIgnoreCase) || line.StartsWith("ok ", StringComparison.OrdinalIgnoreCase)) return lines;
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException($"Tempo esgotado aguardando resposta para {command}.");
        }
    }

    public async Task WriteRawCommandAsync(string command, CancellationToken cancellationToken = default)
    {
        EnsureOpen();
        await WriteAsync(command, cancellationToken);
    }

    private async Task WriteAsync(string command, CancellationToken cancellationToken)
    {
        var bytes = Encoding.ASCII.GetBytes(command + "\n");
        await _port.BaseStream.WriteAsync(bytes, cancellationToken);
        await _port.BaseStream.FlushAsync(cancellationToken);
    }

    private void OnDataReceived(object sender, SerialDataReceivedEventArgs args)
    {
        try
        {
            var chunk = _port.ReadExisting();
            if (chunk.Length == 0) return;
            lock (_bufferLock)
            {
                _buffer.Append(chunk);
                while (true)
                {
                    var text = _buffer.ToString();
                    var newline = text.IndexOf('\n');
                    if (newline < 0) break;
                    var line = text[..newline].TrimEnd('\r');
                    _buffer.Remove(0, newline + 1);
                    _received.Writer.TryWrite(line);
                }
            }
        }
        catch (ObjectDisposedException) { }
        catch (InvalidOperationException) { }
        catch (IOException error) { _received.Writer.TryComplete(error); }
    }

    private void OnErrorReceived(object sender, SerialErrorReceivedEventArgs args) =>
        _received.Writer.TryWrite($"Error: serial {args.EventType}.");

    private void EnsureOpen()
    {
        if (!IsOpen) throw new InvalidOperationException("Impressora Marlin nao esta conectada.");
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        _port.DataReceived -= OnDataReceived;
        _port.ErrorReceived -= OnErrorReceived;
        _received.Writer.TryComplete();
        if (_port.IsOpen) _port.Close();
        _port.Dispose();
        return ValueTask.CompletedTask;
    }
}

public sealed record MarlinPrinterDescriptor(string Port, int? BaudRate = null, string? Name = null, string? Manufacturer = null);
public sealed record MarlinPrintSnapshot(string Status, string File, int SentCommands, int TotalCommands, int Progress, string? Error = null);
public sealed record MarlinPrinterStatus(bool Connected, string Protocol, string? Manufacturer, string Name, string? Port, int? BaudRate,
    string State, int? Progress, double? NozzleTemperature, double? NozzleTargetTemperature, double? BedTemperature,
    double? BedTargetTemperature, double? X, double? Y, double? Z, IReadOnlyList<string> Lines, MarlinPrintSnapshot? ActivePrint);
public sealed record MarlinStartResult(bool Started, bool Background, string File, int TotalCommands);
public sealed record MarlinActionResult(bool Success, bool Paused = false, bool Resumed = false, bool Cancelled = false);

public sealed class MarlinPrinterConnection
{
    internal MarlinPrinterConnection(IMarlinSerialChannel channel, MarlinPrinterDescriptor printer, int baudRate)
    {
        Channel = channel;
        Printer = printer with { Port = printer.Port.Trim(), BaudRate = baudRate };
        BaudRate = baudRate;
    }

    internal IMarlinSerialChannel Channel { get; }
    internal SemaphoreSlim CommandGate { get; } = new(1, 1);
    internal CancellationTokenSource PrintLifetime { get; set; } = new();
    internal object StateLock { get; } = new();
    internal MutablePrint? CurrentPrint { get; set; }
    internal IReadOnlyList<string> LastLines { get; set; } = [];
    internal Task? PrintCompletion { get; set; }
    public MarlinPrinterDescriptor Printer { get; }
    public int BaudRate { get; }
    public bool Connected { get; internal set; } = true;
    public string Firmware { get; internal set; } = string.Empty;
    public Task? ActivePrintCompletion => PrintCompletion;
}

internal sealed class MutablePrint(string file, int totalCommands)
{
    public string File { get; } = file;
    public int TotalCommands { get; } = totalCommands;
    public int SentCommands;
    public int Progress;
    public string Status = "printing";
    public string? Error;
    public volatile bool Paused;
    public volatile bool Cancelled;

    public MarlinPrintSnapshot Snapshot() => new(Status, File, Volatile.Read(ref SentCommands), TotalCommands,
        Volatile.Read(ref Progress), Error);
}

public sealed class MarlinSerialAdapterService
{
    private readonly IMarlinSerialChannelFactory _factory;
    private readonly TimeSpan _startupDelay;
    private readonly TimeSpan _commandTimeout;
    private readonly TimeSpan _printLineTimeout;
    private readonly TimeSpan _pausePollInterval;

    public MarlinSerialAdapterService(IMarlinSerialChannelFactory? factory = null, TimeSpan? startupDelay = null,
        TimeSpan? commandTimeout = null, TimeSpan? printLineTimeout = null, TimeSpan? pausePollInterval = null)
    {
        _factory = factory ?? new SystemIoMarlinSerialChannelFactory();
        _startupDelay = startupDelay ?? TimeSpan.FromSeconds(2);
        _commandTimeout = commandTimeout ?? TimeSpan.FromSeconds(8);
        _printLineTimeout = printLineTimeout ?? TimeSpan.FromSeconds(20);
        _pausePollInterval = pausePollInterval ?? TimeSpan.FromMilliseconds(250);
    }

    public async Task<MarlinPrinterConnection> ConnectAsync(MarlinPrinterDescriptor printer, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(printer.Port)) throw new ArgumentException("Porta serial da impressora obrigatoria.", nameof(printer));
        var baudRate = printer.BaudRate is > 0 ? printer.BaudRate.Value : 115200;
        var channel = _factory.Open(printer.Port.Trim(), baudRate);
        var connection = new MarlinPrinterConnection(channel, printer, baudRate);
        try
        {
            if (_startupDelay > TimeSpan.Zero) await Task.Delay(_startupDelay, cancellationToken);
            var firmware = await SendAsync(connection, "M115", TimeSpan.FromSeconds(10), cancellationToken);
            connection.Firmware = string.Join('\n', firmware);
            return connection;
        }
        catch
        {
            connection.Connected = false;
            await channel.DisposeAsync();
            throw;
        }
    }

    public async Task<MarlinPrinterStatus> GetStatusAsync(MarlinPrinterConnection connection, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        MutablePrint? active;
        lock (connection.StateLock) active = connection.CurrentPrint;
        if (active is not null && !IsTerminal(active.Status)) return ParseStatus(connection, connection.LastLines, active);

        var lines = await SendAsync(connection, "M105", _commandTimeout, cancellationToken);
        try { lines = lines.Concat(await SendAsync(connection, "M114", _commandTimeout, cancellationToken)).ToArray(); }
        catch (Exception) when (!cancellationToken.IsCancellationRequested) { }
        connection.LastLines = lines;
        return ParseStatus(connection, lines, active);
    }

    public async Task<MarlinStartResult> StartPrintAsync(MarlinPrinterConnection connection, string localPath, string? fileName = null,
        string? format = null, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        MutablePrint print;
        lock (connection.StateLock)
        {
            if (connection.CurrentPrint is not null && !IsTerminal(connection.CurrentPrint.Status))
                throw new InvalidOperationException("Ja existe uma impressao Marlin em andamento nesta conexao.");
        }
        if (string.IsNullOrWhiteSpace(localPath)) throw new InvalidOperationException("Arquivo G-code local obrigatorio para impressao Marlin USB.");
        var path = Path.GetFullPath(localPath);
        if (!File.Exists(path)) throw new FileNotFoundException("Arquivo G-code local nao encontrado.", path);
        var name = string.IsNullOrWhiteSpace(fileName) ? Path.GetFileName(path) : Path.GetFileName(fileName.Trim());
        var actualFormat = (string.IsNullOrWhiteSpace(format) ? Path.GetExtension(name).TrimStart('.') : format.Trim()).ToLowerInvariant();
        if (actualFormat != "gcode") throw new InvalidOperationException("Marlin USB aceita apenas arquivo .gcode.");
        var total = await CountCommandsAsync(path, cancellationToken);
        if (total <= 0) throw new InvalidOperationException("Arquivo G-code nao possui comandos validos para imprimir.");

        print = new MutablePrint(name, total);
        lock (connection.StateLock) connection.CurrentPrint = print;
        // Use a separate token source for this print so a command-request timeout
        // does not cancel a background stream after start_print returns.
        connection.PrintLifetime.Dispose();
        connection.PrintLifetime = new CancellationTokenSource();
        connection.PrintCompletion = Task.Run(() => RunPrintAsync(connection, print, path, connection.PrintLifetime.Token), CancellationToken.None);
        return new MarlinStartResult(true, true, name, total);
    }

    public async Task<MarlinActionResult> PauseAsync(MarlinPrinterConnection connection, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        MutablePrint? print;
        lock (connection.StateLock) print = connection.CurrentPrint;
        if (print?.Status == "printing")
        {
            print.Paused = true;
            print.Status = "paused";
            return new MarlinActionResult(true, Paused: true);
        }
        await SendAsync(connection, "M25", _commandTimeout, cancellationToken);
        return new MarlinActionResult(true);
    }

    public async Task<MarlinActionResult> ResumeAsync(MarlinPrinterConnection connection, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        MutablePrint? print;
        lock (connection.StateLock) print = connection.CurrentPrint;
        if (print?.Status == "paused")
        {
            print.Paused = false;
            print.Status = "printing";
            return new MarlinActionResult(true, Resumed: true);
        }
        await SendAsync(connection, "M24", _commandTimeout, cancellationToken);
        return new MarlinActionResult(true);
    }

    public async Task<MarlinActionResult> CancelAsync(MarlinPrinterConnection connection, CancellationToken cancellationToken = default)
    {
        RequireConnection(connection);
        MutablePrint? print;
        lock (connection.StateLock) print = connection.CurrentPrint;
        if (print is not null && !IsTerminal(print.Status))
        {
            print.Cancelled = true;
            print.Status = "cancelled";
            try { await connection.Channel.WriteRawCommandAsync("M410", cancellationToken); }
            catch (Exception) when (!cancellationToken.IsCancellationRequested) { }
            return new MarlinActionResult(true, Cancelled: true);
        }
        await SendAsync(connection, "M524", _commandTimeout, cancellationToken);
        return new MarlinActionResult(true);
    }

    public async Task<MarlinActionResult> DisconnectAsync(MarlinPrinterConnection connection)
    {
        if (!connection.Connected) return new MarlinActionResult(true);
        connection.Connected = false;
        connection.PrintLifetime.Cancel();
        await connection.Channel.DisposeAsync();
        return new MarlinActionResult(true);
    }

    private async Task RunPrintAsync(MarlinPrinterConnection connection, MutablePrint print, string path, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            while (await reader.ReadLineAsync(cancellationToken) is { } line)
            {
                var command = CleanGcodeLine(line);
                if (command.Length == 0) continue;
                while (print.Paused && !print.Cancelled) await Task.Delay(_pausePollInterval, cancellationToken);
                if (print.Cancelled) throw new OperationCanceledException("Impressao Marlin cancelada pelo usuario.");
                await SendAsync(connection, command, _printLineTimeout, cancellationToken);
                Volatile.Write(ref print.SentCommands, Volatile.Read(ref print.SentCommands) + 1);
                Volatile.Write(ref print.Progress, Math.Min(100, (int)Math.Round((double)print.SentCommands / print.TotalCommands * 100, MidpointRounding.AwayFromZero)));
            }
            print.Status = "completed";
        }
        catch (Exception error)
        {
            print.Status = print.Cancelled ? "cancelled" : "failed";
            print.Error = error.Message;
        }
    }

    private static async Task<int> CountCommandsAsync(string path, CancellationToken cancellationToken)
    {
        var count = 0;
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        while (await reader.ReadLineAsync(cancellationToken) is { } line) if (CleanGcodeLine(line).Length > 0) count++;
        return count;
    }

    private static async Task<IReadOnlyList<string>> SendAsync(MarlinPrinterConnection connection, string command, TimeSpan timeout, CancellationToken cancellationToken)
    {
        await connection.CommandGate.WaitAsync(cancellationToken);
        try
        {
            var lines = await connection.Channel.SendCommandAsync(command, timeout, cancellationToken);
            connection.LastLines = lines;
            return lines;
        }
        finally { connection.CommandGate.Release(); }
    }

    private static MarlinPrinterStatus ParseStatus(MarlinPrinterConnection connection, IReadOnlyList<string> lines, MutablePrint? active)
    {
        var text = string.Join('\n', lines);
        var temperature = lines.FirstOrDefault(line => Regex.IsMatch(line, @"\bT:\s*[-+]?\d", RegexOptions.IgnoreCase)) ?? string.Empty;
        var position = lines.FirstOrDefault(line => Regex.IsMatch(line, @"\bX:\s*[-+]?\d", RegexOptions.IgnoreCase)) ?? string.Empty;
        var nozzle = ParseTemperature(temperature, "T");
        var bed = ParseTemperature(temperature, "B");
        var state = active?.Status == "paused" || (active is null && text.Contains("paused", StringComparison.OrdinalIgnoreCase)) ? "PAUSE"
            : active?.Status == "printing" ? "PRINTING" : "CONNECTED";
        return new MarlinPrinterStatus(true, "marlin", connection.Printer.Manufacturer, connection.Printer.Name ?? "Impressora Marlin",
            connection.Printer.Port, connection.BaudRate, state, active?.Progress, nozzle.Current, nozzle.Target, bed.Current, bed.Target,
            ParseValue(position, "X"), ParseValue(position, "Y"), ParseValue(position, "Z"), lines.ToArray(), active?.Snapshot());
    }

    private static (double? Current, double? Target) ParseTemperature(string line, string key)
    {
        var match = Regex.Match(line, $@"{key}:\s*([-+]?\d+(?:\.\d+)?)\s*(?:/\s*([-+]?\d+(?:\.\d+)?))?", RegexOptions.IgnoreCase);
        return match.Success ? (ParseNumber(match.Groups[1].Value), match.Groups[2].Success ? ParseNumber(match.Groups[2].Value) : null) : (null, null);
    }

    private static double? ParseValue(string line, string key)
    {
        var match = Regex.Match(line, $@"{key}:\s*([-+]?\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
        return match.Success ? ParseNumber(match.Groups[1].Value) : null;
    }

    private static double? ParseNumber(string value) => double.TryParse(value, System.Globalization.NumberStyles.Float,
        System.Globalization.CultureInfo.InvariantCulture, out var result) && double.IsFinite(result) ? result : null;

    private static string CleanGcodeLine(string line)
    {
        var comment = line.IndexOf(';');
        return (comment >= 0 ? line[..comment] : line).Trim();
    }

    private static bool IsTerminal(string status) => status is "completed" or "cancelled" or "failed";

    private static void RequireConnection(MarlinPrinterConnection? connection)
    {
        if (connection is null || !connection.Connected || !connection.Channel.IsOpen)
            throw new InvalidOperationException("Impressora Marlin nao esta conectada.");
    }
}
