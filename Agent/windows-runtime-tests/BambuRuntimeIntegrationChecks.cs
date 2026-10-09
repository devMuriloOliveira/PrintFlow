using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

internal static class BambuRuntimeIntegrationChecks
{
    public static async Task RunMqttAsync(Action<bool, string> check)
    {
        var mqttSerial = "PFLOCALMQTT001";
        using var authority = CreateCertificateAuthority();
        using var certificate = CreateCertificate(authority, mqttSerial);
        var testTrustBundle = new X509Certificate2Collection { authority };
        bool ValidateFixtureCertificate(X509Certificate? presented, X509Chain? chain, string expectedSerial) =>
            FilaAgent.Runtime.BambuCertificateValidator.Validate(presented, chain, expectedSerial, testTrustBundle);
        const string mqttSecret = "LOCAL-MQTT-SECRET";
        await using (var broker = await LocalMqttTlsBroker.StartAsync(certificate, mqttSerial, mqttSecret))
        {
            var adapter = new FilaAgent.Runtime.BambuPrinterAdapterService(
                new FilaAgent.Runtime.MqttNetBambuClientFactory(ValidateFixtureCertificate),
                new FilaAgent.Runtime.FluentFtpBambuUploader(ValidateFixtureCertificate));
            FilaAgent.Runtime.BambuPrinterConnection connection;
            try
            {
                connection = await adapter.ConnectAsync(
                    new FilaAgent.Runtime.BambuPrinterDescriptor("127.0.0.1", mqttSerial, broker.Port, Name: "Bambu TLS fixture"),
                    mqttSecret);
            }
            catch (Exception error)
            {
                try { await broker.Completion.WaitAsync(TimeSpan.FromSeconds(1)); }
                catch { }
                throw new InvalidOperationException($"MQTT client: {error.Message}; TLS broker: {broker.TlsError ?? "sem erro no lado servidor"}", error);
            }
            var status = await adapter.GetStatusAsync(connection);
            check(broker.Connected && broker.Authenticated && broker.Subscribed,
                "MQTTnet negocia TLS autoassinado local, MQTT 3.1.1, bblp/LAN code e assinatura Bambu");
            check(status.State == "IDLE" && status.Progress == 0 && status.NozzleTemperature == 24 && status.BedTemperature == 23,
                "sessão MQTTnet real recebe e normaliza o report Bambu após pushall");

            await adapter.PauseAsync(connection);
            await adapter.ResumeAsync(connection);
            await adapter.CancelAsync(connection);
            var controls = broker.Published.Select(ReadPrintCommand).Where(command => command is not null).ToArray();
            check(controls.SequenceEqual(["pause", "resume", "stop"]),
                "sessão MQTTnet real transmite pause/resume/stop no tópico de request");
            await adapter.DisconnectAsync(connection);
            await broker.Completion.WaitAsync(TimeSpan.FromSeconds(3));
        }
    }

    public static async Task RunFtpsAsync(Action<bool, string> check)
    {
        const string ftpSerial = "PFLOCALFTPS001";
        using var authority = CreateCertificateAuthority();
        using var certificate = CreateCertificate(authority, ftpSerial);
        var testTrustBundle = new X509Certificate2Collection { authority };
        bool ValidateFixtureCertificate(X509Certificate? presented, X509Chain? chain, string expectedSerial) =>
            FilaAgent.Runtime.BambuCertificateValidator.Validate(presented, chain, expectedSerial, testTrustBundle);
        const string ftpSecret = "LOCAL-FTPS-SECRET";
        var localFile = Path.Combine(Path.GetTempPath(), "fila-bambu-ftps-" + Guid.NewGuid().ToString("N") + ".gcode.3mf");
        var fileBytes = Encoding.UTF8.GetBytes("local Bambu FTPS payload\n");
        await File.WriteAllBytesAsync(localFile, fileBytes);
        try
        {
            await using var ftpServer = await LocalImplicitFtpsServer.StartAsync(certificate);
            await new FilaAgent.Runtime.FluentFtpBambuUploader(ValidateFixtureCertificate).UploadAsync(
                "127.0.0.1", ftpSerial, ftpServer.Port, ftpSecret, localFile, "/cache/fixture.gcode.3mf")
                .WaitAsync(TimeSpan.FromSeconds(15));
            await ftpServer.Completion.WaitAsync(TimeSpan.FromSeconds(3));
            check(ftpServer.Username == "bblp" && ftpServer.Password == ftpSecret && ftpServer.RemotePath == "/cache/fixture.gcode.3mf",
                "FluentFTP usa FTPS implícito e caminho de destino Bambu na porta local de teste");
            check(ftpServer.UploadedBytes.SequenceEqual(fileBytes) && ftpServer.DataChannelEncrypted,
                "FluentFTP envia bytes idênticos com canal de dados FTPS cifrado");
        }
        finally
        {
            try { File.Delete(localFile); }
            catch { }
        }
    }

