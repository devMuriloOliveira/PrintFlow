using System.Net;
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Compression;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using FilaAgent.Runtime;
using FilaAgent.ReleaseTool;
using FilaAgentHost;
using Microsoft.Data.Sqlite;

var assertions = 0;
void Check(bool condition, string message)
{
    assertions++;
    if (!condition) throw new InvalidOperationException("FAIL: " + message);
    Console.WriteLine("PASS: " + message);
}

try
{
if (args.Length > 0 && args[0].Equals("--orca-live-smoke", StringComparison.OrdinalIgnoreCase))
{
    var executable = args.Length > 1 ? args[1] : OrcaSlicerService.ResolveConfiguredExecutable(new Dictionary<string, string?>());
    return await RunOrcaLiveSmokeAsync(executable);
}
if (args.Length > 0 && args[0].Equals("--orca-store-discovery-smoke", StringComparison.OrdinalIgnoreCase))
{
    var executable = OrcaSlicerService.ResolveConfiguredExecutable(new Dictionary<string, string?>());
    var unsupportedVersion = OrcaSlicerService.FindUnvalidatedStorePackageVersion();
    Console.WriteLine($"Resolved Orca executable: {(string.IsNullOrWhiteSpace(executable) ? "none" : executable)}");
    Console.WriteLine($"Unvalidated Store package version: {unsupportedVersion ?? "none"}");
    return 0;
}
if (args.Contains("--bambu-ftps-only", StringComparer.OrdinalIgnoreCase))
{
    await BambuRuntimeIntegrationChecks.RunFtpsAsync(Check);
    return 0;
}
if (args.Contains("--bambu-mqtt-local", StringComparer.OrdinalIgnoreCase))
{
    await BambuRuntimeIntegrationChecks.RunMqttAsync(Check);
    return 0;
}

BambuCertificateValidationChecks.Run(Check);

var untrustedRoot = "SignTool Error: A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider.\nSignTool Error: Signing verification failed.";
var runnerUntrustedRoot = "Timestamp: DigiCert Timestamp Responder\nNumber of files successfully Verified: 0\nNumber of warnings: 0\nNumber of errors: 1\nSignTool Error: A certificate chain processed, but terminated in a root\n\tcertificate which is not trusted by the trust provider.";
Check(NativeProtocol.TryParsePairingCode("fila-agent://pair?code=FILA-PAIR-20261008") == "FILA-PAIR-20261008", "protocolo Fila Agent aceita somente codigo de pareamento valido");
Check(NativeProtocol.TryParsePairingCode("printflow-agent://pair?code=FILA-PAIR-20261008") is null, "protocolo legado PrintFlow deixa de iniciar o Agent");
Check(AuthenticodeVerificationPolicy.IsAcceptable(0, "Successfully verified."), "Authenticode aceita somente sucesso sem avisos");
Check(AuthenticodeVerificationPolicy.IsAcceptable(1, untrustedRoot), "Authenticode permite apenas a falha de raiz não confiável do certificado Early Access");
Check(AuthenticodeVerificationPolicy.IsAcceptable(1, runnerUntrustedRoot), "Authenticode reconhece a quebra de linha e contadores do SignTool no runner");
Check(!AuthenticodeVerificationPolicy.IsAcceptable(1, runnerUntrustedRoot.Replace("Number of warnings: 0", "Number of warnings: 1")), "Authenticode rejeita avisos reais do SignTool");
Check(!AuthenticodeVerificationPolicy.IsAcceptable(1, runnerUntrustedRoot + "\nSignTool Error: hash mismatch."), "Authenticode rejeita hash invalido mesmo com raiz nao confiavel no runner");
Check(!AuthenticodeVerificationPolicy.IsAcceptable(2, untrustedRoot), "Authenticode rejeita resultado de aviso do SignTool");
Check(!AuthenticodeVerificationPolicy.IsAcceptable(1, "SignTool Error: hash mismatch."), "Authenticode rejeita hash inválido mesmo quando o SignTool falha");
Check(!AuthenticodeVerificationPolicy.IsAcceptable(1, untrustedRoot + "\nSignTool Error: bad digest."), "Authenticode rejeita falha de digest combinada com raiz não confiável");
Check(!AuthenticodeVerificationPolicy.IsAcceptable(1, "SignTool Error: Signing verification failed."), "Authenticode rejeita erro sem a causa de confiança esperada");

var oldConfig = AgentConfiguration.FromEnvironment(new Dictionary<string, string?>
{
    ["PRINTFLOW_ENVIRONMENT"] = "DEVELOPMENT",
    ["PRINTFLOW_API_URL"] = "http://localhost:3333",
    ["PRINTFLOW_AGENT_LOCAL_PORT"] = "17874",
    ["PRINTFLOW_AGENT_HEALTH_SNAPSHOT_MS"] = "120000",
    ["PRINTFLOW_AGENT_WS_POLL_MS"] = "70000",
    ["PRINTFLOW_AGENT_SSE_POLL_MS"] = "40000"
}, appData: Path.GetTempPath(), localAppData: Path.GetTempPath());
Check(oldConfig.ApiUrl.AbsoluteUri == "http://localhost:3333/" && oldConfig.LocalPort == 17874, "aceita configuracao PRINTFLOW_* atual");
Check(oldConfig.HealthSnapshotInterval == TimeSpan.FromMinutes(2) &&
    oldConfig.WebSocketCommandPollInterval == TimeSpan.FromSeconds(70) &&
    oldConfig.SseCommandPollInterval == TimeSpan.FromSeconds(40),
    "aceita intervalos de health e polling configurados pelo alias PRINTFLOW");

var aliasConfig = AgentConfiguration.FromEnvironment(new Dictionary<string, string?>
{
    ["FILA_AGENT_ENVIRONMENT"] = "DEVELOPMENT",
    ["PRINTFLOW_ENVIRONMENT"] = "PRODUCTION",
    ["FILA_AGENT_API_URL"] = "http://127.0.0.1:3333",
    ["PRINTFLOW_API_URL"] = "https://old.example",
    ["FILA_AGENT_HEALTH_SNAPSHOT_MS"] = "90000",
    ["PRINTFLOW_AGENT_HEALTH_SNAPSHOT_MS"] = "180000",
    ["FILA_AGENT_WS_POLL_MS"] = "120000",
    ["PRINTFLOW_AGENT_WS_POLL_MS"] = "200000",
    ["FILA_AGENT_SSE_POLL_MS"] = "60000",
    ["PRINTFLOW_AGENT_SSE_POLL_MS"] = "90000"
}, appData: Path.GetTempPath(), localAppData: Path.GetTempPath());
Check(aliasConfig.ApiUrl.Host == "127.0.0.1", "variavel FILA_AGENT_* tem precedencia sobre alias legado");
Check(aliasConfig.HealthSnapshotInterval == TimeSpan.FromSeconds(90) &&
    aliasConfig.WebSocketCommandPollInterval == TimeSpan.FromSeconds(120) &&
    aliasConfig.SseCommandPollInterval == TimeSpan.FromSeconds(60),
    "intervalos FILA_AGENT_* prevalecem sobre aliases PRINTFLOW conflitantes");
var boundedPollConfig = AgentConfiguration.FromEnvironment(new Dictionary<string, string?>
{
    ["FILA_AGENT_HEALTH_SNAPSHOT_MS"] = "1",
    ["FILA_AGENT_WS_POLL_MS"] = "1",
    ["FILA_AGENT_SSE_POLL_MS"] = "1"
}, appData: Path.GetTempPath(), localAppData: Path.GetTempPath());
Check(boundedPollConfig.HealthSnapshotInterval == TimeSpan.FromSeconds(60) &&
    boundedPollConfig.WebSocketCommandPollInterval == TimeSpan.FromSeconds(60) &&
    boundedPollConfig.SseCommandPollInterval == TimeSpan.FromSeconds(30),
    "intervalos de health e polling aplicam limites minimos seguros");
Check(AgentRealtimeNotificationClient.BuildWebSocketEndpoint(new Uri("https://api.example.test/base")).AbsoluteUri ==
    "wss://api.example.test/api/agents/ws" &&
    AgentRealtimeNotificationClient.BuildSseEndpoint(new Uri("https://api.example.test/base")).AbsolutePath == "/api/agents/events",
    "runtime C# monta endpoints oficiais WebSocket e SSE preservando host seguro da API");

var realtimeSseHandler = new RealtimeSseHandler(": keepalive\n\n" +
    "event: ready\ndata: {\"type\":\"ready\"}\n\n" +
    "event: command\ndata: {\"type\":\ndata: \"command_available\"}\n\n");
using (var realtimeSseHttp = new HttpClient(realtimeSseHandler) { Timeout = Timeout.InfiniteTimeSpan })
using (var realtimeSseCancellation = new CancellationTokenSource())
using (var unusedRealtimePort = new TcpListener(IPAddress.Loopback, 0))
{
    unusedRealtimePort.Start();
    var unavailableWebSocketPort = ((IPEndPoint)unusedRealtimePort.LocalEndpoint).Port;
    unusedRealtimePort.Stop();
    var realtimeConfiguration = new AgentConfiguration("DEVELOPMENT", new Uri("https://api.example.test"),
        new Uri($"ws://127.0.0.1:{unavailableWebSocketPort}"), [], 17873, Path.GetTempPath(), Path.GetTempPath(), "0.1.25");
    using var realtimeClient = new AgentRealtimeNotificationClient(realtimeConfiguration, realtimeSseHttp);
    var realtimeSseCommandSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var realtimeModes = new System.Collections.Concurrent.ConcurrentQueue<string>();
    var realtimeCredentials = new AgentCredentials { AgentId = "agent-realtime", AgentSecret = "secret-realtime" };
    var realtimeTask = realtimeClient.RunAsync(realtimeCredentials,
        () => { realtimeSseCommandSeen.TrySetResult(); realtimeSseCancellation.Cancel(); },
        mode => realtimeModes.Enqueue(mode), realtimeSseCancellation.Token);
    await realtimeSseCommandSeen.Task.WaitAsync(TimeSpan.FromSeconds(5));
    try { await realtimeTask.WaitAsync(TimeSpan.FromSeconds(5)); }
    catch (OperationCanceledException) when (realtimeSseCancellation.IsCancellationRequested) { }
    Check(realtimeSseHandler.LastPath == "/api/agents/events" && realtimeSseHandler.LastAgentId == "agent-realtime" &&
        realtimeSseHandler.LastAgentSecret == "secret-realtime" && realtimeSseHandler.LastAccept == "text/event-stream" &&
        realtimeModes.Contains("sse"),
        "fallback SSE C# autentica com headers do Agent, interpreta evento multiline e acorda polling de comandos");
}

var realtimeWebSocketPort = GetFreePort();
using (var realtimeWebSocketListener = new TcpListener(IPAddress.Loopback, realtimeWebSocketPort))
using (var realtimeWebSocketCancellation = new CancellationTokenSource())
{
    realtimeWebSocketListener.Start();
    var realtimeWebSocketRequest = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
    var realtimeWebSocketServer = Task.Run(async () =>
    {
        using var client = await realtimeWebSocketListener.AcceptTcpClientAsync(realtimeWebSocketCancellation.Token);
        var stream = client.GetStream();
        var request = await ReadHttpHeadersAsync(stream, realtimeWebSocketCancellation.Token);
        realtimeWebSocketRequest.TrySetResult(request);
        var key = ReadHttpHeader(request, "Sec-WebSocket-Key");
        var accept = Convert.ToBase64String(System.Security.Cryptography.SHA1.HashData(
            Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        var handshake = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            $"Sec-WebSocket-Accept: {accept}\r\n\r\n");
        await stream.WriteAsync(handshake, realtimeWebSocketCancellation.Token);
        await WriteWebSocketTextFrameAsync(stream, "{\"type\":\"ready\"}", realtimeWebSocketCancellation.Token);
        await WriteWebSocketTextFrameAsync(stream, "{\"type\":\"command_available\"}", realtimeWebSocketCancellation.Token);
    });

    var realtimeWebSocketConfiguration = new AgentConfiguration("DEVELOPMENT",
        new Uri($"http://127.0.0.1:{realtimeWebSocketPort}"),
        new Uri($"ws://127.0.0.1:{realtimeWebSocketPort}"), [], 17873, Path.GetTempPath(), Path.GetTempPath(), "0.1.25");
    using var realtimeWebSocketClient = new AgentRealtimeNotificationClient(realtimeWebSocketConfiguration);
    var realtimeWebSocketCommandSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var realtimeWebSocketModes = new System.Collections.Concurrent.ConcurrentQueue<string>();
    var realtimeWebSocketTask = realtimeWebSocketClient.RunAsync(
        new AgentCredentials { AgentId = "agent-websocket", AgentSecret = "secret-websocket" },
        () => { realtimeWebSocketCommandSeen.TrySetResult(); realtimeWebSocketCancellation.Cancel(); },
        mode => realtimeWebSocketModes.Enqueue(mode), realtimeWebSocketCancellation.Token);
    await realtimeWebSocketCommandSeen.Task.WaitAsync(TimeSpan.FromSeconds(5));
    var realtimeUpgradeRequest = await realtimeWebSocketRequest.Task.WaitAsync(TimeSpan.FromSeconds(5));
    try { await realtimeWebSocketTask.WaitAsync(TimeSpan.FromSeconds(5)); }
    catch (OperationCanceledException) when (realtimeWebSocketCancellation.IsCancellationRequested) { }
    await realtimeWebSocketServer.WaitAsync(TimeSpan.FromSeconds(5));
    Check(realtimeUpgradeRequest.StartsWith("GET /api/agents/ws HTTP/1.1", StringComparison.Ordinal) &&
        ReadHttpHeader(realtimeUpgradeRequest, "x-agent-id") == "agent-websocket" &&
        ReadHttpHeader(realtimeUpgradeRequest, "x-agent-secret") == "secret-websocket" &&
        realtimeWebSocketModes.Contains("websocket"),
        "WebSocket C# faz upgrade com autenticaÃ§Ã£o do Agent e sinaliza apenas command_available");
}

InvalidOperationException? productionRejected = null;
try
{
    AgentConfiguration.FromEnvironment(new Dictionary<string, string?>
    {
        ["PRINTFLOW_ENVIRONMENT"] = "PRODUCTION",
        ["PRINTFLOW_API_URL"] = "http://localhost:3333/private?token=do-not-log"
    });
}
catch (InvalidOperationException error) { productionRejected = error; }
Check(productionRejected is not null, "rejeita endpoint local em PRODUCTION");
Check(productionRejected?.Message.Contains("http://localhost", StringComparison.Ordinal) == true &&
    !productionRejected.Message.Contains("private", StringComparison.Ordinal) &&
    !productionRejected.Message.Contains("do-not-log", StringComparison.Ordinal),
    "diagnostico de URL insegura informa somente esquema e host, sem caminho ou query");

var tempRoot = Path.Combine(Path.GetTempPath(), "fila-agent-runtime-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(tempRoot);
var appDataFixture = Path.Combine(tempRoot, "app-data-fixture");
var newDataRoot = Path.Combine(appDataFixture, "Fila Agent");
var legacyDataRoot = Path.Combine(appDataFixture, "PrintFlow Agent");
Check(AgentLocalPaths.ResolveDataDirectory(new Dictionary<string, string?>(), appDataFixture) == Path.GetFullPath(newDataRoot),
    "instalacao nova escolhe o diretorio de dados Fila Agent");
Directory.CreateDirectory(legacyDataRoot);
Check(AgentLocalPaths.ResolveDataDirectory(new Dictionary<string, string?>(), appDataFixture) == Path.GetFullPath(legacyDataRoot),
    "diretorio PrintFlow existente preserva os dados durante upgrade e rollback");
Directory.CreateDirectory(newDataRoot);
Check(AgentLocalPaths.ResolveDataDirectory(new Dictionary<string, string?>(), appDataFixture) == Path.GetFullPath(legacyDataRoot),
    "diretorio legado prevalece quando ambos existem para evitar perder o pareamento");
var explicitNewDataRoot = Path.Combine(tempRoot, "explicit-fila-data");
var configuredNewDataRoot = AgentLocalPaths.ResolveDataDirectory(new Dictionary<string, string?>
{
    ["FILA_AGENT_DATA_DIR"] = explicitNewDataRoot,
    ["PRINTFLOW_AGENT_DATA_DIR"] = Path.Combine(tempRoot, "ignored-legacy-data")
}, appDataFixture);
Check(configuredNewDataRoot == Path.GetFullPath(explicitNewDataRoot),
    "FILA_AGENT_DATA_DIR prevalece sobre caminho legado e diretórios detectados");
var explicitLegacyDataRoot = Path.Combine(tempRoot, "explicit-legacy-data");
Check(AgentLocalPaths.ResolveDataDirectory(new Dictionary<string, string?>
{
    ["PRINTFLOW_AGENT_DATA_DIR"] = explicitLegacyDataRoot
}, appDataFixture) == Path.GetFullPath(explicitLegacyDataRoot),
    "alias PRINTFLOW_AGENT_DATA_DIR preserva configuração explícita antiga");
try
{
    var protector = new ReversibleTestProtector();
    var store = new AgentCredentialStore(tempRoot, protector);
    var credentials = new AgentCredentials
    {
        AgentId = "agent-test-123",
        AgentSecret = "pf_agent_private_secret",
        TenantId = "tenant-test",
        TenantName = "Empresa teste",
        MachineName = "PC-TESTE",
        CredentialVersion = 1
    };
    await store.SaveAsync(credentials);
    var disk = await File.ReadAllTextAsync(Path.Combine(tempRoot, "agent.json"));
    Check(!disk.Contains(credentials.AgentSecret, StringComparison.Ordinal), "credencial nova nao fica em texto puro no arquivo");
    Check((await store.LoadAsync()) == credentials, "credencial DPAPI volta com os mesmos campos");
    var rotatingCredentials = credentials with { AgentSecret = "rotated-secret-test", PendingCredentialVersion = 2 };
    await store.SaveAsync(rotatingCredentials);
    Check((await store.LoadAsync()) == rotatingCredentials && !(await File.ReadAllTextAsync(Path.Combine(tempRoot, "agent.json"))).Contains("rotated-secret-test", StringComparison.Ordinal), "segredo pendente de rotação persiste protegido para recuperação após reinício");
    await store.SaveAsync(credentials);

    var printerCredentialRoot = Path.Combine(tempRoot, "legacy-printer-credentials");
    Directory.CreateDirectory(printerCredentialRoot);
    const string nodePrinterStoreFixture = "{\"version\":2,\"salt\":\"Rml4dHVyZVNhbHQ=\",\"printers\":{\"bambu:TESTSERIAL\":{\"protocol\":\"bambu\",\"updatedAt\":\"2026-01-01T00:00:00.000Z\",\"encrypted\":{\"iv\":\"AAECAwQFBgcICQoL\",\"tag\":\"T81kKaL31OkxR7UwYu/QgQ==\",\"value\":\"/etqihlQcuiPNlpEWyS8FRMscuYs6nEyn8Bv9W4/MZuT9PMWT1ZvvGgynP5V3slDiad9Tg==\"}}}}";
    var nodePrinterStorePayload = Convert.ToBase64String(protector.Protect(Encoding.UTF8.GetBytes(nodePrinterStoreFixture)));
    await File.WriteAllTextAsync(Path.Combine(printerCredentialRoot, "printer-credentials.json"),
        JsonSerializer.Serialize(new { version = 2, protection = "windows-dpapi", payload = nodePrinterStorePayload }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    var credentialUser = new PrinterCredentialUserContext("fixture-host", "fixture-user", @"C:\fixture");
    using var printerCredentialStore = new AgentPrinterCredentialStore(printerCredentialRoot, protector, credentialUser);
    var legacyPrinterCredentials = await printerCredentialStore.LoadAsync(new PrinterCredentialIdentity("bambu", Serial: "TESTSERIAL"));
    Check(legacyPrinterCredentials.GetValueOrDefault("accessCode") == "test-lan-code" && legacyPrinterCredentials.GetValueOrDefault("serial") == "TESTSERIAL",
        "C# abre fixture de credencial Bambu cifrada no formato Node Scrypt e AES-GCM");

    var savedPrinterCredentials = await printerCredentialStore.SaveAsync(new PrinterCredentialIdentity("bambu", Serial: "TESTSERIAL"),
        new Dictionary<string, string?> { ["accessCode"] = "new-test-lan-code", ["serial"] = "TESTSERIAL", ["unused"] = "must-not-be-stored" });
    var rereadPrinterCredentials = await printerCredentialStore.LoadAsync(new PrinterCredentialIdentity("bambu", Serial: "TESTSERIAL"));
    var printerCredentialFile = await File.ReadAllTextAsync(printerCredentialStore.FilePath);
    Check(savedPrinterCredentials && rereadPrinterCredentials.GetValueOrDefault("accessCode") == "new-test-lan-code" &&
        !printerCredentialFile.Contains("new-test-lan-code", StringComparison.Ordinal) && !printerCredentialFile.Contains("must-not-be-stored", StringComparison.Ordinal),
        "C# grava credencial no formato DPAPI compatível sem expor nem persistir campos fora da whitelist");
    Check(AgentPrinterCredentialStore.GetPrinterCredentialKey(new PrinterCredentialIdentity("octoprint", "192.168.1.2")) == "octoprint:192.168.1.2:80" &&
        AgentPrinterCredentialStore.GetPrinterCredentialKey(new PrinterCredentialIdentity("moonraker", "192.168.1.3")) == "moonraker:192.168.1.3:7125" &&
        AgentPrinterCredentialStore.GetPrinterCredentialKey(new PrinterCredentialIdentity("prusalink", "192.168.1.4")) == "prusalink:192.168.1.4:80" &&
        AgentPrinterCredentialStore.GetPrinterCredentialKey(new PrinterCredentialIdentity("marlin", PortName: "COM3")) == "marlin:COM3",
        "chaves C# de credenciais preservam identidade por serial, IP/porta e porta COM");
    Check(await printerCredentialStore.ClearAsync(new PrinterCredentialIdentity("bambu", Serial: "TESTSERIAL")) &&
        (await printerCredentialStore.LoadAsync(new PrinterCredentialIdentity("bambu", Serial: "TESTSERIAL"))).Count == 0,
        "C# remove credencial apenas do identificador de impressora solicitado");

    if (OperatingSystem.IsWindows())
    {
        try
        {
            var realDpapiDirectory = Path.Combine(tempRoot, "printer-credentials-real-dpapi");
            var realDpapiIdentity = new PrinterCredentialIdentity("octoprint", "192.0.2.55", 80);
            var realDpapiProtector = new WindowsDpapiDataProtector();
            using var realDpapiWriter = new AgentPrinterCredentialStore(realDpapiDirectory, realDpapiProtector, credentialUser);
            await realDpapiWriter.SaveAsync(realDpapiIdentity, new Dictionary<string, string?> { ["apiKey"] = "DPAPI-SYNTHETIC-API-KEY" });
            var realDpapiFile = await File.ReadAllTextAsync(realDpapiWriter.FilePath);
            using var realDpapiReader = new AgentPrinterCredentialStore(realDpapiDirectory, realDpapiProtector, credentialUser);
            var realDpapiLoaded = await realDpapiReader.LoadAsync(realDpapiIdentity);
            Check(!realDpapiFile.Contains("DPAPI-SYNTHETIC-API-KEY", StringComparison.Ordinal) &&
                realDpapiLoaded.GetValueOrDefault("apiKey") == "DPAPI-SYNTHETIC-API-KEY",
                "DPAPI real do Windows persiste e recupera credencial sintetica de impressora entre instancias C#");
        }
        catch (System.Security.Cryptography.CryptographicException error) when
            (error.Message.Contains("user profile", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine("SKIP: DPAPI real requer perfil Windows carregado; os contratos locais seguem testados com o protetor controlado.");
        }
    }

    var legacyRoot = Path.Combine(tempRoot, "legacy");
    Directory.CreateDirectory(legacyRoot);
    await File.WriteAllTextAsync(Path.Combine(legacyRoot, "agent.json"), JsonSerializer.Serialize(credentials, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    var legacyStore = new AgentCredentialStore(legacyRoot, protector);
    Check((await legacyStore.LoadAsync()) == credentials, "credencial legada em JSON puro e lida sem mudar os campos");
    Check((await File.ReadAllTextAsync(Path.Combine(legacyRoot, "agent.json"))).Contains("windows-dpapi", StringComparison.Ordinal), "credencial legada e regravada no envelope compativel protegido");

    await store.SavePendingPairingCodeAsync(" ab12-cd34 ");
    Check(await store.ConsumePendingPairingCodeAsync() == "AB12-CD34", "codigo de pareamento protegido e normalizado");
    Check(await store.ConsumePendingPairingCodeAsync() == string.Empty, "codigo de pareamento e consumido uma unica vez");

    var localStore = new AgentCredentialStore(Path.Combine(tempRoot, "local"), protector);
    var diagnosticsTokenStore = new AgentDiagnosticsTokenStore(Path.Combine(tempRoot, "local"), protector);
    using var diagnosticsTokenEnvelope = JsonDocument.Parse(await File.ReadAllTextAsync(diagnosticsTokenStore.FilePath));
    var protectedDiagnosticsToken = diagnosticsTokenEnvelope.RootElement.GetProperty("payload").GetString()!;
    Check(diagnosticsTokenEnvelope.RootElement.GetProperty("protection").GetString() == "windows-dpapi" &&
        !protectedDiagnosticsToken.Contains(diagnosticsTokenStore.Token, StringComparison.Ordinal) &&
        Encoding.UTF8.GetString(protector.Unprotect(Convert.FromBase64String(protectedDiagnosticsToken))) == diagnosticsTokenStore.Token,
        "token de diagnostico e persistido no envelope DPAPI compativel com as ferramentas Node de suporte");
    using (var unavailableDiagnosticsToken = new AgentDiagnosticsTokenStore(Path.Combine(tempRoot, "diagnostics-profile-unavailable"), new UnavailableDpapiTestProtector()))
        Check(!unavailableDiagnosticsToken.IsAvailable && unavailableDiagnosticsToken.Token.Length == 0,
            "falha de perfil DPAPI desativa somente o diagnostico e nao impede iniciar o runtime");
    var port = GetFreePort();
    await using var server = new AgentLocalServer(port, ["https://filamind.com.br"], localStore,
        () => new AgentLocalStatus(CloudConnected: true, ActivePrintJobs: 2), diagnosticsToken: diagnosticsTokenStore,
        getDiagnostics: () => new { status = "healthy", serial = "BAMBU-SERIAL-1234", accessCode = "LAN-SECRET-1122", password = "printer-password", ip = "192.168.10.27" });
    await server.StartAsync();
    using var http = new HttpClient();
    using var healthRequest = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/healthz");
    healthRequest.Headers.Add("Origin", "https://filamind.com.br");
    using var health = await http.SendAsync(healthRequest);
    using var healthJson = JsonDocument.Parse(await health.Content.ReadAsStringAsync());
    Check(health.StatusCode == HttpStatusCode.OK && healthJson.RootElement.GetProperty("app").GetString() == "fila-agent", "healthz identifica a marca Fila Agent e responde ao site permitido");
    Check(healthJson.RootElement.GetProperty("cloudConnected").GetBoolean() && healthJson.RootElement.GetProperty("activePrintJobs").GetInt32() == 2, "healthz informa estado agregado do runtime");
    Check(health.Headers.GetValues("Access-Control-Allow-Origin").Single() == "https://filamind.com.br", "CORS devolve somente a origem permitida");

    using var diagnosticsUnauthorizedRequest = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/diagnostics");
    diagnosticsUnauthorizedRequest.Headers.Add("x-fila-agent-diagnostics-token", "invalid-token");
    using var diagnosticsUnauthorized = await http.SendAsync(diagnosticsUnauthorizedRequest);
    Check(diagnosticsUnauthorized.StatusCode == HttpStatusCode.Unauthorized, "diagnostico C# rejeita token local ausente ou invalido");

    using var diagnosticsOriginRequest = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/diagnostics");
    diagnosticsOriginRequest.Headers.Add("Origin", "https://filamind.com.br");
    diagnosticsOriginRequest.Headers.Add("x-fila-agent-diagnostics-token", diagnosticsTokenStore.Token);
    using var diagnosticsOrigin = await http.SendAsync(diagnosticsOriginRequest);
    Check(diagnosticsOrigin.StatusCode == HttpStatusCode.Forbidden, "diagnostico C# bloqueia acesso originado em navegador mesmo com token valido");

    using var diagnosticsRequest = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/diagnostics");
    diagnosticsRequest.Headers.Add("x-fila-agent-diagnostics-token", diagnosticsTokenStore.Token);
    using var diagnosticsResponse = await http.SendAsync(diagnosticsRequest);
    var diagnosticsBody = await diagnosticsResponse.Content.ReadAsStringAsync();
    using var diagnosticsJson = JsonDocument.Parse(diagnosticsBody);
    Check(diagnosticsResponse.StatusCode == HttpStatusCode.OK && diagnosticsJson.RootElement.GetProperty("agent").GetProperty("version").GetString() == "0.1.29" &&
        diagnosticsJson.RootElement.GetProperty("network").GetProperty("interfaces").ValueKind == JsonValueKind.Array,
        "diagnostico C# autenticado retorna contrato de agente e interfaces locais redigidas");
    Check(!diagnosticsBody.Contains("LAN-SECRET-1122", StringComparison.Ordinal) && !diagnosticsBody.Contains("printer-password", StringComparison.Ordinal) &&
        diagnosticsBody.Contains("***1234", StringComparison.Ordinal) && diagnosticsBody.Contains("192.168.10.x", StringComparison.Ordinal),
        "diagnostico C# remove segredos, mascara serial e reduz endereco IPv4");
    using var legacyDiagnosticsRequest = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/diagnostics");
    legacyDiagnosticsRequest.Headers.Add("x-printflow-diagnostics-token", diagnosticsTokenStore.Token);
    using var legacyDiagnosticsResponse = await http.SendAsync(legacyDiagnosticsRequest);
    Check(legacyDiagnosticsResponse.StatusCode == HttpStatusCode.OK, "diagnostico C# preserva o alias PrintFlow somente para suporte legado");

    using var blockedRequest = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/healthz");
    blockedRequest.Headers.Add("Origin", "https://evil.example");
    using var blocked = await http.SendAsync(blockedRequest);
    Check(blocked.StatusCode == HttpStatusCode.Forbidden, "healthz bloqueia origem web nao autorizada");

    using var pairRequest = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/pair")
    {
        Content = new StringContent("{\"code\":\"zz99-yy88\"}", Encoding.UTF8, "application/json")
    };
    pairRequest.Headers.Add("Origin", "https://filamind.com.br");
    using var pair = await http.SendAsync(pairRequest);
    Check(pair.StatusCode == HttpStatusCode.Accepted, "pareamento local retorna pairing_queued");
    Check(await localStore.ConsumePendingPairingCodeAsync() == "ZZ99-YY88", "pareamento local persiste codigo para o runtime consumir");
    await server.DisposeAsync();
    Check(!File.Exists(diagnosticsTokenStore.FilePath), "token temporario de diagnostico e removido ao encerrar o servidor local");

    var noDiagnosticsPort = GetFreePort();
    await using (var serverWithoutDiagnostics = new AgentLocalServer(noDiagnosticsPort, [], localStore))
    {
        await serverWithoutDiagnostics.StartAsync();
        using var diagnosticsUnavailable = await http.GetAsync($"http://127.0.0.1:{noDiagnosticsPort}/diagnostics");
        Check(diagnosticsUnavailable.StatusCode == HttpStatusCode.ServiceUnavailable, "diagnostico C# retorna 503 quando token nao foi configurado");
    }

    var databasePath = Path.Combine(tempRoot, "agent-operations.sqlite");
    using (var operations = new AgentLocalOperationsStore(databasePath))
    {
        Check(operations.SchemaVersion == 8, "SQLite novo usa o schema de operacoes atual v8");
        Check(operations.Begin(new AgentCommand("command-1", "printer_status")).Status == "new", "comando novo e marcado processing uma unica vez");
        Check(operations.Begin(new AgentCommand("command-1", "printer_status")).Status == "processing", "comando em andamento nao pode ser executado novamente");
        operations.RecordResult("command-1", new { success = true, connected = true });
        var completed = operations.Begin(new AgentCommand("command-1", "printer_status"));
        Check(completed.Status == "completed" && completed.Result?.GetProperty("connected").GetBoolean() == true, "resultado concluido e persistido para deduplicacao");
        Check(operations.ListPendingCompletions().Single().CommandId == "command-1", "conclusao permanece na outbox ate confirmacao da API");
        operations.RetryCompletion("command-1", error: "offline");
        Check(operations.ListPendingCompletions().Single().Attempts == 1, "tentativa de outbox fica registrada no SQLite");
        operations.AcknowledgeCompletion("command-1");
        Check(operations.GetPendingCounts().Total == 0, "confirmacao remove conclusao pendente");

        operations.Begin(new AgentCommand("command-event", "printer_status"));
        operations.RecordResult("command-event", new { success = false, status = new { state = "failed" } }, "printer_status");
        var commandEvent = operations.ListPendingEvents().Single();
        Check(commandEvent.EventType == "command.completed" &&
            commandEvent.Payload.GetProperty("commandId").GetString() == "command-event" &&
            commandEvent.Payload.GetProperty("commandType").GetString() == "printer_status" &&
            !commandEvent.Payload.GetProperty("success").GetBoolean() &&
            commandEvent.Payload.GetProperty("status").GetString() == "failed",
            "resultado e evento command.completed sao persistidos juntos com os campos atuais");
        operations.AcknowledgeEvent(commandEvent.Id);
        operations.AcknowledgeCompletion("command-event");

        var eventId = operations.QueueEvent("printer.status", new { state = "idle" });
        var retryAt = DateTimeOffset.UtcNow.AddMinutes(1);
        operations.MarkEventAttempted(eventId, retryAt, "temporarily offline");
        Check(operations.ListPendingEvents(asOf: DateTimeOffset.UtcNow).Count == 0, "outbox respeita proximo horario de retry");
        Check(operations.ListPendingEvents(asOf: retryAt.AddSeconds(1)).Single().Attempts == 1, "evento volta a ficar disponivel apos retry");

        var metricId = operations.QueueProductionMetric("print-job-metric", new { status = "completed", idempotencyKey = "agent-command-metric" });
        var duplicateMetricId = operations.QueueProductionMetric("print-job-metric", new { status = "failed", idempotencyKey = "agent-command-metric" });
        Check(metricId == duplicateMetricId && operations.ListPendingProductionMetrics().Single().Payload.GetProperty("status").GetString() == "failed",
            "outbox de metricas atualiza a mesma chave idempotente sem duplicar linha");
        var metricRetryAt = DateTimeOffset.UtcNow.AddMinutes(1);
        operations.RetryProductionMetric(metricId, metricRetryAt, "temporarily offline");
        Check(operations.ListPendingProductionMetrics(asOf: DateTimeOffset.UtcNow).Count == 0 &&
            operations.ListPendingProductionMetrics(asOf: metricRetryAt.AddSeconds(1)).Single().Attempts == 1,
            "outbox de metricas respeita o horario de retry e preserva tentativas");
        operations.DeadLetterProductionMetric(metricId, "permanent failure");
        Check(operations.GetDeadLetterProductionMetricCount() == 1 &&
            operations.ListDeadLetterProductionMetrics().Single().LastError == "permanent failure",
            "outbox de metricas preserva erros permanentes em dead letter");
        operations.AcknowledgeProductionMetric(metricId);
        Check(operations.GetDeadLetterProductionMetricCount() == 0, "metricas removidas somente apos confirmacao explicita");

        operations.Begin(new AgentCommand("command-interrupted", "start_print"));
    }
    using (var recovered = new AgentLocalOperationsStore(databasePath))
    {
        Check(recovered.RecoverInterruptedCommands() == 1, "comando interrompido no reinicio e concluido sem repetir execucao");
        var result = recovered.Begin(new AgentCommand("command-interrupted", "start_print"));
        Check(result.Status == "completed" && result.Result?.GetProperty("code").GetString() == "agent_restarted", "recovery da impressao permanece idempotente no reinicio");
    }

    var metricOutboxRoot = Path.Combine(tempRoot, "metric-outbox");
    using (var metricStore = new AgentLocalOperationsStore(Path.Combine(metricOutboxRoot, "operations.sqlite")))
    {
        var metricNow = DateTimeOffset.UtcNow;
        var metricResponseStatus = HttpStatusCode.ServiceUnavailable;
        var metricResponseBody = "{\"error\":\"temporarily unavailable\"}";
        var metricApiHandler = new PrinterAdapterHttpHandler(_ => new HttpResponseMessage(metricResponseStatus)
        {
            Content = new StringContent(metricResponseBody, Encoding.UTF8, "application/json")
        });
        using var metricHttp = new HttpClient(metricApiHandler);
        using var metricCloud = new AgentCloudClient(new Uri("https://api.example.test"), metricHttp);
        var metricCredentials = new AgentCredentials { AgentId = "agent-metric", AgentSecret = "secret-metric" };
        var metricOutbox = new ProductionMetricOutboxService(metricCloud, metricStore, maxAttempts: 3,
            random: () => 0.5, utcNow: () => metricNow);
        metricStore.QueueProductionMetric("print job/metric-42", new { status = "completed", idempotencyKey = "agent-metric-complete" });
        Check(await metricOutbox.FlushAsync(metricCredentials) == 0 &&
            metricStore.ListPendingProductionMetrics(asOf: metricNow.AddSeconds(6)).Single().Attempts == 1 &&
            metricStore.ListPendingProductionMetrics(asOf: metricNow.AddSeconds(6)).Single().NextRetryAt is not null,
            "outbox C# agenda retry de metrica quando a API responde 503");
        var metricRequest = metricApiHandler.Requests.Single();
        Check(metricRequest.Method == HttpMethod.Post &&
            metricRequest.Uri.AbsolutePath == "/api/agents/print-jobs/print%20job%2Fmetric-42/metrics" &&
            metricRequest.GetHeader("x-agent-id") == metricCredentials.AgentId &&
            metricRequest.GetHeader("x-agent-secret") == metricCredentials.AgentSecret &&
            metricRequest.Body.Contains("agent-metric-complete", StringComparison.Ordinal),
            "API C# de metricas preserva rota codificada, autenticacao e payload atual");
        metricNow = metricNow.AddSeconds(6);
        metricResponseStatus = HttpStatusCode.OK;
        metricResponseBody = "{\"ok\":true}";
        Check(await metricOutbox.FlushAsync(metricCredentials) == 1 && metricStore.ListPendingProductionMetrics().Count == 0,
            "outbox C# entrega metrica apos a API voltar e remove somente apos sucesso");

        metricStore.QueueProductionMetric("print-job-permanent", new { status = "failed", idempotencyKey = "agent-metric-permanent" });
        metricResponseStatus = HttpStatusCode.BadRequest;
        metricResponseBody = "{\"error\":\"invalid request?token=secret-value\"}";
        Check(await metricOutbox.FlushAsync(metricCredentials) == 0 &&
            metricStore.GetDeadLetterProductionMetricCount() == 1 &&
            metricStore.ListDeadLetterProductionMetrics().Single().LastError?.Contains("[REDACTED]", StringComparison.Ordinal) == true &&
            !metricStore.ListDeadLetterProductionMetrics().Single().LastError!.Contains("secret-value", StringComparison.Ordinal),
            "outbox C# arquiva erro 4xx permanente e remove token do diagnostico");
    }

    var eventOutboxRoot = Path.Combine(tempRoot, "event-outbox");
    using (var eventStore = new AgentLocalOperationsStore(Path.Combine(eventOutboxRoot, "operations.sqlite")))
    {
        var eventNow = DateTimeOffset.UtcNow;
        var eventResponseStatus = HttpStatusCode.ServiceUnavailable;
        var eventResponseBody = "{\"error\":\"temporarily unavailable\"}";
        var eventApiHandler = new PrinterAdapterHttpHandler(_ => new HttpResponseMessage(eventResponseStatus)
        {
            Content = new StringContent(eventResponseBody, Encoding.UTF8, "application/json")
        });
        using var eventHttp = new HttpClient(eventApiHandler);
        using var eventCloud = new AgentCloudClient(new Uri("https://api.example.test"), eventHttp);
        var eventCredentials = new AgentCredentials { AgentId = "agent-event", AgentSecret = "secret-event" };
        var eventOutbox = new AgentEventOutboxService(eventCloud, eventStore, maxAttempts: 3,
            random: () => 0.5, utcNow: () => eventNow);
        eventStore.QueueEvent("command.completed", new { commandId = "command-event-42", success = true });
        Check(await eventOutbox.FlushAsync(eventCredentials) == 0 &&
            eventStore.ListPendingEvents(asOf: eventNow.AddSeconds(6)).Single().Attempts == 1,
            "outbox C# agenda retry de evento quando a API responde 503");
        var eventRequest = eventApiHandler.Requests.Single();
        Check(eventRequest.Method == HttpMethod.Post && eventRequest.Uri.AbsolutePath == "/api/agents/sync-events" &&
            eventRequest.GetHeader("x-agent-id") == eventCredentials.AgentId &&
            eventRequest.GetHeader("x-agent-secret") == eventCredentials.AgentSecret &&
            eventRequest.Body.Contains("command-event-42", StringComparison.Ordinal) &&
            eventRequest.Body.Contains("\"id\":\"1\"", StringComparison.Ordinal),
            "API C# de eventos preserva rota, credenciais e envelope compatível com sync-events");
        eventNow = eventNow.AddSeconds(6);
        eventResponseStatus = HttpStatusCode.OK;
        eventResponseBody = "{\"accepted\":1}";
        Check(await eventOutbox.FlushAsync(eventCredentials) == 1 && eventStore.ListPendingEvents().Count == 0,
            "outbox C# remove evento apenas depois da confirmação da API");

        eventStore.QueueEvent("command.completed", new { commandId = "command-event-bad", success = false });
        eventResponseStatus = HttpStatusCode.BadRequest;
        eventResponseBody = "{\"error\":\"invalid request?token=secret-value\"}";
        Check(await eventOutbox.FlushAsync(eventCredentials) == 0 && eventStore.GetDeadLetterEventCount() == 1 &&
            eventStore.ListDeadLetterEvents().Single().LastError?.Contains("[REDACTED]", StringComparison.Ordinal) == true &&
            !eventStore.ListDeadLetterEvents().Single().LastError!.Contains("secret-value", StringComparison.Ordinal),
            "outbox C# arquiva erro 4xx permanente e remove token do diagnostico");
    }

    var legacyDatabasePath = Path.Combine(tempRoot, "legacy-operations.sqlite");
    using (var legacyDatabase = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = legacyDatabasePath }.ToString()))
    {
        legacyDatabase.Open();
        using var legacyCommand = legacyDatabase.CreateCommand();
        legacyCommand.CommandText = "CREATE TABLE processed_commands(command_id TEXT PRIMARY KEY,command_type TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,completed_at TEXT); INSERT INTO processed_commands VALUES('legacy-command','printer_status','completed','{\"success\":true}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'); PRAGMA user_version=1;";
        legacyCommand.ExecuteNonQuery();
    }
    using (var migrated = new AgentLocalOperationsStore(legacyDatabasePath))
    {
        var legacyCommand = migrated.Begin(new AgentCommand("legacy-command", "printer_status"));
        Check(migrated.SchemaVersion == 8 && legacyCommand.Status == "completed" && legacyCommand.Result?.GetProperty("success").GetBoolean() == true, "migracao do banco legado preserva comando e resultado");
    }

    var executablePath = Path.Combine(tempRoot, "OrcaSlicer", "orca-slicer.exe");
    Directory.CreateDirectory(Path.GetDirectoryName(executablePath)!);
    await File.WriteAllTextAsync(executablePath, "mock executable");
    var storeProgramFiles = Path.Combine(tempRoot, "store-program-files");
    var expectedStoreExe = Path.Combine(storeProgramFiles, "WindowsApps", "OrcaSlicer.OrcaSlicer_2.4.3.0_x64__3qd7h69xpne0g", "orca-slicer.exe");
    var newerStoreExe = Path.Combine(storeProgramFiles, "WindowsApps", "OrcaSlicer.OrcaSlicer_2.5.0.0_x64__3qd7h69xpne0g", "orca-slicer.exe");
    Directory.CreateDirectory(Path.GetDirectoryName(expectedStoreExe)!);
    Directory.CreateDirectory(Path.GetDirectoryName(newerStoreExe)!);
    await File.WriteAllTextAsync(expectedStoreExe, "validated Store build");
    await File.WriteAllTextAsync(newerStoreExe, "not yet validated Store build");
    Check(OrcaSlicerService.ResolveConfiguredExecutable(new Dictionary<string, string?>(), storeProgramFiles) == newerStoreExe, "resolver C# seleciona o pacote Store Orca mais recente e valida o motor pela saída G-code");
    Check(OrcaSlicerService.FindUnvalidatedStorePackageVersion(storeProgramFiles) == "2.5.0.0", "detector identifica pacote Store Orca novo sem aprova-lo para slicing");
    Check(OrcaSlicerService.FindUnvalidatedStorePackageVersion([
        "OrcaSlicer.OrcaSlicer_2.4.3.0_x64__3qd7h69xpne0g",
        "OrcaSlicer.OrcaSlicer_2.5.0.0_x64__3qd7h69xpne0g",
        "Example.App_9.9.9.9_x64__0000000000000"
    ]) == "2.5.0.0", "consulta de pacotes registrados seleciona somente a familia Orca e reporta o pacote novo");
    var currentUserOrcaVersion = OrcaSlicerService.FindUnvalidatedStorePackageVersion();
    Check(currentUserOrcaVersion is null || Version.TryParse(currentUserOrcaVersion, out _), "consulta Win32 da Store para o usuario atual retorna versao valida ou ausencia");
    var desktopStoreRoot = Path.Combine(tempRoot, "desktop-store", "OrcaSlicer");
    Directory.CreateDirectory(Path.Combine(desktopStoreRoot, "resources", "profiles", "BBL"));
    await File.WriteAllTextAsync(Path.Combine(desktopStoreRoot, "orca-slicer.exe"), "validated Store launcher");
    await File.WriteAllTextAsync(Path.Combine(desktopStoreRoot, "OrcaSlicer.dll"), "validated Store engine");
    Check(OrcaSlicerService.ResolveRegisteredDesktopExecutable(desktopStoreRoot, "2.4.2") == Path.Combine(desktopStoreRoot, "orca-slicer.exe"), "resolver aceita instalação Store registrada no Program Files com engine 2.4.2");
    Check(OrcaSlicerService.ResolveRegisteredDesktopExecutable(desktopStoreRoot, "2.4.3") == string.Empty, "resolver rejeita engine Orca ainda sem validação");
    var newerOnlyProgramFiles = Path.Combine(tempRoot, "newer-only-program-files");
    var newerOnlyExe = Path.Combine(newerOnlyProgramFiles, "WindowsApps", "OrcaSlicer.OrcaSlicer_2.5.0.0_x64__3qd7h69xpne0g", "orca-slicer.exe");
    Directory.CreateDirectory(Path.GetDirectoryName(newerOnlyExe)!);
    await File.WriteAllTextAsync(newerOnlyExe, "not yet validated Store build");
    Check(OrcaSlicerService.ResolveConfiguredExecutable(new Dictionary<string, string?>(), newerOnlyProgramFiles) == newerOnlyExe, "resolver C# localiza pacote Store novo para validar o motor em runtime");
    Check(OrcaSlicerService.FindUnvalidatedStorePackageVersion(newerOnlyProgramFiles) == "2.5.0.0", "detector reporta versao Store nao validada quando nao ha fallback conhecido");
    var configuredOrca = Path.Combine(tempRoot, "configured-orca.exe");
    Check(OrcaSlicerService.ResolveConfiguredExecutable(new Dictionary<string, string?> { ["FILA_AGENT_ORCA_SLICER_PATH"] = configuredOrca }, storeProgramFiles) == configuredOrca, "caminho Orca FILA_AGENT configurado tem precedencia sobre a versao Store");
    var officialProfile = OrcaSlicerService.ResolveOfficialProfile("Bambu Lab", "P1S", executablePath);
    Check(officialProfile.Id == "bambu-p1s-pla-basic" && officialProfile.Version == "2.4.2", "resolve perfil oficial e versao do motor OrcaSlicer para P1S");
    Check(Path.GetFileName(officialProfile.SettingsPaths[0]) == "Bambu Lab P1S 0.4 nozzle.json", "perfil oficial seleciona arquivo de maquina correto");
    var unsupportedModelRejected = false;
    try { OrcaSlicerService.ResolveOfficialProfile("Bambu Lab", "H2D", executablePath); }
    catch (InvalidOperationException) { unsupportedModelRejected = true; }
    Check(unsupportedModelRejected, "nao aplica perfil generico a modelo Orca nao cadastrado");

    var inputPath = Path.Combine(tempRoot, "model.3mf");
    await File.WriteAllTextAsync(inputPath, "fake 3mf input");
    foreach (var path in officialProfile.SettingsPaths.Concat(officialProfile.FilamentPaths))
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, "profile fixture");
    }
    var outputPath = Path.Combine(tempRoot, "slice", "print-job.gcode");
    var orcaRunner = new FakeOrcaProcessRunner(writeOutput: true);
    var orca = new OrcaSlicerService(orcaRunner);
    var orcaArgs = OrcaSlicerService.BuildArguments(inputPath, outputPath, officialProfile);
    Check(orcaArgs.Contains("--slice") && orcaArgs.Contains("--load-settings") && orcaArgs.Contains("--load-filaments") && orcaArgs.Contains("--outputdir"), "argumentos Orca mantem o contrato CLI sem shell");
    var bambuOrcaArgs = OrcaSlicerService.BuildArguments(inputPath, Path.Combine(tempRoot, "bambu.gcode.3mf"), officialProfile, exportGcode3mf: true);
    Check(bambuOrcaArgs.Contains("--export-3mf") && bambuOrcaArgs.Contains("bambu.gcode.3mf") && bambuOrcaArgs.Contains("--min-save") &&
        bambuOrcaArgs[Array.IndexOf(bambuOrcaArgs.ToArray(), "--outputdir") + 1] == Path.GetFullPath(tempRoot),
        "Orca CLI exporta pacote gcode.3mf minimo no diretorio temporario para Bambu");
    var artifact = await orca.SliceAsync(executablePath, inputPath, outputPath, officialProfile);
    Check(orcaRunner.LastUseShellExecute == false && artifact.Format == "gcode", "processo Orca e iniciado sem shell e retorna G-code");
    Check(File.Exists(outputPath) && artifact.SizeBytes == new FileInfo(outputPath).Length && artifact.Sha256.Length == 64, "G-code novo e normalizado ao destino com SHA-256 calculado");
    Check(artifact.Profile.Id == "bambu-p1s-pla-basic" && artifact.Stdout == "slice complete", "resultado preserva perfil e diagnostico do Orca");

    foreach (var packageOutput in new[] { false, true })
    {
        var unsupportedOutput = Path.Combine(tempRoot, packageOutput ? "slice-unsupported-package" : "slice-unsupported-plain",
            packageOutput ? "unsupported.gcode.3mf" : "unsupported.gcode");
        var unsupportedRunner = new FakeOrcaProcessRunner(writeOutput: true, engineVersion: "2.5.0");
        var unsupportedRejected = false;
        try
        {
            await new OrcaSlicerService(unsupportedRunner).SliceAsync(executablePath, inputPath, unsupportedOutput,
                officialProfile, exportGcode3mf: packageOutput);
        }
        catch (InvalidDataException error) when (error.Message.Contains("exige o motor validado 2.4.2", StringComparison.Ordinal))
        {
            unsupportedRejected = true;
        }
        Check(unsupportedRejected && unsupportedRunner.InvocationCount == 1,
            packageOutput
                ? "Orca C# rejeita motor novo dentro do pacote gcode.3mf antes do upload"
                : "Orca C# rejeita motor novo em G-code simples antes do upload");
    }

    var binaryStlPath = Path.Combine(tempRoot, "model-binary.stl");
    var binaryStl = new byte[134];
    BinaryPrimitives.WriteUInt32LittleEndian(binaryStl.AsSpan(80, 4), 1);
    var binaryCoordinates = new[] { 0f, 0f, 0f, 10f, 0f, 0f, 0f, 20f, 0f };
    for (var index = 0; index < binaryCoordinates.Length; index++)
        BinaryPrimitives.WriteSingleLittleEndian(binaryStl.AsSpan(96 + index * 4, 4), binaryCoordinates[index]);
    await File.WriteAllBytesAsync(binaryStlPath, binaryStl);
    var binaryAnalysis = await OrcaModelAnalyzer.AnalyzeAsync(binaryStlPath);
    Check(binaryAnalysis.Format == "stl" && binaryAnalysis.Encoding == "binary" && binaryAnalysis.TriangleCount == 1 && binaryAnalysis.Bounds.Size.SequenceEqual([10d, 20d, 0d]), "analise C# calcula triangulos e limites de STL binario");

    var asciiStlPath = Path.Combine(tempRoot, "model-ascii.stl");
    await File.WriteAllTextAsync(asciiStlPath, "solid fixture\nfacet normal 0 0 1\nouter loop\nvertex -1.5 0 0\nvertex 2 0 0\nvertex -1.5 3.25 0\nendloop\nendfacet\nendsolid fixture\n");
    var asciiAnalysis = await OrcaModelAnalyzer.AnalyzeAsync(asciiStlPath);
    Check(asciiAnalysis.Encoding == "ascii" && asciiAnalysis.TriangleCount == 1 && asciiAnalysis.Bounds.Min.SequenceEqual([-1.5d, 0d, 0d]) && asciiAnalysis.Bounds.Size.SequenceEqual([3.5d, 3.25d, 0d]), "analise C# calcula limites de STL ASCII com coordenadas negativas e decimais");

    var threeMfPath = Path.Combine(tempRoot, "model-valid.3mf");
    await using (var threeMfFile = File.Create(threeMfPath))
    using (var threeMf = new ZipArchive(threeMfFile, ZipArchiveMode.Create))
    {
        var contentTypes = threeMf.CreateEntry("[Content_Types].xml");
        await using (var entry = contentTypes.Open())
            await entry.WriteAsync(Encoding.UTF8.GetBytes("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>"));
        var modelEntry = threeMf.CreateEntry("3D/3dmodel.model");
        await using (var entry = modelEntry.Open())
            await entry.WriteAsync(Encoding.UTF8.GetBytes("<model xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\"><resources><object id=\"1\" type=\"model\"><mesh><vertices><vertex x=\"0\" y=\"0\" z=\"0\"/><vertex x=\"4\" y=\"0\" z=\"0\"/><vertex x=\"0\" y=\"6\" z=\"0\"/></vertices><triangles><triangle v1=\"0\" v2=\"1\" v3=\"2\"/></triangles></mesh></object></resources></model>"));
    }
    var threeMfAnalysis = await OrcaModelAnalyzer.AnalyzeAsync(threeMfPath);
    Check(threeMfAnalysis.Format == "3mf" && threeMfAnalysis.Encoding == "zip" && threeMfAnalysis.Entries == 2 && threeMfAnalysis.TriangleCount == 1 && threeMfAnalysis.Bounds.Size.SequenceEqual([4d, 6d, 0d]), "analise C# abre o pacote 3MF e extrai geometria e quantidade de entradas");

    var invalidModelRejected = false;
    try { await OrcaModelAnalyzer.AnalyzeAsync(inputPath); }
    catch (InvalidDataException) { invalidModelRejected = true; }
    Check(invalidModelRejected, "analise C# rejeita arquivo 3MF sem assinatura e estrutura validas");

    var completeSlice = await orca.SliceModelAsync(executablePath, threeMfPath, Path.Combine(tempRoot, "slice-model", "out.gcode"), "Bambu Lab", "P1S");
    Check(completeSlice.Analysis.TriangleCount == 1 && completeSlice.Profile.Id == "bambu-p1s-pla-basic" && completeSlice.Artifact.Sha256.Length == 64, "pipeline C# local integra analise, perfil oficial, slicing e hash do artefato");
    Check(completeSlice.Metrics.EstimatedPrintSeconds == 3723 && completeSlice.Metrics.EstimatedFilamentGrams == 5.25 && completeSlice.Metrics.EstimatedFilamentMillimeters == 1234.5, "pipeline C# extrai tempo e consumo de filamento do G-code");
    var nativeOrcaMetrics = OrcaGcodeMetricsReader.Parse("; model printing time: 10m 48s; total estimated time: 16m 32s\n; filament used [mm] = 1326.58\n; filament used [cm3] = 3.19\n");
    Check(nativeOrcaMetrics.EstimatedPrintSeconds == 992 && nativeOrcaMetrics.EstimatedFilamentMillimeters == 1326.58 && nativeOrcaMetrics.EstimatedFilamentGrams is null, "parser reconhece cabeçalho Orca 2.4.2 e não inventa massa sem densidade");

    var productionFileBytes = await File.ReadAllBytesAsync(threeMfPath);
    var productionFileHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(productionFileBytes)).ToLowerInvariant();
    var productionFile = new AgentPrintFileDescriptor("tenant/storage key/42", productionFileHash, "3mf", productionFileBytes.LongLength, "fixture.3mf");
    var downloadCacheDirectory = Path.Combine(tempRoot, "print-file-cache");
    Directory.CreateDirectory(downloadCacheDirectory);
    const int partialOffset = 19;
    await File.WriteAllBytesAsync(Path.Combine(downloadCacheDirectory, $"{productionFileHash}.3mf.part"), productionFileBytes[..partialOffset]);
    var downloadHandler = new PrintFileCloudHandler(productionFileBytes);
    using (var downloadHttp = new HttpClient(downloadHandler))
    using (var downloadCloud = new AgentCloudClient(new Uri("https://api.fixture/"), downloadHttp))
    {
        var fileCache = new AgentPrintFileCache(downloadCloud, downloadCacheDirectory);
        var cachedFile = await fileCache.EnsureCachedAsync(credentials, "42", productionFile);
        Check(!cachedFile.Cached && cachedFile.SizeBytes == productionFileBytes.LongLength && downloadHandler.LastRangeStart == partialOffset,
            "cache C# retoma download autenticado do Production Job com Range");
        Check(downloadHandler.LastAgentId == credentials.AgentId && downloadHandler.LastAgentSecret == credentials.AgentSecret &&
            downloadHandler.LastDownloadQuery?.Contains("tenant%2Fstorage%20key%2F42", StringComparison.OrdinalIgnoreCase) == true &&
            System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(await File.ReadAllBytesAsync(cachedFile.LocalPath), productionFileBytes),
            "cache C# preserva cabeçalhos de credencial, codifica a chave e valida bytes pelo SHA-256");

        var pinPrinter = new PrinterPinMetadata(Protocol: "bambu", Name: "P1S de teste", Manufacturer: "Bambu Lab", Model: "P1S", Serial: "SERIAL-FIXTURE");
        await fileCache.PinAsync(cachedFile.LocalPath, "42", pinPrinter);
        var pinPath = cachedFile.LocalPath + ".pin";
        var pinnedCleanup = await fileCache.CleanupAsync(DateTimeOffset.UtcNow.AddDays(30));
        Check(File.Exists(pinPath) && File.Exists(cachedFile.LocalPath) && pinnedCleanup.Removed == 0 &&
            !(await File.ReadAllTextAsync(pinPath)).Contains("accessCode", StringComparison.OrdinalIgnoreCase),
            "cache C# mantém arquivo fixado e marcador não inclui credencial da impressora");
        var activePinRecovery = await fileCache.RecoverStalePinsAsync(["42"], false,
            (_, _, _) => Task.FromResult(true), DateTimeOffset.UtcNow.AddDays(30));
        var activePrintRecovery = await fileCache.RecoverStalePinsAsync([], true,
            (_, _, _) => Task.FromResult(true), DateTimeOffset.UtcNow.AddDays(30));
        Check(activePinRecovery is { Released: 0, Retained: 1 } && activePrintRecovery is { Released: 0, Retained: 0 } && File.Exists(pinPath),
            "cache C# preserva pins de jobs ativos e não tenta recuperar durante impressão");
        var wrongJobUnpins = await fileCache.UnpinByPrintJobIdAsync("different-job");
        var releasedJobPins = await fileCache.UnpinByPrintJobIdAsync("42");
        Check(wrongJobUnpins == 0 && releasedJobPins == 1, "cache C# só libera pins associados ao Production Job informado");
        await fileCache.PinAsync(cachedFile.LocalPath, "stale-job", pinPrinter);
        var recoveredIdlePin = await fileCache.RecoverStalePinsAsync([], false,
            (_, _, _) => Task.FromResult(true), DateTimeOffset.UtcNow.AddDays(30));
        Check(recoveredIdlePin is { Released: 1, Retained: 0 } && !File.Exists(pinPath),
            "cache C# recupera pin expirado só após confirmar que a impressora está ociosa");
        await fileCache.CleanupAsync(DateTimeOffset.UtcNow.AddDays(30));
        Check(!File.Exists(pinPath) && !File.Exists(cachedFile.LocalPath), "cache C# libera pin e expira arquivo não utilizado");
    }

    var slicingHandler = new PrintFileCloudHandler(productionFileBytes);
    using (var slicingHttp = new HttpClient(slicingHandler))
    using (var slicingCloud = new AgentCloudClient(new Uri("https://api.fixture/"), slicingHttp))
    {
        var slicingCacheDirectory = Path.Combine(tempRoot, "production-slicing-cache");
        var slicingCache = new AgentPrintFileCache(slicingCloud, slicingCacheDirectory);
        var pinnedRunner = new FakeOrcaProcessRunner(writeOutput: true) { RequirePinnedInput = true };
        var environment = new Dictionary<string, string?> { ["FILA_AGENT_ORCA_SLICER_PATH"] = executablePath };
        var productionSlicer = new ProductionJobSlicingService(slicingCloud, slicingCache, new OrcaSlicerService(pinnedRunner), environment);
        var productionRequest = new ProductionJobSlicingRequest("77", productionFile with { StorageKey = "storage/job/77" },
            new PrinterPinMetadata(Protocol: "bambu", Name: "P1S de teste", Manufacturer: "Bambu Lab", Model: "P1S", Ip: "192.0.2.1", Serial: "SERIAL-FIXTURE"));
        var productionResult = await productionSlicer.PrepareAsync(credentials, productionRequest);
        var sourcePath = Path.Combine(slicingCacheDirectory, $"{productionFileHash}.3mf");
        Check(productionResult.Success && productionResult.Profile.Id == "bambu-p1s-pla-basic" &&
            productionResult.Artifact.GetProperty("storageKey").GetString() == "gcode/fixture",
            "Production Job C# integra download, slicing e resposta do upload autenticado");
        Check(pinnedRunner.SourceWasPinnedDuringSlice && !File.Exists(sourcePath + ".pin") && File.Exists(sourcePath) &&
            pinnedRunner.LastOutputDirectory is not null && !Directory.Exists(pinnedRunner.LastOutputDirectory),
            "Production Job C# mantém pin durante o slicing e libera pin e diretório temporário ao concluir");
        Check(slicingHandler.UploadCount == 1 && slicingHandler.LastAgentId == credentials.AgentId &&
            slicingHandler.LastIdempotencyKey == $"slice-77-{pinnedRunner.LastOutputSha256}" &&
            slicingHandler.LastUploadBytes?.Length > 0 && slicingHandler.LastProfileId == "bambu-p1s-pla-basic",
            "Production Job C# envia G-code, perfil e chave idempotente compatíveis com o backend");
        using var uploadedPackageStream = new MemoryStream(slicingHandler.LastUploadBytes!);
        using var uploadedPackage = new ZipArchive(uploadedPackageStream, ZipArchiveMode.Read);
        var packagedPlate = uploadedPackage.GetEntry("Metadata/plate_1.gcode");
        using var packagedPlateReader = new StreamReader(packagedPlate?.Open() ?? throw new InvalidDataException("G-code de placa ausente no pacote Bambu."));
        var packagedPlateText = await packagedPlateReader.ReadToEndAsync();
        Check(slicingHandler.LastFileFormat == "gcode" && slicingHandler.LastFileName?.EndsWith(".gcode.3mf", StringComparison.OrdinalIgnoreCase) == true &&
            packagedPlateText.Contains("G28", StringComparison.Ordinal) && productionResult.Metrics.EstimatedPrintSeconds == 3723,
            "Production Job Bambu envia pacote gcode.3mf valido no campo gcode atual e le metricas do G-code interno");
    }

    var incompatibleSlicingHandler = new PrintFileCloudHandler(productionFileBytes);
    using (var incompatibleSlicingHttp = new HttpClient(incompatibleSlicingHandler))
    using (var incompatibleSlicingCloud = new AgentCloudClient(new Uri("https://api.fixture/"), incompatibleSlicingHttp))
    {
        var incompatibleCache = new AgentPrintFileCache(incompatibleSlicingCloud, Path.Combine(tempRoot, "incompatible-orca-cache"));
        var incompatibleRunner = new FakeOrcaProcessRunner(writeOutput: true, engineVersion: "2.5.0");
        var incompatibleService = new ProductionJobSlicingService(incompatibleSlicingCloud, incompatibleCache,
            new OrcaSlicerService(incompatibleRunner), new Dictionary<string, string?> { ["FILA_AGENT_ORCA_SLICER_PATH"] = executablePath });
        var rejected = false;
        try
        {
            await incompatibleService.PrepareAsync(credentials,
                new ProductionJobSlicingRequest("unsupported-engine-job", productionFile,
                    new PrinterPinMetadata(Protocol: "bambu", Name: "P1S", Manufacturer: "Bambu Lab", Model: "P1S", Serial: "SERIAL-FIXTURE")));
        }
        catch (InvalidDataException error) when (error.Message.Contains("exige o motor validado 2.4.2", StringComparison.Ordinal))
        {
            rejected = true;
        }
        Check(rejected && incompatibleSlicingHandler.UploadCount == 0 && incompatibleRunner.LastOutputDirectory is not null &&
            !Directory.Exists(incompatibleRunner.LastOutputDirectory),
            "Production Job C# não envia à API artefato gerado por motor Orca não validado e limpa temporários");
    }

    var commandSlicingHandler = new PrintFileCloudHandler(productionFileBytes) { FailCommandCompletions = true };
    using (var commandSlicingHttp = new HttpClient(commandSlicingHandler))
    using (var commandSlicingCloud = new AgentCloudClient(new Uri("https://api.fixture/"), commandSlicingHttp))
    using (var commandOperations = new AgentLocalOperationsStore(Path.Combine(tempRoot, "slice-command-operations.sqlite")))
    {
        var commandCacheDirectory = Path.Combine(tempRoot, "slice-command-cache");
        var commandCache = new AgentPrintFileCache(commandSlicingCloud, commandCacheDirectory);
        var commandRunner = new FakeOrcaProcessRunner(writeOutput: true);
        var commandSlicer = new ProductionJobSlicingService(commandSlicingCloud, commandCache,
            new OrcaSlicerService(commandRunner), new Dictionary<string, string?> { ["FILA_AGENT_ORCA_SLICER_PATH"] = executablePath });
        var commandDispatcher = new ProductionJobSlicingCommandHandler(commandSlicingCloud, commandOperations, commandSlicer);
        var pendingProductionJob = JsonSerializer.SerializeToElement(new
        {
            command = new
            {
                id = "slice-command-77",
                type = "slice_print_job",
                payload = new
                {
                    printer = new
                    {
                        protocol = "bambu", name = "P1S de teste", manufacturer = "Bambu Lab", model = "P1S",
                        ip = "192.0.2.1", serial = "SERIAL-FIXTURE", accessCode = "must-not-be-persisted"
                    },
                    job = new
                    {
                        id = 77,
                        printFile = new
                        {
                            storageKey = "storage/job/77", hash = productionFileHash, format = "3mf",
                            sizeBytes = productionFileBytes.LongLength, name = "fixture.3mf"
                        }
                    }
                }
            }
        });

        var commandResult = await commandDispatcher.TryDispatchPendingAsync(credentials, pendingProductionJob);
        Check(commandResult is { Handled: true, Status: "completed" } &&
            commandResult.Result?.GetProperty("success").GetBoolean() == true && commandRunner.InvocationCount == 1,
            "dispatcher C# interpreta comando slice_print_job e executa download, Orca e upload uma vez");
        Check(commandOperations.ListPendingCompletions().Single().CommandId == "slice-command-77" &&
            commandSlicingHandler.CompletionCount == 1 && commandSlicingHandler.LastCompletionSuccess == true,
            "resultado do comando fica na outbox local quando a conclusao da API falha");
        Check(!commandOperations.ListPendingCompletions().Single().Result.GetRawText().Contains("must-not-be-persisted", StringComparison.Ordinal) &&
            commandSlicingHandler.LastCompletionBody?.Contains("must-not-be-persisted", StringComparison.Ordinal) != true,
            "segredo da impressora nao entra no resultado persistido nem na conclusao enviada");

        commandSlicingHandler.FailCommandCompletions = false;
        var completionAttempts = await commandDispatcher.FlushPendingCompletionsAsync(credentials);
        Check(completionAttempts == 1 && commandRunner.InvocationCount == 1 && commandSlicingHandler.UploadCount == 1 &&
            commandSlicingHandler.CompletionCount == 2 && commandOperations.ListPendingCompletions().Count == 0,
            "ciclo de retry da outbox entrega conclusao apos a API voltar sem repetir slicing ou upload");

        var duplicateResult = await commandDispatcher.TryDispatchPendingAsync(credentials, pendingProductionJob);
        Check(duplicateResult.Status == "completed" && commandRunner.InvocationCount == 1 &&
            commandSlicingHandler.UploadCount == 1 && commandSlicingHandler.CompletionCount == 2,
            "comando duplicado devolve resultado local sem repetir slicing ou upload");

        var unrelatedCommand = JsonSerializer.SerializeToElement(new { command = new { id = "status-1", type = "printer_status" } });
        var notHandled = await commandDispatcher.TryDispatchPendingAsync(credentials, unrelatedCommand);
        Check(!notHandled.Handled && commandOperations.ListPendingCompletions().Count == 0,
            "dispatcher de slicing nao consome comandos de outros tipos");
    }

    var rejectingRunner = new FakeOrcaProcessRunner(writeOutput: true);
    var tamperedProfileRejected = false;
    try { await new OrcaSlicerService(rejectingRunner).SliceAsync(executablePath, inputPath, Path.Combine(tempRoot, "hash-check", "out.gcode"), officialProfile with { Sha256 = new string('0', 64) }); }
    catch (InvalidDataException) { tamperedProfileRejected = true; }
    Check(tamperedProfileRejected && rejectingRunner.InvocationCount == 0, "hash divergente interrompe antes de executar OrcaSlicer");

    var emptyRunner = new FakeOrcaProcessRunner(writeOutput: false);
    var missingArtifactRejected = false;
    try { await new OrcaSlicerService(emptyRunner).SliceAsync(executablePath, inputPath, Path.Combine(tempRoot, "empty", "out.gcode"), officialProfile); }
    catch (InvalidDataException) { missingArtifactRejected = true; }
    Check(missingArtifactRejected, "fatiamento com exit zero sem arquivo G-code e rejeitado");

    var serialCatalog = new FakeSerialPortCatalog([
        new SerialPortCandidate("COM3", "Impressora USB", "Maker", "USB Serial", "USB\\VID_1234"),
        new SerialPortCandidate("COM7", "Outro dispositivo")
    ]);
    var marlinProbe = new FakeMarlinFirmwareProbe((port, baud) =>
        port == "COM3" && baud == 250000 ? "FIRMWARE_NAME:Marlin 2.1.2" : null);
    var usbDiscovery = new UsbDiscoveryService(serialCatalog, marlinProbe);
    var discoveredUsb = await usbDiscovery.ScanAsync();
    Check(marlinProbe.Attempts.Select(attempt => attempt.BaudRate).SequenceEqual([115200, 250000, 115200, 250000]), "USB testa Marlin nas baud rates atuais e segue para cada porta");
    Check(discoveredUsb.Count == 1 && discoveredUsb[0].Port == "COM3" && discoveredUsb[0].BaudRate == 250000, "USB identifica Marlin por resposta de firmware e para na primeira baud rate válida");
    Check(discoveredUsb[0].Firmware.Contains("Marlin", StringComparison.Ordinal) && discoveredUsb[0].PnpDeviceId == "USB\\VID_1234" && !discoveredUsb[0].RequiresCredentials, "resultado USB preserva metadados disponíveis e não exige credenciais");

    var canceledDiscovery = new CancellationTokenSource();
    canceledDiscovery.Cancel();
    var usbCancellationObserved = false;
    try { await usbDiscovery.ScanAsync(cancellationToken: canceledDiscovery.Token); }
    catch (OperationCanceledException) { usbCancellationObserved = true; }
    Check(usbCancellationObserved, "descoberta USB respeita cancelamento antes de enumerar portas");

    var ssdpCandidate = BambuSsdpDiscoveryService.ParseResponse(
        "HTTP/1.1 200 OK\r\nSERVER: Bambu Lab P1S\r\n\r\n<device><serialNumber>01P00A123456789</serialNumber><model>P1S</model></device>",
        "192.168.1.51");
    var parsedCandidate = ssdpCandidate ?? throw new InvalidOperationException("Candidato Bambu esperado no fixture SSDP.");
    Check(parsedCandidate.Serial == "01P00A123456789" && parsedCandidate.Model == "P1S" && parsedCandidate.Ip == "192.168.1.51", "SSDP C# reconhece Bambu e extrai serial e modelo do XML");
    Check(parsedCandidate.RequiredCredentials.SequenceEqual(["serial", "accessCode"]) && parsedCandidate.RequiresCredentials, "candidato Bambu mantém accessCode como segredo obrigatório informado pelo cliente");
    Check(BambuSsdpDiscoveryService.ParseResponse("HTTP/1.1 200 OK\r\nSERVER: Generic Device\r\n", "192.168.1.52") is null, "SSDP ignora dispositivos sem fingerprint Bambu");
    var headerCandidate = BambuSsdpDiscoveryService.ParseResponse("HTTP/1.1 200 OK\r\nServer: Bambu Lab A1\r\nSerial: A1SERIAL\r\nModel: A1\r\n", "192.168.1.53");
    var parsedHeaderCandidate = headerCandidate ?? throw new InvalidOperationException("Candidato Bambu esperado nos cabeçalhos SSDP.");
    Check(parsedHeaderCandidate.Serial == "A1SERIAL" && parsedHeaderCandidate.Model == "A1", "SSDP C# também extrai serial e modelo de cabeçalhos sem diferenciar caixa");

    var lanRange = NetworkDiscoveryService.GetHostRange("192.168.2.19", "255.255.255.0");
    Check(lanRange is { Start: "192.168.2.1", End: "192.168.2.254", Truncated: false, TotalHosts: 254 }, "scanner C# calcula hosts IPv4 sem incluir rede ou broadcast");
    var boundedRange = NetworkDiscoveryService.GetHostRange("10.0.4.8", "255.255.0.0", 4);
    Check(boundedRange is { Start: "10.0.0.1", End: "10.0.0.4", Truncated: true, TotalHosts: 65534 }, "scanner C# limita sub-redes grandes ao mesmo máximo configurável");
    Check(NetworkDiscoveryService.GetHostRange("192.168.1.2", "255.255.255.255") is null, "scanner C# ignora redes sem hosts disponíveis");

    var moonrakerProbe = new FakePrinterPortConnectProbe(new HashSet<int> { 7125 });
    using var moonrakerHttp = new HttpClient(new PrinterDiscoveryHttpHandler(request =>
        request.RequestUri?.AbsolutePath == "/server/info"
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"result\":{\"hostname\":\"Klipper-Lab\"}}") }
            : new HttpResponseMessage(HttpStatusCode.NotFound)));
    using var networkScanner = new NetworkDiscoveryService(moonrakerProbe, moonrakerHttp,
        _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([]));
    var moonrakerCandidate = await networkScanner.IdentifyPrinterAsync("192.168.2.2");
    Check(moonrakerCandidate is { Protocol: "moonraker", Name: "Klipper-Lab", Port: 7125, RequiresCredentials: false }, "HTTP fallback detecta Moonraker e preserva hostname e perfil sem segredo");

    var octoProbe = new FakePrinterPortConnectProbe(new HashSet<int> { 80 });
    using var octoHttp = new HttpClient(new PrinterDiscoveryHttpHandler(request =>
    {
        if (request.RequestUri?.AbsolutePath == "/server/info") return new HttpResponseMessage(HttpStatusCode.NotFound);
        var response = new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("{}") };
        response.Headers.Server.ParseAdd("OctoPrint");
        return response;
    }));
    using var octoScanner = new NetworkDiscoveryService(octoProbe, octoHttp,
        _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([]));
    var octoCandidate = await octoScanner.IdentifyPrinterAsync("192.168.2.3");
    Check(octoCandidate is { Protocol: "octoprint", RequiresCredentials: true } && octoCandidate.RequiredCredentials.SequenceEqual(["apiKey"]), "detecção OctoPrint aceita 401 com fingerprint de servidor e exige API Key");

    var prusaProbe = new FakePrinterPortConnectProbe(new HashSet<int> { 5000 });
    using var prusaHttp = new HttpClient(new PrinterDiscoveryHttpHandler(request =>
        request.RequestUri?.AbsolutePath == "/server/info"
            ? new HttpResponseMessage(HttpStatusCode.NotFound)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"server\":\"PrusaLink\"}") }));
    using var prusaScanner = new NetworkDiscoveryService(prusaProbe, prusaHttp,
        _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([]));
    var prusaCandidate = await prusaScanner.IdentifyPrinterAsync("192.168.2.4");
    Check(prusaCandidate is { Protocol: "prusalink", Manufacturer: "Prusa", RequiresCredentials: true } && prusaCandidate.RequiredCredentials.SequenceEqual(["username", "password"]), "detecção PrusaLink mantém fabricante e campos de credencial atuais");

    var bambuProbe = new FakePrinterPortConnectProbe(new HashSet<int> { 8883 });
    using var unusedHttp = new HttpClient(new PrinterDiscoveryHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound)));
    using var bambuScanner = new NetworkDiscoveryService(bambuProbe, unusedHttp,
        _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([]));
    var bambuCandidate = await bambuScanner.IdentifyPrinterAsync("192.168.2.5");
    Check(bambuCandidate is { Protocol: "bambu", Port: 8883, RequiresCredentials: true } && bambuCandidate.RequiredCredentials.SequenceEqual(["serial", "accessCode"]), "fallback de porta identifica Bambu sem inventar nem descobrir o LAN Access Code");

    var subnetProbe = new FakePrinterPortConnectProbe(new HashSet<int> { 7125 }, host => host == "192.168.2.2");
    using var subnetHttp = new HttpClient(new PrinterDiscoveryHttpHandler(request =>
        request.RequestUri?.AbsolutePath == "/server/info"
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"result\":{\"hostname\":\"Klipper-Test\"}}") }
            : new HttpResponseMessage(HttpStatusCode.NotFound)));
    using var subnetScanner = new NetworkDiscoveryService(subnetProbe, subnetHttp,
        _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([]));
    var discoveredOnLan = await subnetScanner.ScanAsync([new LocalIpv4Network("fixture", "192.168.2.1", "255.255.255.252")]);
    Check(discoveredOnLan.Printers.Single().Ip == "192.168.2.2" && subnetProbe.Attempts.All(attempt => attempt.Host != "192.168.2.1"), "scan em lotes ignora o próprio PC e descobre impressora na sub-rede fixture");

    using var mockScanner = new NetworkDiscoveryService(new FakePrinterPortConnectProbe(new HashSet<int>()), new HttpClient(new PrinterDiscoveryHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))),
        _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([]));
    var mockResult = await mockScanner.ScanAsync([], environment: new Dictionary<string, string?>
    {
        ["FILA_AGENT_ENVIRONMENT"] = "DEVELOPMENT",
        ["FILA_AGENT_DEV_MOCK_BAMBU"] = "true"
    });
    Check(mockResult.Printers.Single() is { Mock: true, Ip: "192.168.2.250", RequiresCredentials: false }, "mock Bambu só entra quando DEVELOPMENT e variável nova de mock estão habilitados");

    var bambuUploadEvents = new List<string>();
    var bambuMqttFactory = new FakeBambuMqttClientFactory(events: bambuUploadEvents);
    var bambuUploader = new FakeBambuFtpsUploader(bambuUploadEvents);
    var bambuAdapter = new BambuPrinterAdapterService(bambuMqttFactory, bambuUploader,
        new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION" });
    var bambuDescriptor = new BambuPrinterDescriptor("192.168.2.50", "PFTESTP1S0001", Name: "P1S fixture", BambuRemoteDirectory: "/cache");
    var bambuConnection = await bambuAdapter.ConnectAsync(bambuDescriptor, "LAN-SECRET-FIXTURE");
    var bambuMqtt = bambuMqttFactory.Clients.Single();
    Check(bambuMqtt.Options is { Ip: "192.168.2.50", Port: 8883, Serial: "PFTESTP1S0001", AccessCode: "LAN-SECRET-FIXTURE", KeepAlive: var keepAlive } && keepAlive == TimeSpan.FromSeconds(60) && bambuMqtt.IsConnected,
        "Bambu C# autentica MQTT com IP, porta, serial, LAN Access Code e keepalive atuais");
    Check(bambuMqtt.Subscriptions.SequenceEqual([("device/PFTESTP1S0001/report", 0)]) && bambuMqtt.Options!.ClientId.StartsWith("fila-agent-", StringComparison.Ordinal),
        "Bambu C# assina o tópico report em QoS 0 e usa client ID da nova marca");
    var bambuStatus = await bambuAdapter.GetStatusAsync(bambuConnection);
    Check(bambuMqtt.Published[^1] is { Topic: "device/PFTESTP1S0001/request", Qos: 0 } && bambuMqtt.Published[^1].Payload.Contains("\"pushall\"", StringComparison.Ordinal),
        "Bambu C# solicita pushall no tópico request em QoS 0");
    Check(bambuStatus is { Connected: true, Protocol: "bambu", State: "RUNNING", Progress: 34, RemainingMinutes: 18, ActualPrintSeconds: 72, ActualFilamentGrams: 4.2, ActualFilamentMillimeters: 1340, CurrentLayer: 12, TotalLayers: 90, NozzleTemperature: 211, NozzleTargetTemperature: 220, BedTemperature: 61, BedTargetTemperature: 65, File: "fixture.3mf" } && bambuConnection.LastStatus == bambuStatus,
        "Bambu C# normaliza status, métricas e temperaturas e mantém o último evento de telemetria");
    await bambuAdapter.PauseAsync(bambuConnection);
    await bambuAdapter.ResumeAsync(bambuConnection);
    await bambuAdapter.CancelAsync(bambuConnection);
    var bambuControlPayloads = bambuMqtt.Published.TakeLast(3).Select(message => JsonDocument.Parse(message.Payload).RootElement.GetProperty("print").GetProperty("command").GetString()).ToArray();
    Check(bambuControlPayloads.SequenceEqual(["pause", "resume", "stop"]) && bambuMqtt.Published.TakeLast(3).All(message => message.Qos == 1),
        "Bambu C# preserva pause/resume/stop com QoS 1");

    var bambuFilePath = Path.Combine(tempRoot, "peca teste.3mf");
    await File.WriteAllTextAsync(bambuFilePath, "fixture 3mf");
    using var bambuProfileDocument = JsonDocument.Parse("{\"plateIndex\":2,\"useAms\":false,\"ams_mapping\":[{\"ams\":0,\"tray\":1}],\"timelapse\":true,\"flowCalibration\":false,\"bedLeveling\":true,\"layerInspect\":false,\"vibrationCalibration\":true}");
    bambuUploadEvents.Clear();
    var bambuPrint = await bambuAdapter.StartPrintAsync(bambuConnection, new BambuPrintJob(
        new BambuPrintFile(bambuFilePath, "peça teste.3mf", "3mf"),
        Title: "Peça de teste",
        PrintProfile: bambuProfileDocument.RootElement));
    var bambuProjectMessage = JsonDocument.Parse(bambuMqtt.Published[^1].Payload);
    var bambuPrintPayload = bambuProjectMessage.RootElement.GetProperty("print");
    var bambuUpload = bambuUploader.Uploads.Single();
    Check(bambuUpload is { Ip: "192.168.2.50", Serial: "PFTESTP1S0001", Port: 990, AccessCode: "LAN-SECRET-FIXTURE", LocalPath: var uploadedPath, RemotePath: "/cache/pe_a_teste.gcode.3mf" } && uploadedPath == Path.GetFullPath(bambuFilePath) && bambuUploadEvents.SequenceEqual(["upload", "publish"]),
        "Bambu C# valida a identidade serial também no FTPS antes de iniciar impressão");
    Check(bambuPrint is { Success: true, Started: true, Uploaded: true, Command: "project_file", RemotePath: "/cache/pe_a_teste.gcode.3mf" } && bambuPrintPayload.GetProperty("url").GetString() == "ftp:///cache/pe_a_teste.gcode.3mf" && bambuPrintPayload.GetProperty("param").GetString() == "Metadata/plate_2.gcode" && bambuPrintPayload.GetProperty("subtask_name").GetString() == "Peça de teste",
        "Bambu C# conserva o payload project_file, plate e nome da tarefa atuais");
    Check(!bambuPrintPayload.GetProperty("use_ams").GetBoolean() && bambuPrintPayload.GetProperty("ams_mapping").GetArrayLength() == 1 && bambuPrintPayload.GetProperty("timelapse").GetBoolean() && !bambuPrintPayload.GetProperty("flow_cali").GetBoolean() && bambuPrintPayload.GetProperty("bed_leveling").GetBoolean() && !bambuPrintPayload.GetProperty("layer_inspect").GetBoolean() && bambuPrintPayload.GetProperty("vibration_cali").GetBoolean() && !bambuProjectMessage.RootElement.GetRawText().Contains("LAN-SECRET-FIXTURE", StringComparison.Ordinal),
        "Bambu C# mantém opções de AMS/calibração e nunca envia o Access Code no payload MQTT");
    await bambuAdapter.DisconnectAsync(bambuConnection);
    Check(!bambuConnection.Connected && !bambuMqtt.IsConnected && bambuMqtt.Disposed,
        "Bambu C# remove o listener e fecha a sessão MQTT ao desconectar");

    var bambuFailureFactory = new FakeBambuMqttClientFactory(connectError: new IOException("connection failed with secret LAN-SECRET-FAIL"));
    var bambuFailureAdapter = new BambuPrinterAdapterService(bambuFailureFactory, bambuUploader,
        new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION" });
    var bambuFailureMessage = string.Empty;
    try { await bambuFailureAdapter.ConnectAsync(bambuDescriptor, "LAN-SECRET-FAIL"); }
    catch (InvalidOperationException error) { bambuFailureMessage = error.Message; }
    Check(bambuFailureFactory.Clients.Single().Disposed && bambuFailureMessage.Contains("***", StringComparison.Ordinal) && !bambuFailureMessage.Contains("LAN-SECRET-FAIL", StringComparison.Ordinal),
        "falha de autenticação Bambu fecha MQTT e remove o Access Code da mensagem de erro");

    var mockBambuAdapter = new BambuPrinterAdapterService(new FakeBambuMqttClientFactory(), bambuUploader,
        new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "DEVELOPMENT", ["FILA_AGENT_DEV_MOCK_BAMBU"] = "true" });
    var mockBambuConnection = await mockBambuAdapter.ConnectAsync(bambuDescriptor with { Mock = true }, "MOCK-ONLY-SECRET");
    await mockBambuAdapter.PauseAsync(mockBambuConnection);
    Check(mockBambuConnection.Mock && mockBambuConnection.LastStatus is null && (await mockBambuAdapter.GetStatusAsync(mockBambuConnection)).State == "PAUSE",
        "mock Bambu só substitui MQTT quando ambiente e flag de desenvolvimento estão habilitados");

    var reconnectDirectory = Path.Combine(tempRoot, "printer-reconnect");
    using var reconnectCredentialStore = new AgentPrinterCredentialStore(reconnectDirectory, protector, credentialUser);
    var reconnectPrinter = new PrinterCredentialIdentity("bambu", "192.0.2.40", 8883, "RECONNECT-SERIAL");
    await reconnectCredentialStore.SaveAsync(reconnectPrinter,
        new Dictionary<string, string?> { ["accessCode"] = "RECONNECT-LAN-CODE", ["serial"] = "RECONNECT-SERIAL" });
    var reconnectApiHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/agents/printers/reconnect" => JsonResponse("{\"printers\":[{\"id\":\"printer-9\",\"protocol\":\"bambu\",\"connectionType\":\"network\",\"name\":\"P1S fixture\",\"manufacturer\":\"Bambu Lab\",\"model\":\"P1S\",\"serial\":\"RECONNECT-SERIAL\",\"ip\":\"192.0.2.40\",\"port\":8883}] }"),
        _ => JsonResponse("{}")
    });
    using (var reconnectHttp = new HttpClient(reconnectApiHandler))
    using (var reconnectCloud = new AgentCloudClient(new Uri("https://api.fixture/"), reconnectHttp))
    {
        var reconnectMqttFactory = new FakeBambuMqttClientFactory();
        var reconnectBambuAdapter = new BambuPrinterAdapterService(reconnectMqttFactory, bambuUploader,
            new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION" });
        await using (var connectionManager = new AgentPrinterConnectionManager(reconnectCloud, reconnectCredentialStore, bambu: reconnectBambuAdapter))
        {
            var restored = await connectionManager.RestoreRegisteredPrintersAsync(credentials);
            var mqttSession = reconnectMqttFactory.Clients.Single();
            Check(restored is { Requested: 1, Connected: 1 } && connectionManager.ActiveConnectionCount == 1 &&
                mqttSession.Options?.AccessCode == "RECONNECT-LAN-CODE" && reconnectApiHandler.Requests.Single().GetHeader("x-agent-secret") == credentials.AgentSecret,
                "runtime C# restaura impressora registrada e usa Access Code local cifrado, sem recebê-lo da API");

            using var reconnectPrinterJson = JsonDocument.Parse("{\"protocol\":\"bambu\",\"connectionType\":\"network\",\"serial\":\"RECONNECT-SERIAL\",\"ip\":\"192.0.2.40\",\"port\":8883}");
            var reused = await connectionManager.ConnectAsync(credentials, AgentPrinterDescriptor.FromJson(reconnectPrinterJson.RootElement));
            Check(reused.Reused && reconnectMqttFactory.Clients.Count == 1,
                "conexao C# ativa por serial e reutilizada sem abrir uma segunda sessao MQTT");
            Check(await connectionManager.DisconnectAsync(AgentPrinterDescriptor.FromJson(reconnectPrinterJson.RootElement)) &&
                connectionManager.ActiveConnectionCount == 0 && mqttSession.Disposed,
                "runtime C# fecha a sessao MQTT restaurada ao desconectar");
        }

        await reconnectCredentialStore.ClearAsync(reconnectPrinter);
        var noCredentialFactory = new FakeBambuMqttClientFactory();
        var noCredentialAdapter = new BambuPrinterAdapterService(noCredentialFactory, bambuUploader,
            new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION" });
        await using var noCredentialManager = new AgentPrinterConnectionManager(reconnectCloud, reconnectCredentialStore, bambu: noCredentialAdapter);
        var withoutCode = await noCredentialManager.RestoreRegisteredPrintersAsync(credentials);
        Check(withoutCode is { Requested: 1, Connected: 0 } && noCredentialFactory.Clients.Count == 0 &&
            withoutCode.Outcomes.Single().Error?.Contains("Access Code", StringComparison.OrdinalIgnoreCase) == true,
            "reconexao Bambu sem segredo salvo falha com clareza e nao tenta descobrir nem adivinhar o LAN Access Code");
    }

    var marlinFactory = new FakeMarlinSerialChannelFactory();
    var marlin = new MarlinSerialAdapterService(marlinFactory, startupDelay: TimeSpan.Zero,
        commandTimeout: TimeSpan.FromSeconds(1), printLineTimeout: TimeSpan.FromSeconds(1), pausePollInterval: TimeSpan.FromMilliseconds(5));
    var marlinConnection = await marlin.ConnectAsync(new MarlinPrinterDescriptor("COM9", 250000, "Ender de teste", "Maker"));
    Check(marlinConnection.Firmware.Contains("Marlin 2.1.2", StringComparison.Ordinal) && marlinFactory.Channels[0].Commands.SequenceEqual(["M115"]), "Marlin C# conecta na baud rate configurada e consulta firmware com M115");
    var marlinStatus = await marlin.GetStatusAsync(marlinConnection);
    Check(marlinStatus.State == "CONNECTED" && marlinStatus.NozzleTemperature == 210 && marlinStatus.NozzleTargetTemperature == 220 && marlinStatus.BedTemperature == 60 && marlinStatus.BedTargetTemperature == 65, "Marlin C# consulta e normaliza temperaturas por M105");
    Check(marlinStatus.X == 1 && marlinStatus.Y == 2 && marlinStatus.Z == 3 && marlinStatus.Lines.Any(line => line.Contains("X:1", StringComparison.Ordinal)), "Marlin C# lê posição por M114 e mantém linhas de diagnóstico");

    var marlinGcodePath = Path.Combine(tempRoot, "marlin-test.gcode");
    await File.WriteAllTextAsync(marlinGcodePath, "; comment only\nG28 ; home\n\n  M104 S210  \nM140 S60\n");
    var marlinStart = await marlin.StartPrintAsync(marlinConnection, marlinGcodePath);
    var marlinChannel = marlinFactory.Channels[0];
    await marlinChannel.FirstPrintCommandStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
    await marlin.PauseAsync(marlinConnection);
    marlinChannel.ReleaseFirstPrintCommand();
    await Task.Delay(40);
    Check(marlinStart is { Started: true, Background: true, TotalCommands: 3 } && !marlinChannel.Commands.Contains("M104 S210"), "Marlin C# filtra comentários, começa em background e segura o G-code enquanto pausado");
    await marlin.ResumeAsync(marlinConnection);
    await marlinConnection.ActivePrintCompletion!.WaitAsync(TimeSpan.FromSeconds(2));
    var completedMarlin = await marlin.GetStatusAsync(marlinConnection);
    var streamedCommands = marlinChannel.Commands.Where(command => command is "G28" or "M104 S210" or "M140 S60").ToArray();
    Check(completedMarlin.ActivePrint is { Status: "completed", Progress: 100, SentCommands: 3 } && streamedCommands.SequenceEqual(["G28", "M104 S210", "M140 S60"]), "Marlin C# retoma o streaming, confirma cada comando e conclui com progresso integral");
    await marlin.PauseAsync(marlinConnection);
    await marlin.ResumeAsync(marlinConnection);
    await marlin.CancelAsync(marlinConnection);
    Check(marlinChannel.Commands.TakeLast(3).SequenceEqual(["M25", "M24", "M524"]), "Marlin C# usa M25/M24/M524 quando não há streaming local ativo");

    var invalidMarlinFile = Path.Combine(tempRoot, "not-gcode.3mf");
    await File.WriteAllTextAsync(invalidMarlinFile, "fixture");
    var invalidMarlinFormatRejected = false;
    try { await marlin.StartPrintAsync(marlinConnection, invalidMarlinFile); }
    catch (InvalidOperationException) { invalidMarlinFormatRejected = true; }
    Check(invalidMarlinFormatRejected, "Marlin C# rejeita entrada 3MF sem G-code fatiado");

    var cancelConnection = await marlin.ConnectAsync(new MarlinPrinterDescriptor("COM10"));
    var cancelChannel = marlinFactory.Channels[1];
    await marlin.StartPrintAsync(cancelConnection, marlinGcodePath);
    await cancelChannel.FirstPrintCommandStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
    var marlinCancel = await marlin.CancelAsync(cancelConnection);
    cancelChannel.ReleaseFirstPrintCommand();
    await cancelConnection.ActivePrintCompletion!.WaitAsync(TimeSpan.FromSeconds(2));
    var cancelledMarlin = await marlin.GetStatusAsync(cancelConnection);
    Check(marlinCancel.Cancelled && cancelChannel.RawCommands.Contains("M410") && cancelledMarlin.ActivePrint?.Status == "cancelled" && !cancelChannel.Commands.Contains("M104 S210"), "Marlin C# interrompe streaming ativo com parada rápida M410");
    await marlin.DisconnectAsync(marlinConnection);
    await marlin.DisconnectAsync(cancelConnection);
    Check(!marlinConnection.Connected && !marlinFactory.Channels[0].IsOpen, "Marlin C# fecha a porta serial ao desconectar");

    var gcodePath = Path.Combine(tempRoot, "fila test.gcode");
    await File.WriteAllTextAsync(gcodePath, "; fixture G-code\nG28\nM104 S210\n");

    var octoHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/version" => JsonResponse("{\"api\":\"1.1\"}"),
        "/api/job" when request.Method == HttpMethod.Get => JsonResponse("{\"state\":{\"text\":\"Printing\"},\"progress\":{\"completion\":57.5,\"printTimeLeft\":90,\"printTime\":30},\"job\":{\"file\":{\"name\":\"fila test.gcode\"},\"filamentUsed\":12,\"filamentUsedMm\":1200}}"),
        "/api/printer" => JsonResponse("{\"temperature\":{\"tool0\":{\"actual\":210,\"target\":220},\"bed\":{\"actual\":60,\"target\":65}}}"),
        _ => JsonResponse("{\"ok\":true}")
    });
    using (var octoAdapterHttp = new HttpClient(octoHandler))
    using (var octo = new HttpPrinterAdapterService(octoAdapterHttp))
    {
        var octoConnection = await octo.ConnectAsync(new NetworkPrinterDescriptor("octoprint", "192.168.2.20"),
            new Dictionary<string, string?> { ["apiKey"] = "octo-test-key" });
        Check(octoConnection.Connected && octoConnection.VersionOrInfo.GetProperty("api").GetString() == "1.1" && octoHandler.Requests.Last().GetHeader("X-Api-Key") == "octo-test-key", "OctoPrint C# conecta pela rota e API Key atuais");
        var octoStatus = await octo.GetStatusAsync(octoConnection);
        Check(octoStatus.State == "Printing" && octoStatus.Progress == 57.5 && octoStatus.RemainingMinutes == 2 && octoStatus.NozzleTemperature == 210 && octoStatus.File == "fila test.gcode", "OctoPrint C# normaliza status, progresso, temperatura e arquivo");
        await octo.StartPrintAsync(octoConnection, gcodePath);
        var octoUpload = octoHandler.Requests.Last();
        Check(octoUpload.Method == HttpMethod.Post && octoUpload.Uri.AbsolutePath == "/api/files/local" && octoUpload.GetHeader("X-Api-Key") == "octo-test-key" && octoUpload.Body.Contains("select", StringComparison.Ordinal) && octoUpload.Body.Contains("print", StringComparison.Ordinal) && octoUpload.Body.Contains("M104 S210", StringComparison.Ordinal), "OctoPrint C# envia G-code e flags select/print com autenticação");
        await octo.PauseAsync(octoConnection);
        Check(octoHandler.Requests.Last() is { Method: var pauseMethod, Uri.AbsolutePath: "/api/job" } && pauseMethod == HttpMethod.Post && octoHandler.Requests.Last().Body.Contains("\"action\":\"pause\"", StringComparison.Ordinal), "OctoPrint C# pausa com payload compatível");
        await octo.ResumeAsync(octoConnection);
        Check(octoHandler.Requests.Last().Body.Contains("\"action\":\"resume\"", StringComparison.Ordinal), "OctoPrint C# retoma com payload compatível");
        await octo.CancelAsync(octoConnection);
        Check(octoHandler.Requests.Last().Body.Contains("\"command\":\"cancel\"", StringComparison.Ordinal), "OctoPrint C# cancela com payload compatível");
    }

    var moonHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/server/info" => JsonResponse("{\"result\":{\"hostname\":\"Klipper-Lab\"}}"),
        "/printer/objects/query" => JsonResponse("{\"result\":{\"status\":{\"print_stats\":{\"state\":\"printing\",\"print_duration\":123,\"filament_used\":2.5,\"filament_used_mm\":840,\"filename\":\"fila test.gcode\"},\"display_status\":{\"progress\":0.42},\"extruder\":{\"temperature\":210,\"target\":220},\"heater_bed\":{\"temperature\":60,\"target\":65}}}}"),
        _ => JsonResponse("{\"result\":{\"ok\":true}}")
    });
    using (var moonHttp = new HttpClient(moonHandler))
    using (var moon = new HttpPrinterAdapterService(moonHttp))
    {
        var moonConnection = await moon.ConnectAsync(new NetworkPrinterDescriptor("moonraker", "192.168.2.21"),
            new Dictionary<string, string?> { ["apiKey"] = "moon-test-key" });
        Check(moonHandler.Requests.Last().Uri.AbsolutePath == "/server/info" && moonHandler.Requests.Last().GetHeader("Authorization") == "Bearer moon-test-key", "Moonraker C# conecta com bearer token pela rota atual");
        var moonStatus = await moon.GetStatusAsync(moonConnection);
        Check(moonStatus.State == "printing" && moonStatus.Progress == 42 && moonStatus.ActualPrintSeconds == 123 && moonStatus.ActualFilamentGrams == 2.5 && moonStatus.BedTargetTemperature == 65, "Moonraker C# normaliza status e métricas atuais");
        await moon.StartPrintAsync(moonConnection, gcodePath, checksum: "sha256-fixture");
        var moonUpload = moonHandler.Requests.Last();
        Check(moonUpload.Uri.AbsolutePath == "/server/files/upload" && moonUpload.GetHeader("Authorization") == "Bearer moon-test-key" && moonUpload.Body.Contains("checksum", StringComparison.Ordinal) && moonUpload.Body.Contains("sha256-fixture", StringComparison.Ordinal) && moonUpload.Body.Contains("M104 S210", StringComparison.Ordinal), "Moonraker C# envia arquivo, checksum e token no contrato atual");
        await moon.PauseAsync(moonConnection);
        Check(moonHandler.Requests.Last().Uri.AbsolutePath == "/printer/print/pause" && moonHandler.Requests.Last().Method == HttpMethod.Post, "Moonraker C# envia comando de pausa atual");
        await moon.ResumeAsync(moonConnection);
        Check(moonHandler.Requests.Last().Uri.AbsolutePath == "/printer/print/resume", "Moonraker C# envia comando de retomada atual");
        await moon.CancelAsync(moonConnection);
        Check(moonHandler.Requests.Last().Uri.AbsolutePath == "/printer/print/cancel", "Moonraker C# envia comando de cancelamento atual");
    }

    var prusaHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/version" => JsonResponse("{\"text\":\"PrusaLink\"}"),
        "/api/printer" => JsonResponse("{\"state\":\"PRINTING\",\"temp_nozzle\":210,\"target_nozzle\":220,\"temp_bed\":60,\"target_bed\":65}"),
        "/api/job" => JsonResponse("{\"id\":72,\"progress\":45,\"time_remaining\":80,\"time_printed\":123,\"file\":{\"name\":\"fila test.gcode\"}}"),
        _ => JsonResponse("{\"ok\":true}")
    });
    using (var prusaAdapterHttp = new HttpClient(prusaHandler))
    using (var prusa = new HttpPrinterAdapterService(prusaAdapterHttp))
    {
        var prusaConnection = await prusa.ConnectAsync(new NetworkPrinterDescriptor("prusalink", "192.168.2.22"),
            new Dictionary<string, string?> { ["username"] = "maker", ["password"] = "prusa-test-pass" });
        var prusaAuth = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes("maker:prusa-test-pass"));
        Check(prusaHandler.Requests.Last().Uri.AbsolutePath == "/api/version" && prusaHandler.Requests.Last().GetHeader("Authorization") == prusaAuth, "PrusaLink C# conecta com Basic Auth atual");
        var prusaStatus = await prusa.GetStatusAsync(prusaConnection);
        Check(prusaStatus.State == "PRINTING" && prusaStatus.Progress == 45 && prusaStatus.RemainingMinutes == 2 && prusaStatus.NozzleTemperature == 210 && prusaStatus.File == "fila test.gcode", "PrusaLink C# normaliza status, tempo, temperatura e job");
        await prusa.StartPrintAsync(prusaConnection, gcodePath);
        var prusaUpload = prusaHandler.Requests.Last();
        Check(prusaUpload.Method == HttpMethod.Put && prusaUpload.Uri.AbsolutePath == "/api/v1/files/local/fila%20test.gcode" && prusaUpload.GetHeader("Authorization") == prusaAuth && prusaUpload.GetHeader("Print-After-Upload") == "?1" && prusaUpload.Body.Contains("M104 S210", StringComparison.Ordinal), "PrusaLink C# envia bytes no caminho codificado com impressão automática");
        await prusa.PauseAsync(prusaConnection);
        Check(prusaHandler.Requests.Last() is { Method: var prusaPauseMethod, Uri.AbsolutePath: "/api/v1/job/72/pause" } && prusaPauseMethod == HttpMethod.Put, "PrusaLink C# pausa pelo job ativo autenticado");
        await prusa.ResumeAsync(prusaConnection);
        Check(prusaHandler.Requests.Last().Uri.AbsolutePath == "/api/v1/job/72/resume", "PrusaLink C# retoma pelo job ativo");
        await prusa.CancelAsync(prusaConnection);
        Check(prusaHandler.Requests.Last() is { Method: var prusaCancelMethod, Uri.AbsolutePath: "/api/v1/job/72" } && prusaCancelMethod == HttpMethod.Delete, "PrusaLink C# cancela pelo job ativo");
    }

    var rotationStore = new AgentCredentialStore(Path.Combine(tempRoot, "rotation"), protector);
    await rotationStore.SaveAsync(credentials);
    var rotationHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/agents/credential/rotate" => JsonResponse("{\"agentSecret\":\"new-agent-secret\",\"credentialVersion\":2}"),
        "/api/agents/credential/rotate/confirm" => JsonResponse("{\"credentialVersion\":2}"),
        _ => JsonResponse("{\"ok\":true}")
    });
    using (var rotationHttp = new HttpClient(rotationHandler))
    using (var rotationApi = new AgentCloudClient(new Uri("https://api.example.test"), rotationHttp))
    {
        var result = await new AgentCredentialRotationService(rotationApi, rotationStore).RecoverAndRotateAsync(credentials);
        Check(!result.Deferred && result.Credentials.AgentSecret == "new-agent-secret" && result.Credentials.CredentialVersion == 2 && result.Credentials.PendingCredentialVersion is null, "rotação C# grava o segredo novo antes de confirmar e limpa o estado pendente após sucesso");
        Check((await rotationStore.LoadAsync()) == result.Credentials && rotationHandler.Requests.Select(request => request.Uri.AbsolutePath).SequenceEqual(["/api/agents/credential/rotate", "/api/agents/credential/rotate/confirm"]) && rotationHandler.Requests.Last().GetHeader("x-agent-secret") == "new-agent-secret", "rotação C# persiste credenciais confirmadas e autentica a confirmação com o segredo novo");
    }

    var recoveredPending = credentials with { AgentSecret = "secret-pending-restart", PendingCredentialVersion = 3 };
    await rotationStore.SaveAsync(recoveredPending);
    var recoveryHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/agents/credential/rotate/confirm" => JsonResponse("{\"credentialVersion\":3}"),
        "/api/agents/credential/rotate" => JsonResponse("{\"rotated\":false}"),
        _ => JsonResponse("{\"ok\":true}")
    });
    using (var recoveryHttp = new HttpClient(recoveryHandler))
    using (var recoveryApi = new AgentCloudClient(new Uri("https://api.example.test"), recoveryHttp))
    {
        var recovered = await new AgentCredentialRotationService(recoveryApi, rotationStore).RecoverAndRotateAsync(recoveredPending);
        Check(!recovered.Deferred && recovered.Credentials.AgentSecret == "secret-pending-restart" && recovered.Credentials.CredentialVersion == 3 && recovered.Credentials.PendingCredentialVersion is null, "rotação C# recupera confirmação pendente após reinício antes de iniciar nova rotação");
        Check(recoveryHandler.Requests.Select(request => request.Uri.AbsolutePath).SequenceEqual(["/api/agents/credential/rotate/confirm", "/api/agents/credential/rotate"]), "recuperação C# confirma a credencial pendente antes de consultar nova rotação");
    }

    var startupDirectory = Path.Combine(tempRoot, "startup-pairing");
    var startupCredentialStore = new AgentCredentialStore(startupDirectory, protector);
    using var startupPrinterCredentialStore = new AgentPrinterCredentialStore(startupDirectory, protector, credentialUser);
    await startupCredentialStore.SavePendingPairingCodeAsync("ab12-cd34");
    await startupPrinterCredentialStore.SaveAsync(new PrinterCredentialIdentity("bambu", "192.0.2.88", 8883, "STARTUP-SERIAL"),
        new Dictionary<string, string?> { ["accessCode"] = "STARTUP-LAN-CODE", ["serial"] = "STARTUP-SERIAL" });
    var startupHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/agents/pair" => JsonResponse("{\"agentId\":\"agent-startup\",\"agentSecret\":\"secret-startup\",\"tenantId\":\"tenant-startup\",\"tenantName\":\"Empresa teste\",\"machineName\":\"PC-TESTE\"}"),
        "/api/agents/verify" => JsonResponse("{\"status\":\"ok\"}"),
        "/api/agents/credential/rotate" => JsonResponse("{\"rotated\":false}"),
        "/api/agents/printers/reconnect" => JsonResponse("{\"printers\":[{\"id\":\"printer-startup\",\"protocol\":\"bambu\",\"connectionType\":\"network\",\"name\":\"P1S de teste\",\"manufacturer\":\"Bambu Lab\",\"model\":\"P1S\",\"serial\":\"STARTUP-SERIAL\",\"ip\":\"192.0.2.88\",\"port\":8883}] }"),
        _ => JsonResponse("{}")
    });
    using (var startupHttp = new HttpClient(startupHandler))
    using (var startupCloud = new AgentCloudClient(new Uri("https://api.example.test"), startupHttp))
    {
        var startupMqttFactory = new FakeBambuMqttClientFactory();
        var startupBambuAdapter = new BambuPrinterAdapterService(startupMqttFactory, bambuUploader,
            new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION" });
        await using var startupPrinterManager = new AgentPrinterConnectionManager(startupCloud, startupPrinterCredentialStore, bambu: startupBambuAdapter);
        var startupService = new AgentRuntimeStartupService(startupCloud, startupCredentialStore, startupPrinterManager,
            "PC-TESTE", "win32", "x64", "0.1.25");
        var startup = await startupService.InitializeAsync();
        var startupMqtt = startupMqttFactory.Clients.Single();
        var pairedCredential = await startupCredentialStore.LoadAsync();
        using var pairBody = JsonDocument.Parse(startupHandler.Requests.Single(request => request.Uri.AbsolutePath == "/api/agents/pair").Body);
        Check(startup.State == AgentStartupState.Ready && startup.PairedThisRun && pairedCredential?.AgentId == "agent-startup" &&
            pairBody.RootElement.GetProperty("code").GetString() == "AB12-CD34" && pairBody.RootElement.GetProperty("version").GetString() == "0.1.25",
            "inicialização C# consome pareamento pendente, envia contrato atual e persiste credenciais protegidas");
        Check(startup.PrinterReconnect is { Requested: 1, Connected: 1 } && startupPrinterManager.ActiveConnectionCount == 1 &&
            startupMqtt.Options?.AccessCode == "STARTUP-LAN-CODE" &&
            startupHandler.Requests.Select(request => request.Uri.AbsolutePath).SequenceEqual([
                "/api/agents/pair", "/api/agents/verify", "/api/agents/credential/rotate", "/api/agents/printers/reconnect"]) &&
            startupHandler.Requests.Last().GetHeader("x-agent-secret") == "secret-startup",
            "startup C# valida credencial e reconecta a impressora registrada usando o segredo local sem expô-lo à API");
    }

    var rejectedDirectory = Path.Combine(tempRoot, "startup-rejected");
    var rejectedCredentialStore = new AgentCredentialStore(rejectedDirectory, protector);
    await rejectedCredentialStore.SaveAsync(credentials);
    using var rejectedPrinterCredentialStore = new AgentPrinterCredentialStore(rejectedDirectory, protector, credentialUser);
    var rejectedHandler = new PrinterAdapterHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized)
    {
        Content = new StringContent("{\"error\":\"Agent invalido\"}", Encoding.UTF8, "application/json")
    });
    using (var rejectedHttp = new HttpClient(rejectedHandler))
    using (var rejectedCloud = new AgentCloudClient(new Uri("https://api.example.test"), rejectedHttp))
    {
        await using var rejectedPrinterManager = new AgentPrinterConnectionManager(rejectedCloud, rejectedPrinterCredentialStore);
        var rejectedStartup = new AgentRuntimeStartupService(rejectedCloud, rejectedCredentialStore, rejectedPrinterManager,
            "PC-TESTE", "win32", "x64", "0.1.25");
        var rejected = await rejectedStartup.InitializeAsync();
        Check(rejected.State == AgentStartupState.AwaitingPairing && rejected.CredentialsRejected &&
            await rejectedCredentialStore.LoadAsync() is null && rejectedHandler.Requests.Select(request => request.Uri.AbsolutePath).SequenceEqual(["/api/agents/verify"]),
            "startup C# limpa somente credencial recusada e retorna ao estado de pareamento sem chamar outras rotas");
    }

    var printerCommandDirectory = Path.Combine(tempRoot, "printer-commands");
    var printerCommandCredentialStore = new AgentPrinterCredentialStore(printerCommandDirectory, protector, credentialUser);
    using var printerCommandOperations = new AgentLocalOperationsStore(Path.Combine(printerCommandDirectory, "operations.sqlite"));
    var printerCommandMqttFactory = new FakeBambuMqttClientFactory();
    var printerCommandBambu = new BambuPrinterAdapterService(printerCommandMqttFactory, bambuUploader,
        new Dictionary<string, string?> { ["FILA_AGENT_ENVIRONMENT"] = "PRODUCTION" });
    var printerCommandPrintFileBytes = Encoding.UTF8.GetBytes("; authenticated local print fixture\nG28\nG1 X1 Y1 F1200\n");
    var printerCommandPrintFileHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(printerCommandPrintFileBytes)).ToLowerInvariant();
    var failPauseCompletion = true;
    string? pendingPrinterCommandJson = null;
    var printerCommandState = "Printing";
    var printerCommandApiHandler = new PrinterAdapterHttpHandler(request =>
    {
        if (request.Uri.AbsolutePath == "/api/agents/commands/pending")
        {
            var pending = pendingPrinterCommandJson ?? "{\"command\":null}";
            pendingPrinterCommandJson = null;
            return JsonResponse(pending);
        }
        if (request.Uri.AbsolutePath == "/api/agents/print-file" && request.Method == HttpMethod.Get)
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(printerCommandPrintFileBytes) };
        if (request.Uri.AbsolutePath == "/api/agents/commands/printer-pause/complete" && failPauseCompletion)
            return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("{\"error\":\"fixture outage\"}") };
        return JsonResponse("{\"ok\":true}");
    });
    var printerCommandDeviceHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
    {
        "/api/version" => JsonResponse("{\"api\":\"1.1\"}"),
        "/api/job" when request.Method == HttpMethod.Get => JsonResponse($"{{\"state\":{{\"text\":\"{printerCommandState}\"}},\"progress\":{{\"completion\":57.5,\"printTimeLeft\":90,\"printTime\":30}},\"job\":{{\"file\":{{\"name\":\"fila test.gcode\"}}}}}}"),
        "/api/printer" => JsonResponse("{\"temperature\":{\"tool0\":{\"actual\":210,\"target\":220},\"bed\":{\"actual\":60,\"target\":65}}}"),
        _ => JsonResponse("{\"ok\":true}")
    });
    using (var printerCommandApiHttp = new HttpClient(printerCommandApiHandler))
    using (var printerCommandCloud = new AgentCloudClient(new Uri("https://api.example.test"), printerCommandApiHttp))
    using (var printerCommandDeviceHttp = new HttpClient(printerCommandDeviceHandler))
    {
        var printerCommandHttpAdapter = new HttpPrinterAdapterService(printerCommandDeviceHttp);
        await using var printerCommandManager = new AgentPrinterConnectionManager(printerCommandCloud, printerCommandCredentialStore,
            http: printerCommandHttpAdapter, bambu: printerCommandBambu);
        var printerCommandCacheDirectory = Path.Combine(printerCommandDirectory, "print-cache");
        var printerCommandFiles = new AgentPrintFileCache(printerCommandCloud, printerCommandCacheDirectory);
        var printerCommandMonitors = new ProductionJobMonitorService(printerCommandCloud, printerCommandOperations,
            printerCommandManager, printerCommandFiles, pollInterval: TimeSpan.FromSeconds(1),
            stablePollInterval: TimeSpan.FromSeconds(1), maxPolls: 1_000);
        var resumedMonitorPrinter = new AgentPrinterDescriptor("octoprint", "network", Name: "Octo teste", Ip: "192.0.2.90", Port: 5000);
        await printerCommandCredentialStore.SaveAsync(resumedMonitorPrinter.CredentialIdentity,
            new Dictionary<string, string?> { ["apiKey"] = "OCTO-LOCAL-SECRET" });
        printerCommandOperations.QueueProductionJobMonitor(new AgentProductionJobMonitor(
            "print-job-resume", "printer-resume-monitor", resumedMonitorPrinter, DateTimeOffset.UtcNow.AddMinutes(-1)));
        printerCommandMonitors.StartPending(credentials);
        using var printerNetworkDiscovery = new NetworkDiscoveryService(new FakePrinterPortConnectProbe([]),
            ssdpDiscovery: _ => Task.FromResult<IReadOnlyList<BambuNetworkCandidate>>([
                new BambuNetworkCandidate("network", "bambu", "Bambu Lab", "Bambu Lab", "Bambu de teste", "A1", "BAMBU-TEST-001",
                    "192.0.2.91", 8883, true, ["serial", "accessCode"])
            ]));
        var printerUsbDiscovery = new UsbDiscoveryService(
            new FakeSerialPortCatalog([new SerialPortCandidate("COM7", "Marlin USB de teste")]),
            new FakeMarlinFirmwareProbe((_, _) => "FIRMWARE_NAME:Marlin 2.1.2"));
        using var printerCommands = new AgentPrinterCommandHandler(printerCommandCloud, printerCommandOperations, printerCommandManager,
            printerCommandFiles, printerNetworkDiscovery, printerUsbDiscovery,
            onPrintJobStarted: (agent, monitor, token) => printerCommandMonitors.Start(agent, monitor, token));
        var printerCommandSlicing = new ProductionJobSlicingCommandHandler(printerCommandCloud, printerCommandOperations,
            new ProductionJobSlicingService(printerCommandCloud, printerCommandFiles));
        var printerCommandPolling = new AgentCommandPollingService(printerCommandCloud, printerCommandOperations,
            printerCommands, printerCommandSlicing);
        async Task<AgentCommandDispatchResult> DispatchPrinterCommand(string json)
        {
            using var document = JsonDocument.Parse(json);
            return await printerCommands.TryDispatchPendingAsync(credentials, document.RootElement);
        }

        const string octoPrinter = "\"printer\":{\"protocol\":\"octoprint\",\"connectionType\":\"network\",\"name\":\"Octo teste\",\"ip\":\"192.0.2.90\",\"port\":5000}";
        var connected = await DispatchPrinterCommand("{\"command\":{\"id\":\"printer-connect\",\"type\":\"connect_printer\",\"payload\":{" + octoPrinter + ",\"options\":{\"apiKey\":\"OCTO-LOCAL-SECRET\"}}}}");
        var commandPrinterCredentialContents = await File.ReadAllTextAsync(Path.Combine(printerCommandDirectory, "printer-credentials.json"));
        var connectCompletion = printerCommandApiHandler.Requests.Single(request => request.Uri.AbsolutePath == "/api/agents/commands/printer-connect/complete");
        Check(connected is { Handled: true, Status: "completed", Result: { } connectedResult } && connectedResult.GetProperty("success").GetBoolean() &&
            !commandPrinterCredentialContents.Contains("OCTO-LOCAL-SECRET", StringComparison.Ordinal) && !connectCompletion.Body.Contains("OCTO-LOCAL-SECRET", StringComparison.Ordinal),
            "dispatcher C# conecta OctoPrint, cifra a API Key localmente e nao a devolve na conclusao da API");

        var status = await DispatchPrinterCommand("{\"command\":{\"id\":\"printer-status\",\"type\":\"printer_status\",\"payload\":{" + octoPrinter + "}}}");
        var statusResult = status.Result!.Value.GetProperty("status");
        Check(statusResult.GetProperty("state").GetString() == "Printing" && statusResult.GetProperty("progress").GetDouble() == 57.5 &&
            printerCommandDeviceHandler.Requests.Where(request => request.Uri.AbsolutePath is "/api/job" or "/api/printer").All(request => request.GetHeader("X-Api-Key") == "OCTO-LOCAL-SECRET"),
            "dispatcher C# restaura sessao OctoPrint pelas credenciais locais e consulta status normalizado com autenticacao");

        pendingPrinterCommandJson = "{\"command\":{\"id\":\"printer-discovery\",\"type\":\"discover_printers\",\"payload\":{}}}";
        var discovery = await printerCommandPolling.PollOnceAsync(credentials);
        var emptyPoll = await printerCommandPolling.PollOnceAsync(credentials);
        var discoveredPrinters = discovery.Result!.Value.GetProperty("printers");
        var discoveryProgress = printerCommandApiHandler.Requests.LastOrDefault(request =>
            request.Uri.AbsolutePath == "/api/agents/commands/printer-discovery/progress");
        Check(discovery.Result.Value.GetProperty("success").GetBoolean() && discoveredPrinters.GetArrayLength() == 2 &&
            discoveredPrinters[0].GetProperty("protocol").GetString() == "bambu" &&
            discoveredPrinters[1].GetProperty("protocol").GetString() == "marlin" &&
            discoveredPrinters[1].GetProperty("port").GetString() == "COM7" &&
            discovery.Result.Value.GetProperty("diagnostics").GetProperty("warnings").ValueKind == JsonValueKind.Array &&
            discoveryProgress is not null && discoveryProgress.Body.Contains("\"type\":\"discovery\"", StringComparison.Ordinal) &&
            discoveryProgress.Body.Contains("BAMBU-TEST-001", StringComparison.Ordinal) &&
            printerCommandApiHandler.Requests.Any(request => request.Uri.AbsolutePath == "/api/agents/commands/printer-discovery/complete") &&
            !emptyPoll.Handled && emptyPoll.Status == "empty",
            "poll C# busca comando pendente, descobre Bambu via SSDP e Marlin USB, publica progresso e volta ao estado vazio");

        var pauseJson = "{\"command\":{\"id\":\"printer-pause\",\"type\":\"printer_pause\",\"payload\":{" + octoPrinter + "}}}";
        var pause = await DispatchPrinterCommand(pauseJson);
        Check(pause.Result!.Value.GetProperty("success").GetBoolean() && printerCommandOperations.GetPendingCounts().Completions == 1 &&
            printerCommandApiHandler.Requests.Any(request => request.Uri.AbsolutePath == "/api/agents/commands/printer-pause/complete" && request.GetHeader("x-agent-secret") == credentials.AgentSecret),
            "dispatcher C# persiste conclusao de pausa na outbox quando a API falha sem perder o comando executado");
        failPauseCompletion = false;
        await printerCommands.FlushPendingCompletionsAsync(credentials);
        await DispatchPrinterCommand("{\"command\":{\"id\":\"printer-resume\",\"type\":\"printer_resume\",\"payload\":{" + octoPrinter + "}}}");
        await DispatchPrinterCommand("{\"command\":{\"id\":\"printer-cancel\",\"type\":\"printer_cancel\",\"payload\":{" + octoPrinter + "}}}");
        var deviceControlRequests = printerCommandDeviceHandler.Requests.Where(request => request.Uri.AbsolutePath == "/api/job" && request.Method == HttpMethod.Post).ToArray();
        var duplicatePause = await DispatchPrinterCommand(pauseJson);
        Check(deviceControlRequests.Length == 3 && deviceControlRequests.Select(request => request.Body).Any(body => body.Contains("\"action\":\"pause\"", StringComparison.Ordinal)) &&
            deviceControlRequests.Select(request => request.Body).Any(body => body.Contains("\"action\":\"resume\"", StringComparison.Ordinal)) &&
            deviceControlRequests.Select(request => request.Body).Any(body => body.Contains("\"command\":\"cancel\"", StringComparison.Ordinal)) &&
            duplicatePause.Status == "completed" && printerCommandOperations.GetPendingCounts().Completions == 0,
            "dispatcher C# pausa, retoma e cancela com payload OctoPrint atual e nao repete comando concluido");

        var startPrintJson = "{\"command\":{\"id\":\"printer-start-print\",\"type\":\"start_print\",\"payload\":{\"printJobId\":\"print-job-33\"," + octoPrinter + ",\"job\":{\"id\":\"print-job-33\",\"title\":\"fixture job\",\"validationStatus\":\"validated\",\"printFile\":{\"name\":\"fixture.gcode\",\"format\":\"gcode\",\"storageKey\":\"tenant/storage/print/33\",\"hash\":\"" + printerCommandPrintFileHash + "\",\"sizeBytes\":" + printerCommandPrintFileBytes.Length + "}}}}}";
        var startPrint = await DispatchPrinterCommand(startPrintJson);
        var uploadedPrint = printerCommandDeviceHandler.Requests.Single(request => request.Uri.AbsolutePath == "/api/files/local" && request.Method == HttpMethod.Post);
        var downloadedPrint = printerCommandApiHandler.Requests.Single(request => request.Uri.AbsolutePath == "/api/agents/print-file");
        var cachedPrintPath = Path.Combine(printerCommandCacheDirectory, printerCommandPrintFileHash + ".gcode");
        Check(startPrint.Result!.Value.GetProperty("success").GetBoolean() &&
            startPrint.Result.Value.GetProperty("result").GetProperty("started").GetBoolean() &&
            uploadedPrint.Body.Contains("G28", StringComparison.Ordinal) && uploadedPrint.Body.Contains("fixture.gcode", StringComparison.Ordinal) &&
            uploadedPrint.GetHeader("X-Api-Key") == "OCTO-LOCAL-SECRET",
            "dispatcher C# inicia impressao OctoPrint so com Production Job validado, arquivo local e API Key salva");
        Check(downloadedPrint.GetHeader("x-agent-id") == credentials.AgentId && downloadedPrint.GetHeader("x-agent-secret") == credentials.AgentSecret &&
            downloadedPrint.Uri.Query.Contains("tenant%2Fstorage%2Fprint%2F33", StringComparison.OrdinalIgnoreCase) &&
            File.Exists(cachedPrintPath) && File.Exists(cachedPrintPath + ".pin") &&
            printerCommandOperations.ListPendingProductionJobMonitors().Any(monitor => monitor.PrintJobId == "print-job-33"),
            "start_print C# mantém o arquivo pinado e persiste o monitor apos iniciar a impressao");
        var duplicateStartPrint = await DispatchPrinterCommand(startPrintJson);
        Check(duplicateStartPrint.Status == "completed" &&
            printerCommandDeviceHandler.Requests.Count(request => request.Uri.AbsolutePath == "/api/files/local") == 1 &&
            printerCommandApiHandler.Requests.Count(request => request.Uri.AbsolutePath == "/api/agents/print-file") == 1,
            "comando start_print duplicado retorna resultado persistido sem baixar nem enviar o arquivo novamente");

        var invalidStartPrint = await DispatchPrinterCommand(startPrintJson.Replace("validated", "needs_validation", StringComparison.Ordinal)
            .Replace("printer-start-print", "printer-start-invalid", StringComparison.Ordinal));
        Check(invalidStartPrint.Result?.GetProperty("success").GetBoolean() == false &&
            printerCommandDeviceHandler.Requests.Count(request => request.Uri.AbsolutePath == "/api/files/local") == 1,
            "start_print C# rejeita receita nao validada antes de qualquer envio a impressora");

        printerCommandState = "Finished";
        for (var attempt = 0; attempt < 1_000 && printerCommandOperations.ListPendingProductionJobMonitors().Count > 0; attempt++)
            await Task.Delay(10);
        var completionMetricRequests = printerCommandApiHandler.Requests
            .Where(request => request.Uri.AbsolutePath.EndsWith("/metrics", StringComparison.Ordinal))
            .ToArray();
        var pendingProductionJobMonitorCount = printerCommandOperations.ListPendingProductionJobMonitors().Count;
        var printPinRemains = File.Exists(cachedPrintPath + ".pin");
        var startPrintCompletionMetric = completionMetricRequests.Any(request => request.Uri.AbsolutePath.EndsWith("/print-job-33/metrics", StringComparison.Ordinal) &&
            request.Body.Contains("agent-printer-start-print-completion", StringComparison.Ordinal) &&
            request.Body.Contains("\"actualPrintSeconds\":30", StringComparison.Ordinal));
        Check(pendingProductionJobMonitorCount == 0 && !printPinRemains && completionMetricRequests.Length == 2 && startPrintCompletionMetric,
            $"monitor C# retoma Production Job salvo, detecta fim, envia métricas e libera cache pinado (pending={pendingProductionJobMonitorCount}, pin={printPinRemains}, metrics={completionMetricRequests.Length}, startMetric={startPrintCompletionMetric}; {string.Join(" | ", completionMetricRequests.Select(request => request.Uri.AbsolutePath + " " + request.Body))})");

        var disconnected = await DispatchPrinterCommand("{\"command\":{\"id\":\"printer-disconnect\",\"type\":\"disconnect_printer\",\"payload\":{" + octoPrinter + "}}}");
        Check(disconnected.Result!.Value.GetProperty("result").GetProperty("disconnected").GetBoolean() &&
            !disconnected.Result.Value.GetProperty("result").GetProperty("alreadyDisconnected").GetBoolean() && printerCommandManager.ActiveConnectionCount == 0,
            "dispatcher C# desconecta sessao e reporta estado compativel com o contrato atual");
    }
}
finally
{
    try { Directory.Delete(tempRoot, true); } catch { }
}