    private static string? ReadPrintCommand(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.TryGetProperty("print", out var print) && print.TryGetProperty("command", out var command)
            ? command.GetString()
            : null;
    }

    private static X509Certificate2 CreateCertificateAuthority()
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=Fila Agent Local TLS Test CA", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-2), DateTimeOffset.UtcNow.AddHours(1));
    }

    private static X509Certificate2 CreateCertificate(X509Certificate2 authority, string serial)
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest($"CN={serial}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        var certificate = request.Create(authority, DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(30), RandomNumberGenerator.GetBytes(16));
        return certificate.CopyWithPrivateKey(key);
    }

    private sealed class LocalMqttTlsBroker : IAsyncDisposable
    {
        private readonly TcpListener _listener;
        private readonly X509Certificate2 _certificate;
        private readonly string _serial;
        private readonly string _accessCode;
        private readonly Task _runTask;
        private readonly ConcurrentQueue<string> _published = new();
        private int _connected;
        private int _authenticated;
        private int _subscribed;

        private LocalMqttTlsBroker(TcpListener listener, X509Certificate2 certificate, string serial, string accessCode)
        {
            _listener = listener;
            _certificate = certificate;
            _serial = serial;
            _accessCode = accessCode;
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            _runTask = Task.Run(RunAsync);
        }

        public int Port { get; }
        public bool Connected => Volatile.Read(ref _connected) == 1;
        public bool Authenticated => Volatile.Read(ref _authenticated) == 1;
        public bool Subscribed => Volatile.Read(ref _subscribed) == 1;
        public string? TlsError { get; private set; }
        public IReadOnlyList<string> Published => _published.ToArray();
        public Task Completion => _runTask;

        public static Task<LocalMqttTlsBroker> StartAsync(X509Certificate2 certificate, string serial, string accessCode)
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            return Task.FromResult(new LocalMqttTlsBroker(listener, certificate, serial, accessCode));
        }

        private async Task RunAsync()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var tcp = await _listener.AcceptTcpClientAsync(timeout.Token);
            await using var tls = new SslStream(tcp.GetStream(), leaveInnerStreamOpen: false);
            try
            {
                await tls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions
                {
                    ServerCertificateContext = SslStreamCertificateContext.Create(_certificate, null, offline: true),
                    EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
                }, timeout.Token);
            }
            catch (Exception error)
            {
                TlsError = $"{error.GetType().Name}: {error.Message}";
                throw;
            }

            while (!timeout.IsCancellationRequested)
            {
                var packet = await ReadMqttPacketAsync(tls, timeout.Token);
                var type = packet.Header >> 4;
                if (type == 1)
                {
                    var (protocolLevel, username, password, clientId) = ParseConnect(packet.Payload);
                    if (protocolLevel != 4 || string.IsNullOrWhiteSpace(clientId)) throw new InvalidDataException("Esperado MQTT 3.1.1 com client ID.");
                    Interlocked.Exchange(ref _connected, 1);
                    Interlocked.Exchange(ref _authenticated, username == "bblp" && password == _accessCode ? 1 : 0);
                    await WritePacketAsync(tls, 0x20, [0x00, 0x00], timeout.Token);
                }
                else if (type == 8)
                {
                    var (topic, qos) = ParseSubscribe(packet.Payload);
                    if (topic == $"device/{_serial}/report" && qos == 0) Interlocked.Exchange(ref _subscribed, 1);
                    var packetId = packet.Payload.AsSpan(0, 2).ToArray();
                    await WritePacketAsync(tls, 0x90, [.. packetId, 0x00], timeout.Token);
                }
                else if (type == 3)
                {
                    var (topic, payload, qos, packetId) = ParsePublish(packet.Header, packet.Payload);
                    if (qos == 1 && packetId is not null) await WritePacketAsync(tls, 0x40, packetId, timeout.Token);
                    _published.Enqueue(payload);
                    if (topic == $"device/{_serial}/request" && payload.Contains("\"pushall\"", StringComparison.Ordinal))
                    {
                        const string report = "{\"print\":{\"gcode_state\":\"IDLE\",\"mc_percent\":0,\"nozzle_temper\":24,\"bed_temper\":23}}";
                        await WritePacketAsync(tls, 0x30, MakePublishPayload($"device/{_serial}/report", report), timeout.Token);
                    }
                }
                else if (type == 12)
                {
                    await WritePacketAsync(tls, 0xD0, [], timeout.Token);
                }
                else if (type == 14)
                {
                    return;
                }
            }
        }

        public async ValueTask DisposeAsync()
        {
            _listener.Stop();
            try { await _runTask.WaitAsync(TimeSpan.FromSeconds(1)); }
            catch { }
        }

        private static (byte ProtocolLevel, string? Username, string? Password, string ClientId) ParseConnect(byte[] payload)
        {
            var offset = 0;
            var protocol = ReadMqttString(payload, ref offset);
            if (protocol != "MQTT" || offset + 4 > payload.Length) throw new InvalidDataException("Pacote CONNECT MQTT inválido.");
            var level = payload[offset++];
            var flags = payload[offset++];
            offset += 2;
            var clientId = ReadMqttString(payload, ref offset);
            var username = (flags & 0x80) != 0 ? ReadMqttString(payload, ref offset) : null;
            var password = (flags & 0x40) != 0 ? ReadMqttString(payload, ref offset) : null;
            return (level, username, password, clientId);
        }

        private static (string Topic, int Qos) ParseSubscribe(byte[] payload)
        {
            var offset = 2;
            var topic = ReadMqttString(payload, ref offset);
            return (topic, payload[offset]);
        }

        private static (string Topic, string Payload, int Qos, byte[]? PacketId) ParsePublish(byte header, byte[] payload)
        {
            var offset = 0;
            var topic = ReadMqttString(payload, ref offset);
            var qos = (header >> 1) & 0x03;
            byte[]? packetId = null;
            if (qos > 0)
            {
                packetId = payload.AsSpan(offset, 2).ToArray();
                offset += 2;
            }
            return (topic, Encoding.UTF8.GetString(payload, offset, payload.Length - offset), qos, packetId);
        }

        private static byte[] MakePublishPayload(string topic, string payload)
        {
            using var stream = new MemoryStream();
            WriteMqttString(stream, topic);
            var bytes = Encoding.UTF8.GetBytes(payload);
            stream.Write(bytes);
            return stream.ToArray();
        }

        private static string ReadMqttString(byte[] payload, ref int offset)
        {
            var length = BinaryPrimitives.ReadUInt16BigEndian(payload.AsSpan(offset, 2));
            offset += 2;
            var value = Encoding.UTF8.GetString(payload, offset, length);
            offset += length;
            return value;
        }

        private static void WriteMqttString(Stream stream, string value)
        {
            var bytes = Encoding.UTF8.GetBytes(value);
            Span<byte> length = stackalloc byte[2];
            BinaryPrimitives.WriteUInt16BigEndian(length, checked((ushort)bytes.Length));
            stream.Write(length);
            stream.Write(bytes);
        }

        private static async Task<(byte Header, byte[] Payload)> ReadMqttPacketAsync(Stream stream, CancellationToken cancellationToken)
        {
            var first = await ReadByteAsync(stream, cancellationToken);
            var multiplier = 1;
            var length = 0;
            byte digit;
            do
            {
                digit = await ReadByteAsync(stream, cancellationToken);
                length += (digit & 0x7f) * multiplier;
                multiplier *= 128;
            } while ((digit & 0x80) != 0);

            var payload = new byte[length];
            await stream.ReadExactlyAsync(payload, cancellationToken);
            return (first, payload);
        }

        private static async Task<byte> ReadByteAsync(Stream stream, CancellationToken cancellationToken)
        {
            var value = new byte[1];
            await stream.ReadExactlyAsync(value, cancellationToken);
            return value[0];
        }

        private static async Task WritePacketAsync(Stream stream, byte header, byte[] payload, CancellationToken cancellationToken)
        {
            var encodedLength = new List<byte>();
            var remaining = payload.Length;
            do
            {
                var digit = remaining % 128;
                remaining /= 128;
                if (remaining > 0) digit |= 0x80;
                encodedLength.Add((byte)digit);
            } while (remaining > 0);

            await stream.WriteAsync(new[] { header }.Concat(encodedLength).Concat(payload).ToArray(), cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
    }

    private sealed class LocalImplicitFtpsServer : IAsyncDisposable
    {
        private readonly TcpListener _listener;
        private readonly X509Certificate2 _certificate;
        private readonly Task _runTask;
        private byte[] _uploadedBytes = [];
        private int _encryptedData;

        private LocalImplicitFtpsServer(TcpListener listener, X509Certificate2 certificate)
        {
            _listener = listener;
            _certificate = certificate;
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            _runTask = Task.Run(RunAsync);
        }

        public int Port { get; }
        public string? Username { get; private set; }
        public string? Password { get; private set; }
        public string? RemotePath { get; private set; }
        public byte[] UploadedBytes => _uploadedBytes;
        public bool DataChannelEncrypted => Volatile.Read(ref _encryptedData) == 1;
        public Task Completion => _runTask;

        public static Task<LocalImplicitFtpsServer> StartAsync(X509Certificate2 certificate)
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            return Task.FromResult(new LocalImplicitFtpsServer(listener, certificate));
        }

        private async Task RunAsync()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            using var controlSocket = await _listener.AcceptTcpClientAsync(timeout.Token);
            await using var controlTls = new SslStream(controlSocket.GetStream(), leaveInnerStreamOpen: false);
            await controlTls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions
            {
                ServerCertificateContext = SslStreamCertificateContext.Create(_certificate, null, offline: true),
                EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
            }, timeout.Token);

            using var reader = new StreamReader(controlTls, Encoding.ASCII, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
            await using var writer = new StreamWriter(controlTls, Encoding.ASCII, leaveOpen: true) { AutoFlush = true, NewLine = "\r\n" };
            TcpListener? passiveListener = null;
            await writer.WriteLineAsync("220 Bambu fixture ready");
            while (!timeout.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(timeout.Token);
                if (line is null) return;
                var split = line.IndexOf(' ');
                var command = (split < 0 ? line : line[..split]).ToUpperInvariant();
                var argument = split < 0 ? string.Empty : line[(split + 1)..];
                switch (command)
                {
                    case "USER":
                        Username = argument;
                        await writer.WriteLineAsync("331 Password required");
                        break;
                    case "PASS":
                        Password = argument;
                        await writer.WriteLineAsync("230 Logged in");
                        break;
                    case "FEAT":
                        await writer.WriteLineAsync("211-Features");
                        await writer.WriteLineAsync(" UTF8");
                        await writer.WriteLineAsync(" EPSV");
                        await writer.WriteLineAsync(" PASV");
                        await writer.WriteLineAsync("211 End");
                        break;
                    case "EPSV":
                    case "PASV":
                        passiveListener?.Stop();
                        passiveListener = new TcpListener(IPAddress.Loopback, 0);
                        passiveListener.Start();
                        var port = ((IPEndPoint)passiveListener.LocalEndpoint).Port;
                        if (command == "EPSV") await writer.WriteLineAsync($"229 Entering Extended Passive Mode (|||{port}|)");
                        else await writer.WriteLineAsync($"227 Entering Passive Mode (127,0,0,1,{port / 256},{port % 256})");
                        break;
                    case "STOR":
                        RemotePath = argument;
                        if (passiveListener is null) throw new InvalidDataException("FTPS client did not select passive mode.");
                        await writer.WriteLineAsync("150 Opening protected data connection");
                        using (var dataSocket = await passiveListener.AcceptTcpClientAsync(timeout.Token))
                        await using (var dataTls = new SslStream(dataSocket.GetStream(), leaveInnerStreamOpen: false))
                        {
                            await dataTls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions
                            {
                                ServerCertificateContext = SslStreamCertificateContext.Create(_certificate, null, offline: true),
                                EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
                            }, timeout.Token);
                            Interlocked.Exchange(ref _encryptedData, 1);
                            using var buffer = new MemoryStream();
                            await dataTls.CopyToAsync(buffer, timeout.Token);
                            _uploadedBytes = buffer.ToArray();
                        }
                        passiveListener.Stop();
                        passiveListener = null;
                        await writer.WriteLineAsync("226 Transfer complete");
                        break;
                    case "QUIT":
                        await writer.WriteLineAsync("221 Goodbye");
                        return;
                    case "PWD":
                        await writer.WriteLineAsync("257 \"/\" is current directory");
                        break;
                    case "SYST":
                        await writer.WriteLineAsync("215 UNIX Type: L8");
                        break;
                    case "SIZE":
                    case "MDTM":
                    case "MLST":
                        await writer.WriteLineAsync("550 File not found");
                        break;
                    default:
                        await writer.WriteLineAsync("200 OK");
                        break;
                }
            }
            passiveListener?.Stop();
        }

        public async ValueTask DisposeAsync()
        {
            _listener.Stop();
            try { await _runTask.WaitAsync(TimeSpan.FromSeconds(1)); }
            catch { }
        }
    }
}