var apiHandler = new ContractHandler();
using (var apiHttp = new HttpClient(apiHandler))
using (var api = new AgentCloudClient(new Uri("https://api.example.test"), apiHttp))
{
    var paired = await api.PairAsync("a1b2-c3d4", "PC-TESTE", "win32", "x64", "0.1.25");
    Check(paired.AgentId == "agent-42" && paired.AgentSecret == "secret-from-api", "pareamento C# interpreta resposta atual da API");
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/pair", "pareamento usa rota atual sem alterar o backend");
    using var body = JsonDocument.Parse(apiHandler.LastBody!);
    Check(body.RootElement.GetProperty("code").GetString() == "A1B2-C3D4" && body.RootElement.GetProperty("version").GetString() == "0.1.25", "pareamento envia codigo normalizado e versao");

    await api.VerifyAsync(paired);
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/verify" && apiHandler.LastRequest.Headers.Contains("x-agent-id") && apiHandler.LastRequest.Headers.Contains("x-agent-secret"), "verificacao usa os cabecalhos de credencial existentes");

    await api.SendHeartbeatAsync(paired, new { version = "0.1.25", connected = true });
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/heartbeat" && apiHandler.LastRequest.Headers.Contains("x-agent-id") && apiHandler.LastBody?.Contains("\"connected\":true", StringComparison.Ordinal) == true, "heartbeat C# usa rota autenticada e payload JSON atual");
    await api.GetPendingCommandAsync(paired);
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/commands/pending" && apiHandler.LastRequest.Method == HttpMethod.Get, "consulta de comandos pendentes C# usa rota atual");
    await api.GetRegisteredPrintersForReconnectAsync(paired);
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/printers/reconnect" && apiHandler.LastRequest.Method == HttpMethod.Get, "reconexão de impressoras registradas C# usa rota atual");
    var rotation = await api.RotateCredentialAsync(paired);
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/credential/rotate" && rotation.GetProperty("credentialVersion").GetInt32() == 2, "rotação C# usa a rota atual e interpreta a versão pendente");
    var pendingCredentials = paired with { AgentSecret = rotation.GetProperty("agentSecret").GetString()!, PendingCredentialVersion = 2 };
    var confirmedRotation = await api.ConfirmCredentialRotationAsync(pendingCredentials);
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/credential/rotate/confirm" && apiHandler.LastRequest.Headers.GetValues("x-agent-secret").Single() == "rotated-test-secret" && confirmedRotation.GetProperty("credentialVersion").GetInt32() == 2, "confirmação C# usa o segredo novo e finaliza a versão pendente");

    await api.CompleteCommandAsync(paired, "command/42", success: false, new { success = false, error = "fixture" });
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/commands/command%2F42/complete", "conclusão C# codifica o ID do comando na rota");
    using (var completion = JsonDocument.Parse(apiHandler.LastBody!))
        Check(!completion.RootElement.GetProperty("success").GetBoolean() && completion.RootElement.GetProperty("result").GetProperty("error").GetString() == "fixture", "conclusão C# preserva resultado e indicador de falha do comando");

    await api.ReportCommandProgressAsync(paired, "command-43", new { stage = "slicing", percent = 50 });
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/commands/command-43/progress" && apiHandler.LastBody?.Contains("\"percent\":50", StringComparison.Ordinal) == true, "progresso de comando C# usa payload atual");
    var requestCountBeforeEmptyEvents = apiHandler.RequestCount;
    var emptyEvents = await api.SyncEventsAsync(paired, Array.Empty<object>());
    Check(emptyEvents.GetProperty("accepted").GetInt32() == 0 && apiHandler.RequestCount == requestCountBeforeEmptyEvents, "sincronização vazia de eventos não cria chamada de rede");
    await api.SyncEventsAsync(paired, [new { type = "printer.status", state = "idle" }]);
    Check(apiHandler.LastRequest?.RequestUri?.AbsolutePath == "/api/agents/sync-events" && apiHandler.LastBody?.Contains("printer.status", StringComparison.Ordinal) == true, "eventos C# são enviados em lote pela rota atual");

    var uploadPath = Path.Combine(Path.GetTempPath(), "fila-agent-cloud-test-" + Guid.NewGuid().ToString("N") + ".gcode");
    await File.WriteAllTextAsync(uploadPath, "; sliced artifact fixture\nG28\nM104 S210\n");
    try
    {
        var artifactInfo = new FileInfo(uploadPath);
        var artifact = new OrcaSliceArtifact("gcode", uploadPath, new string('a', 64), artifactInfo.Length,
            new OrcaProfile("bambu-p1s-pla-basic", "2.4.2", ["machine.json"], ["filament.json"]), "", "");
        await api.UploadSlicedPrintArtifactAsync(paired, "print job/42", artifact, "idempotency-fixture",
            new PrintJobEstimate(EstimatedPrintSeconds: 900, EstimatedFilamentGrams: 12.5, EstimatedFilamentMillimeters: 420));
        var artifactRequest = apiHandler.LastRequest ?? throw new InvalidOperationException("Request de slicing ausente.");
        Check(artifactRequest.RequestUri?.AbsolutePath == "/api/agents/print-jobs/print%20job%2F42/slicing-artifact" && artifactRequest.Method == HttpMethod.Post, "upload C# de G-code usa rota de Production Job codificada");
        Check(artifactRequest.Headers.GetValues("x-agent-file-name").Single() == Path.GetFileName(uploadPath) && artifactRequest.Headers.GetValues("x-agent-file-format").Single() == "gcode" && artifactRequest.Headers.GetValues("x-agent-idempotency-key").Single() == "idempotency-fixture" && !artifactRequest.Headers.Contains("x-printflow-file-name"), "upload C# envia somente metadados atuais do Agent");
        Check(artifactRequest.Headers.GetValues("x-agent-slicer-profile-id").Single() == "bambu-p1s-pla-basic" && artifactRequest.Headers.GetValues("x-agent-estimated-print-seconds").Single() == "900" && !artifactRequest.Headers.Contains("x-printflow-estimated-print-seconds") && apiHandler.LastBody?.Contains("M104 S210", StringComparison.Ordinal) == true, "upload C# transmite perfil, métricas e bytes do G-code fatiado sem aliases legados");
    }
    finally { try { File.Delete(uploadPath); } catch { } }
}

var runtimeLoopRoot = Path.Combine(tempRoot, "runtime-loop");
try
{
var runtimeLoopProtector = new ReversibleTestProtector();
var runtimeLoopCredentialUser = new PrinterCredentialUserContext("fixture-host", "fixture-user", @"C:\fixture");
var runtimeLoopCredentials = new AgentCredentialStore(runtimeLoopRoot, runtimeLoopProtector);
using var runtimeLoopPrinterCredentials = new AgentPrinterCredentialStore(runtimeLoopRoot, runtimeLoopProtector, runtimeLoopCredentialUser);
using var runtimeLoopOperations = new AgentLocalOperationsStore(Path.Combine(runtimeLoopRoot, "agent-operations.sqlite"));
runtimeLoopOperations.QueueProductionMetric("runtime-metric", new { status = "completed", idempotencyKey = "runtime-loop-metric" });
runtimeLoopOperations.QueueEvent("runtime.ready", new { version = "0.1.25" });
var heartbeatSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var pendingPollSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var pendingPollAfterModeSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var pendingPollAfterRealtimeEventSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var pendingPollCount = 0;
var runtimeMetricSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var runtimeEventSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var cloudPairSeen = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
HttpResponseMessage MarkCloudPair()
{
    cloudPairSeen.TrySetResult();
    return JsonResponse("{\"agentId\":\"agent-loop\",\"agentSecret\":\"secret-loop\",\"tenantId\":\"tenant-loop\",\"tenantName\":\"Teste\",\"machineName\":\"PC-LOOP\"}");
}
HttpResponseMessage MarkHeartbeat()
{
    heartbeatSeen.TrySetResult();
    return JsonResponse("{\"ok\":true}");
}
HttpResponseMessage MarkPendingPoll()
{
    pendingPollSeen.TrySetResult();
    var count = Interlocked.Increment(ref pendingPollCount);
    if (count >= 2) pendingPollAfterModeSeen.TrySetResult();
    if (count >= 3) pendingPollAfterRealtimeEventSeen.TrySetResult();
    return JsonResponse("{\"command\":null}");
}
HttpResponseMessage MarkRuntimeMetric()
{
    runtimeMetricSeen.TrySetResult();
    return JsonResponse("{\"ok\":true}");
}
HttpResponseMessage MarkRuntimeEvent()
{
    runtimeEventSeen.TrySetResult();
    return JsonResponse("{\"accepted\":1}");
}
var runtimeLoopHandler = new PrinterAdapterHttpHandler(request => request.Uri.AbsolutePath switch
{
    "/api/agents/pair" => MarkCloudPair(),
    "/api/agents/verify" => JsonResponse("{\"ok\":true}"),
    "/api/agents/credential/rotate" => JsonResponse("{\"ok\":true}"),
    "/api/agents/printers/reconnect" => JsonResponse("{\"printers\":[]}"),
    "/api/agents/heartbeat" => MarkHeartbeat(),
    "/api/agents/commands/pending" => MarkPendingPoll(),
    "/api/agents/print-jobs/runtime-metric/metrics" => MarkRuntimeMetric(),
    "/api/agents/sync-events" => MarkRuntimeEvent(),
    _ => JsonResponse("{\"ok\":true}")
});
using (var runtimeLoopHttp = new HttpClient(runtimeLoopHandler))
using (var runtimeLoopCloud = new AgentCloudClient(new Uri("https://api.example.test"), runtimeLoopHttp))
{
    await using var runtimeLoopPrinterManager = new AgentPrinterConnectionManager(runtimeLoopCloud, runtimeLoopPrinterCredentials);
    var runtimeLoopCache = new AgentPrintFileCache(runtimeLoopCloud, Path.Combine(runtimeLoopRoot, "cache"));
    using var runtimeLoopPrinterCommands = new AgentPrinterCommandHandler(runtimeLoopCloud, runtimeLoopOperations,
        runtimeLoopPrinterManager, runtimeLoopCache);
    var runtimeLoopSlicing = new ProductionJobSlicingCommandHandler(runtimeLoopCloud, runtimeLoopOperations,
        new ProductionJobSlicingService(runtimeLoopCloud, runtimeLoopCache,
            environment: new Dictionary<string, string?>()));
    var runtimeLoopPolling = new AgentCommandPollingService(runtimeLoopCloud, runtimeLoopOperations,
        runtimeLoopPrinterCommands, runtimeLoopSlicing);
    var runtimeLoopStartup = new AgentRuntimeStartupService(runtimeLoopCloud, runtimeLoopCredentials,
        runtimeLoopPrinterManager, "PC-LOOP", "win32", "x64", "0.1.25");
    var runtimeLoopRealtime = new TestRealtimeNotificationClient();
    var runtimeLoopStatus = new AgentRuntimeStatusState();
    var runtimeLoopPort = GetFreePort();
    var runtimeLoopLocalServer = new AgentLocalServer(runtimeLoopPort, [], runtimeLoopCredentials,
        () => runtimeLoopStatus.Snapshot);
    var runtimeLoop = new AgentRuntimeLoop(runtimeLoopStartup, runtimeLoopCredentials, runtimeLoopCloud,
        runtimeLoopPolling, runtimeLoopLocalServer, runtimeLoopStatus,
        () => new { version = "0.1.25", machineName = "PC-LOOP", connected = true },
        heartbeatInterval: TimeSpan.FromMilliseconds(50),
        commandPollInterval: TimeSpan.FromSeconds(10),
        commandPollMaxInterval: TimeSpan.FromSeconds(10),
        retryInitialInterval: TimeSpan.FromMilliseconds(30),
        retryMaxInterval: TimeSpan.FromMilliseconds(1000),
        realtimeNotifications: runtimeLoopRealtime,
        webSocketCommandPollInterval: TimeSpan.FromSeconds(30),
        sseCommandPollInterval: TimeSpan.FromSeconds(30));
    using var runtimeLoopCancellation = new CancellationTokenSource();
    var runtimeLoopTask = Task.Run(() => runtimeLoop.RunAsync(runtimeLoopCancellation.Token));
    using var localPairingHttp = new HttpClient();
    await Task.Delay(500);
    using var localPairingResponse = await localPairingHttp.PostAsync(
        $"http://127.0.0.1:{runtimeLoopPort}/pair",
        new StringContent("{\"code\":\"AB12-CD34\"}", Encoding.UTF8, "application/json"));
    Check(localPairingResponse.StatusCode == HttpStatusCode.Accepted,
        "runtime C# aceita pareamento local pela porta loopback sem iniciar Node");
    await cloudPairSeen.Task.WaitAsync(TimeSpan.FromMilliseconds(250));
    Check(cloudPairSeen.Task.IsCompleted,
        "runtime C# consome codigo de pareamento sem backoff exponencial quando nao ha credencial");
    await Task.WhenAll(heartbeatSeen.Task.WaitAsync(TimeSpan.FromSeconds(3)),
        pendingPollSeen.Task.WaitAsync(TimeSpan.FromSeconds(3)),
        runtimeMetricSeen.Task.WaitAsync(TimeSpan.FromSeconds(3)),
        runtimeEventSeen.Task.WaitAsync(TimeSpan.FromSeconds(3)));
    await runtimeLoopRealtime.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));
    runtimeLoopRealtime.SetMode("websocket");
    await pendingPollAfterModeSeen.Task.WaitAsync(TimeSpan.FromSeconds(1));
    runtimeLoopRealtime.NotifyCommandAvailable();
    await pendingPollAfterRealtimeEventSeen.Task.WaitAsync(TimeSpan.FromSeconds(1));
    for (var attempt = 0; attempt < 30 && !runtimeLoopStatus.Snapshot.CloudConnected; attempt++)
        await Task.Delay(10);
    var runtimeLoopHealth = await localPairingHttp.GetStringAsync($"http://127.0.0.1:{runtimeLoopPort}/healthz");
    using var runtimeLoopHealthDocument = JsonDocument.Parse(runtimeLoopHealth);
    var runtimeLoopPaths = runtimeLoopHandler.Requests.Select(request => request.Uri.AbsolutePath).ToArray();
    Check(runtimeLoopHealthDocument.RootElement.GetProperty("paired").GetBoolean() &&
        runtimeLoopHealthDocument.RootElement.GetProperty("cloudConnected").GetBoolean() &&
        runtimeLoopHealthDocument.RootElement.GetProperty("realtimeMode").GetString() == "websocket" &&
        runtimeLoopPaths.Contains("/api/agents/pair") && runtimeLoopPaths.Contains("/api/agents/verify") &&
        runtimeLoopPaths.Contains("/api/agents/printers/reconnect") && runtimeLoopPaths.Contains("/api/agents/heartbeat") &&
        runtimeLoopPaths.Contains("/api/agents/commands/pending") &&
        runtimeLoopPaths.Contains("/api/agents/print-jobs/runtime-metric/metrics") &&
        runtimeLoopPaths.Contains("/api/agents/sync-events") &&
        runtimeLoopOperations.ListPendingEvents().Count == 0 &&
        runtimeLoopOperations.GetPendingCounts().Metrics == 0,
        "runtime C# persiste pareamento, confirma health local, mantém heartbeat/polling e sincroniza eventos e métricas");
    runtimeLoopCancellation.Cancel();
    await runtimeLoopTask.WaitAsync(TimeSpan.FromSeconds(3));
}
var compositionRoot = Path.Combine(tempRoot, "runtime-composition");
var compositionPort = GetFreePort();
var compositionConfiguration = new AgentConfiguration("DEVELOPMENT", new Uri("http://127.0.0.1:3333"),
    new Uri("ws://127.0.0.1:3333"), [], compositionPort, compositionRoot,
    Path.Combine(compositionRoot, "logs"), "9.8.7");
await using (var composition = new AgentRuntimeComposition(compositionConfiguration, dataProtector: new ReversibleTestProtector()))
using (var compositionCancellation = new CancellationTokenSource())
using (var compositionHttp = new HttpClient())
{
    var compositionTask = composition.RunAsync(compositionCancellation.Token);
    var healthText = await compositionHttp.GetStringAsync($"http://127.0.0.1:{compositionPort}/healthz").WaitAsync(TimeSpan.FromSeconds(3));
    using var healthDocument = JsonDocument.Parse(healthText);
    Check(healthDocument.RootElement.GetProperty("ok").GetBoolean() &&
        !healthDocument.RootElement.GetProperty("paired").GetBoolean() &&
        healthDocument.RootElement.GetProperty("version").GetString() == "9.8.7" &&
        Directory.Exists(Path.Combine(compositionRoot, "temp")) &&
        Directory.Exists(Path.Combine(compositionRoot, "cache", "files")),
        "composicao de runtime inicia /healthz em C#, usa versao do pacote e prepara diretórios locais sem pareamento");
    compositionCancellation.Cancel();
    await compositionTask.WaitAsync(TimeSpan.FromSeconds(3));
}
}
finally
{
    try { if (Directory.Exists(runtimeLoopRoot)) Directory.Delete(runtimeLoopRoot, recursive: true); } catch { }
}

Console.WriteLine($"C# runtime contract checks passed: {assertions}");
return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine($"C# runtime contract checks failed after {assertions} assertions: {error}");
    return 1;
}

static int GetFreePort()
{
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    return ((IPEndPoint)listener.LocalEndpoint).Port;
}

static async Task<string> ReadHttpHeadersAsync(Stream stream, CancellationToken cancellationToken)
{
    using var headers = new MemoryStream();
    var oneByte = new byte[1];
    var matched = 0;
    var terminator = new byte[] { 13, 10, 13, 10 };
    while (headers.Length < 16 * 1024)
    {
        if (await stream.ReadAsync(oneByte, cancellationToken) == 0)
            throw new EndOfStreamException("Conexao terminou antes dos cabecalhos HTTP.");
        headers.WriteByte(oneByte[0]);
        matched = oneByte[0] == terminator[matched] ? matched + 1 : oneByte[0] == terminator[0] ? 1 : 0;
        if (matched == terminator.Length) return Encoding.ASCII.GetString(headers.ToArray());
    }
    throw new InvalidDataException("Cabecalhos HTTP excederam limite de teste.");
}

static string ReadHttpHeader(string request, string name)
{
    foreach (var line in request.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Skip(1))
    {
        var separator = line.IndexOf(':');
        if (separator > 0 && string.Equals(line[..separator], name, StringComparison.OrdinalIgnoreCase))
            return line[(separator + 1)..].Trim();
    }
    return string.Empty;
}

static async Task WriteWebSocketTextFrameAsync(Stream stream, string message, CancellationToken cancellationToken)
{
    var payload = Encoding.UTF8.GetBytes(message);
    if (payload.Length >= 126) throw new ArgumentOutOfRangeException(nameof(message), "Quadro de teste deve usar tamanho curto.");
    var frame = new byte[payload.Length + 2];
    frame[0] = 0x81;
    frame[1] = checked((byte)payload.Length);
    payload.CopyTo(frame, 2);
    await stream.WriteAsync(frame, cancellationToken);
}

static async Task<int> RunOrcaLiveSmokeAsync(string executablePath)
{
    var configuredExecutable = OrcaSlicerService.ResolveConfiguredExecutable(new Dictionary<string, string?>());
    if (string.IsNullOrWhiteSpace(executablePath) || !string.Equals(Path.GetFullPath(executablePath), configuredExecutable, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("O resolver automático não encontrou o OrcaSlicer validado deste PC.");

    var root = Path.Combine(Path.GetTempPath(), "fila-agent-orca-smoke-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    var inputPath = Path.Combine(root, "local-test-cube.3mf");
    var outputPath = Path.Combine(root, "sliced", "local-test-cube.gcode");
    await using (var file = File.Create(inputPath))
    using (var archive = new ZipArchive(file, ZipArchiveMode.Create))
    {
        await WriteEntryAsync(archive, "[Content_Types].xml", """
            <?xml version="1.0" encoding="UTF-8"?>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
              <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
              <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
            </Types>
            """);
        await WriteEntryAsync(archive, "_rels/.rels", """
            <?xml version="1.0" encoding="UTF-8"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
            </Relationships>
            """);
        await WriteEntryAsync(archive, "3D/3dmodel.model", """
            <?xml version="1.0" encoding="UTF-8"?>
            <model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
              <resources>
                <object id="1" type="model" name="Fila Agent local smoke cube">
                  <mesh>
                    <vertices>
                      <vertex x="0" y="0" z="0" /><vertex x="20" y="0" z="0" />
                      <vertex x="20" y="20" z="0" /><vertex x="0" y="20" z="0" />
                      <vertex x="0" y="0" z="20" /><vertex x="20" y="0" z="20" />
                      <vertex x="20" y="20" z="20" /><vertex x="0" y="20" z="20" />
                    </vertices>
                    <triangles>
                      <triangle v1="0" v2="2" v3="1" /><triangle v1="0" v2="3" v3="2" />
                      <triangle v1="4" v2="5" v3="6" /><triangle v1="4" v2="6" v3="7" />
                      <triangle v1="0" v2="1" v3="5" /><triangle v1="0" v2="5" v3="4" />
                      <triangle v1="3" v2="7" v3="6" /><triangle v1="3" v2="6" v3="2" />
                      <triangle v1="0" v2="4" v3="7" /><triangle v1="0" v2="7" v3="3" />
                      <triangle v1="1" v2="2" v3="6" /><triangle v1="1" v2="6" v3="5" />
                    </triangles>
                  </mesh>
                </object>
              </resources>
              <build><item objectid="1" /></build>
            </model>
            """);
    }

    var result = await new OrcaSlicerService().SliceModelAsync(
        Path.GetFullPath(executablePath), inputPath, outputPath, "Bambu Lab", "P1S", timeout: TimeSpan.FromMinutes(5));
    if (result.Metrics.EstimatedPrintSeconds is null || result.Metrics.EstimatedFilamentMillimeters is null)
        throw new InvalidDataException("OrcaSlicer concluiu o fatiamento, mas as métricas de tempo ou filamento não foram lidas.");
    Console.WriteLine($"Local Orca smoke passed: version={result.Profile.Version}, triangles={result.Analysis.TriangleCount}, gcodeBytes={result.Artifact.SizeBytes}, sha256={result.Artifact.Sha256}");
    Console.WriteLine($"model={inputPath}");
    Console.WriteLine($"gcode={result.Artifact.OutputPath}");
    Console.WriteLine($"estimatedSeconds={result.Metrics.EstimatedPrintSeconds?.ToString(CultureInfo.InvariantCulture) ?? "n/a"}; filamentGrams={result.Metrics.EstimatedFilamentGrams?.ToString(CultureInfo.InvariantCulture) ?? "n/a"}; filamentMillimeters={result.Metrics.EstimatedFilamentMillimeters?.ToString(CultureInfo.InvariantCulture) ?? "n/a"}");
    return 0;

    static async Task WriteEntryAsync(ZipArchive archive, string name, string content)
    {
        var entry = archive.CreateEntry(name);
        await using var entryStream = entry.Open();
        await entryStream.WriteAsync(Encoding.UTF8.GetBytes(content));
    }
}

static HttpResponseMessage JsonResponse(string body) => new(HttpStatusCode.OK)
{
    Content = new StringContent(body, Encoding.UTF8, "application/json")
};

sealed class ContractHandler : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest { get; private set; }
    public string? LastBody { get; private set; }
    public int RequestCount { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestCount++;
        LastRequest = request;
        LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        var body = request.RequestUri?.AbsolutePath switch
        {
            "/api/agents/pair" => "{\"agentId\":\"agent-42\",\"agentSecret\":\"secret-from-api\",\"tenantId\":\"tenant-1\",\"tenantName\":\"Conta de teste\",\"machineName\":\"PC-TESTE\"}",
            "/api/agents/credential/rotate" => "{\"agentSecret\":\"rotated-test-secret\",\"credentialVersion\":2}",
            "/api/agents/credential/rotate/confirm" => "{\"credentialVersion\":2}",
            _ => "{\"ok\":true}"
        };
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }
}

sealed class RealtimeSseHandler(string responseBody) : HttpMessageHandler
{
    public string? LastPath { get; private set; }
    public string? LastAgentId { get; private set; }
    public string? LastAgentSecret { get; private set; }
    public string? LastAccept { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastPath = request.RequestUri?.AbsolutePath;
        LastAgentId = request.Headers.TryGetValues("x-agent-id", out var agentIds) ? agentIds.Single() : null;
        LastAgentSecret = request.Headers.TryGetValues("x-agent-secret", out var agentSecrets) ? agentSecrets.Single() : null;
        LastAccept = request.Headers.Accept.SingleOrDefault()?.MediaType;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(responseBody, Encoding.UTF8, "text/event-stream")
        });
    }
}

sealed class TestRealtimeNotificationClient : IAgentRealtimeNotificationClient
{
    private Action? _commandAvailable;
    private Action<string>? _modeChanged;
    public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public async Task RunAsync(AgentCredentials credentials, Action commandAvailable, Action<string> modeChanged,
        CancellationToken cancellationToken = default)
    {
        _commandAvailable = commandAvailable;
        _modeChanged = modeChanged;
        Started.TrySetResult();
        try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    public void NotifyCommandAvailable() => _commandAvailable?.Invoke();
    public void SetMode(string mode) => _modeChanged?.Invoke(mode);
}

sealed class PrintFileCloudHandler(byte[] fileBytes) : HttpMessageHandler
{
    public int DownloadCount { get; private set; }
    public int UploadCount { get; private set; }
    public int CompletionCount { get; private set; }
    public bool FailCommandCompletions { get; set; }
    public bool? LastCompletionSuccess { get; private set; }
    public string? LastCompletionBody { get; private set; }
    public long? LastRangeStart { get; private set; }
    public string? LastDownloadQuery { get; private set; }
    public string? LastAgentId { get; private set; }
    public string? LastAgentSecret { get; private set; }
    public string? LastProfileId { get; private set; }
    public string? LastIdempotencyKey { get; private set; }
    public string? LastFileName { get; private set; }
    public string? LastFileFormat { get; private set; }
    public byte[]? LastUploadBytes { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastAgentId = request.Headers.TryGetValues("x-agent-id", out var agentIds) ? agentIds.Single() : null;
        LastAgentSecret = request.Headers.TryGetValues("x-agent-secret", out var agentSecrets) ? agentSecrets.Single() : null;
        if (request.Method == HttpMethod.Get && request.RequestUri?.AbsolutePath == "/api/agents/print-file")
        {
            DownloadCount++;
            LastDownloadQuery = request.RequestUri.Query;
            LastRangeStart = request.Headers.Range?.Ranges.SingleOrDefault()?.From;
            if (LastRangeStart is { } offset)
            {
                if (offset >= fileBytes.LongLength)
                {
                    var unsatisfied = new HttpResponseMessage(HttpStatusCode.RequestedRangeNotSatisfiable);
                    unsatisfied.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(fileBytes.LongLength);
                    return unsatisfied;
                }
                var remainder = fileBytes.AsMemory(checked((int)offset)).ToArray();
                var partial = new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent(remainder) };
                partial.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(offset, fileBytes.LongLength - 1, fileBytes.LongLength);
                return partial;
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(fileBytes) };
        }

        if (request.Method == HttpMethod.Post && request.RequestUri?.AbsolutePath.EndsWith("/slicing-artifact", StringComparison.Ordinal) == true)
        {
            UploadCount++;
            LastFileName = request.Headers.TryGetValues("x-agent-file-name", out var fileNames) ? fileNames.Single() : null;
            LastFileFormat = request.Headers.TryGetValues("x-agent-file-format", out var formats) ? formats.Single() : null;
            LastProfileId = request.Headers.TryGetValues("x-agent-slicer-profile-id", out var profileIds) ? profileIds.Single() : null;
            LastIdempotencyKey = request.Headers.TryGetValues("x-agent-idempotency-key", out var idempotencyKeys) ? idempotencyKeys.Single() : null;
            LastUploadBytes = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"artifact\":{\"storageKey\":\"gcode/fixture\",\"sha256\":\"fixture-hash\"}}", Encoding.UTF8, "application/json")
            };
        }

        if (request.Method == HttpMethod.Post && request.RequestUri?.AbsolutePath.Contains("/commands/", StringComparison.Ordinal) == true &&
            request.RequestUri.AbsolutePath.EndsWith("/complete", StringComparison.Ordinal))
        {
            CompletionCount++;
            LastCompletionBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            if (LastCompletionBody is not null)
            {
                using var body = JsonDocument.Parse(LastCompletionBody);
                LastCompletionSuccess = body.RootElement.GetProperty("success").GetBoolean();
            }
            return new HttpResponseMessage(FailCommandCompletions ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK)
            {
                Content = new StringContent(FailCommandCompletions ? "{\"error\":\"fixture offline\"}" : "{\"ok\":true}", Encoding.UTF8, "application/json")
            };
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent("{\"error\":\"fixture route not found\"}", Encoding.UTF8, "application/json")
        };
    }
}

sealed class ReversibleTestProtector : IAgentDataProtector
{
    public byte[] Protect(byte[] plaintext) => Transform(plaintext);
    public byte[] Unprotect(byte[] protectedData) => Transform(protectedData);
    private static byte[] Transform(byte[] value) => value.Select(item => (byte)(item ^ 0x5A)).ToArray();
}

sealed class UnavailableDpapiTestProtector : IAgentDataProtector
{
    public byte[] Protect(byte[] plaintext) => throw new System.Security.Cryptography.CryptographicException("The data protection operation was unsuccessful because the user profile is not loaded.");
    public byte[] Unprotect(byte[] protectedData) => throw new System.Security.Cryptography.CryptographicException("The data protection operation was unsuccessful because the user profile is not loaded.");
}

sealed class FakeOrcaProcessRunner(bool writeOutput, string engineVersion = "2.4.2") : IExternalProcessRunner
{
    public int InvocationCount { get; private set; }
    public bool? LastUseShellExecute { get; private set; }
    public bool RequirePinnedInput { get; init; }
    public bool SourceWasPinnedDuringSlice { get; private set; }
    public string? LastOutputDirectory { get; private set; }
    public string? LastOutputSha256 { get; private set; }

    public async Task<OrcaProcessResult> RunAsync(System.Diagnostics.ProcessStartInfo startInfo, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        InvocationCount++;
        LastUseShellExecute = startInfo.UseShellExecute;
        SourceWasPinnedDuringSlice = File.Exists(startInfo.ArgumentList[0] + ".pin");
        if (RequirePinnedInput && !SourceWasPinnedDuringSlice) throw new InvalidOperationException("O arquivo de origem não estava fixado durante o slicing.");
        if (writeOutput)
        {
            var args = startInfo.ArgumentList.ToArray();
            var outputDirectory = args[Array.IndexOf(args, "--outputdir") + 1];
            var input = args[0];
            Directory.CreateDirectory(outputDirectory);
            LastOutputDirectory = outputDirectory;
            var generatedGcode = $"; generated by OrcaSlicer {engineVersion}\n; estimated printing time (normal mode) = 1h 2m 3s\n; total filament used [g] = 5.25\n; filament used [mm] = 1234.5\nG28\n";
            var exportIndex = Array.IndexOf(args, "--export-3mf");
            var generatedPath = exportIndex >= 0
                ? Path.Combine(outputDirectory, Path.GetFileName(args[exportIndex + 1]))
                : Path.Combine(outputDirectory, Path.ChangeExtension(Path.GetFileName(input), ".gcode"));
            if (exportIndex >= 0)
            {
                await using var packageStream = File.Create(generatedPath);
                using var package = new ZipArchive(packageStream, ZipArchiveMode.Create);
                var entry = package.CreateEntry("Metadata/plate_1.gcode");
                await using var entryStream = entry.Open();
                await entryStream.WriteAsync(Encoding.UTF8.GetBytes(generatedGcode), cancellationToken);
            }
            else await File.WriteAllTextAsync(generatedPath, generatedGcode, cancellationToken);
            LastOutputSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(await File.ReadAllBytesAsync(generatedPath, cancellationToken))).ToLowerInvariant();
        }
        return new OrcaProcessResult(0, "slice complete", string.Empty);
    }
}

sealed class FakeSerialPortCatalog(IReadOnlyList<SerialPortCandidate> ports) : ISerialPortCatalog
{
    public IReadOnlyList<SerialPortCandidate> ListPorts() => ports;
}

sealed class FakeMarlinFirmwareProbe(Func<string, int, string?> response) : IMarlinFirmwareProbe
{
    public List<(string Port, int BaudRate)> Attempts { get; } = [];

    public Task<string?> ReadFirmwareAsync(string port, int baudRate, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Attempts.Add((port, baudRate));
        return Task.FromResult(response(port, baudRate));
    }
}

sealed class FakeMarlinSerialChannelFactory : IMarlinSerialChannelFactory
{
    public List<FakeMarlinSerialChannel> Channels { get; } = [];

    public IMarlinSerialChannel Open(string port, int baudRate)
    {
        var channel = new FakeMarlinSerialChannel(port, baudRate);
        Channels.Add(channel);
        return channel;
    }
}

sealed class FakeMarlinSerialChannel(string port, int baudRate) : IMarlinSerialChannel
{
    private readonly TaskCompletionSource _releaseFirstPrintCommand = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _printCommandCount;
    public List<string> Commands { get; } = [];
    public List<string> RawCommands { get; } = [];
    public TaskCompletionSource FirstPrintCommandStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public bool IsOpen { get; private set; } = true;
    public string Port { get; } = port;
    public int BaudRate { get; } = baudRate;

    public async Task<IReadOnlyList<string>> SendCommandAsync(string command, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Commands.Add(command);
        if (command is "M105") return ["ok T:210.0 /220.0 B:60.0 /65.0"];
        if (command is "M114") return ["X:1.0 Y:2.0 Z:3.0", "ok"];
        if (command is "M115") return ["FIRMWARE_NAME:Marlin 2.1.2", "ok"];
        var printIndex = Interlocked.Increment(ref _printCommandCount);
        if (printIndex == 1)
        {
            FirstPrintCommandStarted.TrySetResult();
            await _releaseFirstPrintCommand.Task.WaitAsync(timeout, cancellationToken);
        }
        return ["ok"];
    }

    public Task WriteRawCommandAsync(string command, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        RawCommands.Add(command);
        return Task.CompletedTask;
    }

    public void ReleaseFirstPrintCommand() => _releaseFirstPrintCommand.TrySetResult();

    public ValueTask DisposeAsync()
    {
        IsOpen = false;
        return ValueTask.CompletedTask;
    }
}

sealed class FakePrinterPortConnectProbe(HashSet<int> openPorts, Func<string, bool>? hostFilter = null) : IPrinterPortConnectProbe
{
    public List<(string Host, int Port, TimeSpan Timeout)> Attempts { get; } = [];

    public Task<bool> IsOpenAsync(string host, int port, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Attempts.Add((host, port, timeout));
        return Task.FromResult(openPorts.Contains(port) && (hostFilter?.Invoke(host) ?? true));
    }
}

sealed class PrinterDiscoveryHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(respond(request));
    }
}

sealed record PrinterAdapterRequest(HttpMethod Method, Uri Uri, IReadOnlyDictionary<string, string> Headers, string Body)
{
    public string? GetHeader(string name) => Headers.TryGetValue(name, out var value) ? value : null;
}

sealed class PrinterAdapterHttpHandler(Func<PrinterAdapterRequest, HttpResponseMessage> respond) : HttpMessageHandler
{
    public ConcurrentQueue<PrinterAdapterRequest> Requests { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var headers = request.Headers.ToDictionary(header => header.Key, header => string.Join(",", header.Value), StringComparer.OrdinalIgnoreCase);
        if (request.Content is not null)
        {
            foreach (var header in request.Content.Headers) headers[header.Key] = string.Join(",", header.Value);
        }
        var snapshot = new PrinterAdapterRequest(request.Method, request.RequestUri ?? throw new InvalidOperationException("Request URI ausente."), headers,
            request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken));
        Requests.Enqueue(snapshot);
        return respond(snapshot);
    }
}

sealed class FakeBambuMqttClientFactory(Exception? connectError = null, List<string>? events = null) : IBambuMqttClientFactory
{
    public List<FakeBambuMqttClient> Clients { get; } = [];

    public IBambuMqttClient Create()
    {
        var client = new FakeBambuMqttClient(connectError, events);
        Clients.Add(client);
        return client;
    }
}

sealed class FakeBambuMqttClient(Exception? connectError, List<string>? events) : IBambuMqttClient
{
    public bool IsConnected { get; private set; }
    public bool Disposed { get; private set; }
    public BambuMqttConnectionOptions? Options { get; private set; }
    public List<(string Topic, int Qos)> Subscriptions { get; } = [];
    public List<(string Topic, string Payload, int Qos)> Published { get; } = [];
    public event Action<BambuMqttMessage>? MessageReceived;
    public event Action? Disconnected;

    public Task ConnectAsync(BambuMqttConnectionOptions options, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Options = options;
        if (connectError is not null) throw connectError;
        IsConnected = true;
        return Task.CompletedTask;
    }

    public Task SubscribeAsync(string topic, int qos, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Subscriptions.Add((topic, qos));
        return Task.CompletedTask;
    }

    public Task PublishAsync(string topic, string payload, int qos, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Published.Add((topic, payload, qos));
        events?.Add("publish");
        using var document = JsonDocument.Parse(payload);
        if (document.RootElement.TryGetProperty("pushing", out var pushing) && pushing.TryGetProperty("command", out var command) && command.GetString() == "pushall")
        {
            const string status = "{\"print\":{\"gcode_state\":\"RUNNING\",\"mc_percent\":34,\"mc_remaining_time\":18,\"print_time\":72,\"filament_used_g\":4.2,\"filament_used_mm\":1340,\"layer_num\":12,\"total_layer_num\":90,\"nozzle_temper\":211,\"nozzle_target_temper\":220,\"bed_temper\":61,\"bed_target_temper\":65,\"subtask_name\":\"fixture.3mf\"}}";
            MessageReceived?.Invoke(new BambuMqttMessage($"device/{Options!.Serial}/report", Encoding.UTF8.GetBytes(status)));
        }
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync()
    {
        IsConnected = false;
        Disposed = true;
        Disconnected?.Invoke();
        return ValueTask.CompletedTask;
    }
}

sealed record FakeBambuUpload(string Ip, string Serial, int Port, string AccessCode, string LocalPath, string RemotePath);

sealed class FakeBambuFtpsUploader(List<string> events) : IBambuFtpsUploader
{
    public List<FakeBambuUpload> Uploads { get; } = [];

    public Task UploadAsync(string ip, string serial, int port, string accessCode, string localPath, string remotePath, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Uploads.Add(new FakeBambuUpload(ip, serial, port, accessCode, localPath, remotePath));
        events.Add("upload");
        return Task.CompletedTask;
    }
}
