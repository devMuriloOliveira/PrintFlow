using System.Diagnostics;
using System.Drawing;
using System.Net.Http.Json;
using FilaAgent.Runtime;
using System.Text.Json;

namespace FilaAgentHost;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (NativeDpapi.TryHandle(args)) return;
        if (NativeProtocol.TryHandle(args)) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new AgentApplicationContext(args));
    }
}

internal static class NativeDpapi
{
    public static bool TryHandle(string[] args)
    {
        var protect = args.Contains("--dpapi-protect", StringComparer.OrdinalIgnoreCase);
        var unprotect = args.Contains("--dpapi-unprotect", StringComparer.OrdinalIgnoreCase);
        if (!protect && !unprotect) return false;
        try
        {
            using var input = new MemoryStream();
            Console.OpenStandardInput().CopyTo(input);
            var bytes = Convert.FromBase64String(System.Text.Encoding.UTF8.GetString(input.ToArray()).Trim());
            var result = protect
                ? System.Security.Cryptography.ProtectedData.Protect(bytes, null, System.Security.Cryptography.DataProtectionScope.CurrentUser)
                : Unprotect(bytes);
            Console.Out.Write(Convert.ToBase64String(result));
            return true;
        }
        catch (Exception error) { Console.Error.Write(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; return true; }
    }

    private static byte[] Unprotect(byte[] bytes)
    {
        try { return System.Security.Cryptography.ProtectedData.Unprotect(bytes, null, System.Security.Cryptography.DataProtectionScope.CurrentUser); }
        catch (System.Security.Cryptography.CryptographicException) { return System.Security.Cryptography.ProtectedData.Unprotect(bytes, null, System.Security.Cryptography.DataProtectionScope.LocalMachine); }
    }
}

internal sealed class AgentApplicationContext : ApplicationContext
{
    private const string DefaultApiUrl = "https://printflow-api-4y5l.onrender.com";
    private readonly string _agentRoot;
    private readonly string _apiUrl;
    private readonly int _localPort;
    private readonly string? _dataDirectory;
    private readonly bool _testMode;
    private readonly string _version;
    private readonly string _logPath;
    private readonly Icon _icon;
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _statusMenuItem;
    private readonly System.Windows.Forms.Timer _monitorTimer;
    private readonly System.Windows.Forms.Timer _updateTimer;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly SemaphoreSlim _healthLock = new(1, 1);
    private Task? _runtimeTask;
    private CancellationTokenSource? _runtimeCancellation;
    private StatusForm? _statusForm;
    private bool _closing;
    private bool _checkingUpdate;

    public AgentApplicationContext(string[] args)
    {
        _agentRoot = ResolveAgentRoot();
        _apiUrl = ReadArgument(args, "--api-url") ?? DefaultApiUrl;
        _localPort = int.TryParse(ReadArgument(args, "--local-port"), out var port) && port is > 0 and < 65536 ? port : 17873;
        _dataDirectory = ReadArgument(args, "--data-dir");
        _testMode = args.Contains("--test-mode", StringComparer.OrdinalIgnoreCase);
        _version = ReadVersion();
        _logPath = Path.Combine(_agentRoot, "logs");
        Directory.CreateDirectory(_logPath);

        var iconPath = Path.Combine(_agentRoot, "assets", "fila-agent-icon.ico");
        _icon = File.Exists(iconPath) ? new Icon(iconPath) : SystemIcons.Application;

        var menu = new ContextMenuStrip();
        _statusMenuItem = new ToolStripMenuItem("Abrir status", null, (_, _) => ShowStatus());
        menu.Items.Add(_statusMenuItem);
        menu.Items.Add(new ToolStripMenuItem("Verificar atualizações", null, async (_, _) => await CheckForUpdatesAsync(manual: true)));
        menu.Items.Add(new ToolStripMenuItem("Abrir logs", null, (_, _) => OpenLogs()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Fechar Agent", null, (_, _) => ExitThread()));

        _notifyIcon = new NotifyIcon
        {
            Icon = _icon,
            Text = "Fila Agent - iniciando",
            Visible = true,
            ContextMenuStrip = menu
        };
        _notifyIcon.DoubleClick += (_, _) => ShowStatus();

        _monitorTimer = new System.Windows.Forms.Timer { Interval = 5_000 };
        _monitorTimer.Tick += async (_, _) => await MonitorAsync();
        _updateTimer = new System.Windows.Forms.Timer { Interval = 30_000 };
        _updateTimer.Tick += async (_, _) => await CheckForUpdatesAsync();

        try
        {
            StartAgentRuntime();
            _monitorTimer.Start();
            if (!_testMode) _updateTimer.Start();
        }
        catch (Exception error)
        {
            WriteLog($"Falha ao iniciar o Agent: {error.Message}");
            _notifyIcon.Text = "Fila Agent - erro ao iniciar";
            _notifyIcon.ShowBalloonTip(5_000, "Fila Agent", "Não foi possível iniciar o serviço local. Abra os logs para detalhes.", ToolTipIcon.Error);
            var exitTimer = new System.Windows.Forms.Timer { Interval = 3_000 };
            exitTimer.Tick += (_, _) =>
            {
                exitTimer.Stop();
                exitTimer.Dispose();
                Environment.ExitCode = 1;
                ExitThread();
            };
            exitTimer.Start();
        }
    }

    private static string? ReadArgument(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index += 1)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        }
        return null;
    }

    private static string ResolveAgentRoot()
    {
        var executableDirectory = Path.GetDirectoryName(Environment.ProcessPath ?? string.Empty);
        var candidates = new[] { executableDirectory, AppContext.BaseDirectory }
            .OfType<string>()
            .Where(directory => !string.IsNullOrWhiteSpace(directory))
            .SelectMany(GetAncestors)
            .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "package.json"))) return candidate;
        }

        throw new InvalidOperationException("Arquivos do Fila Agent não encontrados.");
    }

    private static IEnumerable<string> GetAncestors(string directory)
    {
        var current = new DirectoryInfo(directory);
        for (var depth = 0; current is not null && depth < 6; depth++, current = current.Parent)
            yield return current.FullName;
    }

    private string ReadVersion()
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(_agentRoot, "package.json")));
            return document.RootElement.GetProperty("version").GetString() ?? "0.0.0";
        }
        catch
        {
            return "0.0.0";
        }
    }

    private void StartAgentRuntime()
    {
        if (_closing || (_runtimeTask is not null && !_runtimeTask.IsCompleted)) return;
        _runtimeCancellation?.Dispose();
        _runtimeCancellation = new CancellationTokenSource();
        var values = Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string)
            .ToDictionary(entry => (string)entry.Key, entry => entry.Value?.ToString(), StringComparer.OrdinalIgnoreCase);
        values["FILA_AGENT_API_URL"] = _apiUrl;
        values["FILA_AGENT_ENVIRONMENT"] = _testMode ? "DEVELOPMENT" : "PRODUCTION";
        values["FILA_AGENT_LOCAL_PORT"] = _localPort.ToString(System.Globalization.CultureInfo.InvariantCulture);
        values["FILA_AGENT_LOG_DIR"] = _logPath;
        if (!string.IsNullOrWhiteSpace(_dataDirectory)) values["FILA_AGENT_DATA_DIR"] = _dataDirectory;
        var configuration = AgentConfiguration.FromEnvironment(values, _version);
        _runtimeTask = RunAgentRuntimeAsync(configuration, _runtimeCancellation.Token);
        WriteLog("Runtime C# iniciado.");
    }

    private async Task RunAgentRuntimeAsync(AgentConfiguration configuration, CancellationToken cancellationToken)
    {
        try
        {
            await using var runtime = new AgentRuntimeComposition(configuration, WriteLog);
            await runtime.RunAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            WriteLog($"Falha no runtime C#: {error.GetType().Name}: {error.Message}");
            throw;
        }
    }

    private async Task MonitorAsync()
    {
        if (_closing) return;
        try
        {
            if (_runtimeTask is null || _runtimeTask.IsCompleted) StartAgentRuntime();
            await RefreshStatusAsync();
        }
        catch (Exception error)
        {
            WriteLog($"Falha no monitoramento: {error.Message}");
        }
    }

    private async Task<AgentHealth?> GetHealthAsync()
    {
        if (!await _healthLock.WaitAsync(0)) return null;
        try
        {
            return await _httpClient.GetFromJsonAsync<AgentHealth>($"http://127.0.0.1:{_localPort}/healthz");
        }
        catch
        {
            return null;
        }
        finally
        {
            _healthLock.Release();
        }
    }

    private async Task RefreshStatusAsync()
    {
        var health = await GetHealthAsync();
        var status = AgentStatus.From(health, _version);
        _notifyIcon.Text = status.TrayText;
        _statusMenuItem.Text = status.MenuText;
        _statusForm?.UpdateStatus(status);
    }

    private void ShowStatus()
    {
        if (_statusForm is null || _statusForm.IsDisposed)
        {
            _statusForm = new StatusForm(_icon, _version, OpenLogs, async () => await CheckForUpdatesAsync(manual: true));
            _statusForm.FormClosing += (_, eventArgs) =>
            {
                if (!_closing)
                {
                    eventArgs.Cancel = true;
                    _statusForm.Hide();
                }
            };
        }

        _statusForm.Show();
        _statusForm.Activate();
        _ = RefreshStatusAsync();
    }

    private async Task CheckForUpdatesAsync(bool manual = false)
    {
        if (_closing || _checkingUpdate) return;
        _checkingUpdate = true;
        try
        {
            var setup = new[] { "FilaAgentSetup.exe", "PrintFlowAgentSetup.exe" }
                .Select(name => Path.Combine(_agentRoot, name))
                .FirstOrDefault(File.Exists);
            if (setup is null) return;
            if (!File.Exists(setup)) return;
            var startInfo = new ProcessStartInfo(setup) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = _agentRoot };
            startInfo.ArgumentList.Add("--check-updates");
            startInfo.ArgumentList.Add(manual ? "--interactive" : "--confirm-updates");
            startInfo.ArgumentList.Add("--install-dir");
            startInfo.ArgumentList.Add(_agentRoot);
            if (_dataDirectory is not null) startInfo.ArgumentList.Add("--test-mode");
            using var updateProcess = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Nao foi possivel iniciar a verificacao de atualizacao.");
            await updateProcess.WaitForExitAsync();
            _updateTimer.Interval = 6 * 60 * 60 * 1_000;
        }
        catch (Exception error)
        {
            WriteLog($"Falha ao iniciar verificação de atualização: {error.Message}");
        }
        finally
        {
            _checkingUpdate = false;
        }
        await Task.CompletedTask;
    }

    private void OpenLogs()
    {
        Process.Start(new ProcessStartInfo(_logPath) { UseShellExecute = true });
    }

    private void WriteLog(string message)
    {
        try { File.AppendAllText(Path.Combine(_logPath, "host.log"), $"{DateTime.UtcNow:o} {message}{Environment.NewLine}"); }
        catch { }
    }

    protected override void ExitThreadCore()
    {
        _closing = true;
        _monitorTimer.Stop();
        _updateTimer.Stop();
        _statusForm?.Close();
        _runtimeCancellation?.Cancel();
        try
        {
            if (_runtimeTask is not null) _runtimeTask.Wait(TimeSpan.FromSeconds(8));
        }
        catch (AggregateException error) { WriteLog($"Erro ao encerrar runtime C#: {error.GetBaseException().Message}"); }
        catch (Exception error) { WriteLog($"Erro ao aguardar encerramento do runtime C#: {error.Message}"); }
        if (_runtimeTask?.IsCompleted == true) _runtimeCancellation?.Dispose();
        _runtimeCancellation = null;
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _icon.Dispose();
        _httpClient.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed record AgentHealth(bool Ok, string? Version, bool Paired, bool CloudConnected, int ActivePrintJobs);

internal sealed record AgentStatus(string Badge, string Summary, string Version, string Account, string Cloud, string Production, Color BadgeColor, Color BadgeTextColor, string TrayText, string MenuText)
{
    public static AgentStatus From(AgentHealth? health, string fallbackVersion)
    {
        if (health is null)
        {
            return new("INDISPONÍVEL", "O serviço local ainda não respondeu. O Agent tentará reiniciar automaticamente.", $"v{fallbackVersion}", "Não foi possível verificar", "Sem resposta local", "Não foi possível verificar", Color.FromArgb(254, 226, 226), Color.FromArgb(185, 28, 28), "Fila Agent - indisponível", "Abrir status");
        }

        var version = $"v{health.Version ?? fallbackVersion}";
        var account = health.Paired ? "Conectado a uma conta" : "Aguardando conexão pelo site";
        var cloud = health.CloudConnected ? "Conectado ao Filamind" : "Tentando conectar";
        var production = health.ActivePrintJobs switch { 0 => "Nenhuma impressão ativa", 1 => "1 impressão ativa", _ => $"{health.ActivePrintJobs} impressões ativas" };

        if (!health.Paired) return new("AGUARDANDO CONEXÃO", "Abra o Filamind no navegador para conectar este computador à sua conta.", version, account, cloud, production, Color.FromArgb(254, 249, 195), Color.FromArgb(133, 77, 14), "Fila Agent - aguardando conexão", "Abrir status");
        if (!health.CloudConnected) return new("RECONECTANDO", "O Agent está aberto e tentando restabelecer a comunicação com o Filamind.", version, account, cloud, production, Color.FromArgb(255, 237, 213), Color.FromArgb(154, 52, 18), "Fila Agent - reconectando", "Abrir status");
        return new("ONLINE", "Este computador está pronto para receber comandos autorizados do Filamind.", version, account, cloud, production, Color.FromArgb(220, 252, 231), Color.FromArgb(21, 128, 61), "Fila Agent - online", "Abrir status");
    }
}

internal sealed class StatusForm : Form
{
    private readonly Label _badge = new();
    private readonly Label _summary = new();
    private readonly Label _version = new();
    private readonly Label _account = new();
    private readonly Label _cloud = new();
    private readonly Label _production = new();

    public StatusForm(Icon icon, string version, Action openLogs, Func<Task> checkUpdates)
    {
        Text = "Status do Fila Agent";
        Icon = icon;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        ClientSize = new Size(620, 430);
        BackColor = Color.FromArgb(248, 250, 252);
        Font = new Font("Segoe UI", 9);

        var title = new Label { Text = "Fila Agent", Font = new Font("Segoe UI", 22, FontStyle.Bold), ForeColor = Color.FromArgb(15, 23, 42), AutoSize = true, Location = new Point(32, 24) };
        var subtitle = new Label { Text = "Conector local do Filamind para impressoras 3D", ForeColor = Color.FromArgb(71, 85, 105), AutoSize = true, Location = new Point(36, 70) };
        _badge.TextAlign = ContentAlignment.MiddleCenter;
        _badge.Font = new Font("Segoe UI Semibold", 8);
        _badge.Location = new Point(454, 31);
        _badge.Size = new Size(132, 30);
        Controls.AddRange([title, subtitle, _badge]);

        var panel = new Panel { BackColor = Color.White, Location = new Point(36, 104), Size = new Size(548, 236) };
        _summary.Font = new Font("Segoe UI", 10);
        _summary.ForeColor = Color.FromArgb(51, 65, 85);
        _summary.Location = new Point(20, 18);
        _summary.Size = new Size(508, 42);
        panel.Controls.Add(_summary);
        AddRow(panel, "Versão instalada", 78, _version);
        AddRow(panel, "Conta", 116, _account);
        AddRow(panel, "Filamind Cloud", 154, _cloud);
        AddRow(panel, "Produção", 192, _production);
        Controls.Add(panel);

        var update = new Button { Text = "Verificar atualizações", FlatStyle = FlatStyle.Flat, Location = new Point(36, 364), Size = new Size(174, 36) };
        update.Click += async (_, _) => await checkUpdates();
        var logs = new Button { Text = "Abrir logs", FlatStyle = FlatStyle.Flat, Location = new Point(220, 364), Size = new Size(120, 36) };
        logs.Click += (_, _) => openLogs();
        var close = new Button { Text = "Fechar", Location = new Point(464, 364), Size = new Size(120, 36) };
        close.Click += (_, _) => Hide();
        Controls.AddRange([update, logs, close]);
        UpdateStatus(AgentStatus.From(null, version));
    }

    private static void AddRow(Control parent, string labelText, int y, Label value)
    {
        var label = new Label { Text = labelText, ForeColor = Color.FromArgb(100, 116, 139), Location = new Point(20, y), Size = new Size(150, 22) };
        value.TextAlign = ContentAlignment.MiddleRight;
        value.Font = new Font("Segoe UI Semibold", 9);
        value.ForeColor = Color.FromArgb(15, 23, 42);
        value.Location = new Point(178, y - 3);
        value.Size = new Size(350, 25);
        parent.Controls.AddRange([label, value]);
    }

    public void UpdateStatus(AgentStatus status)
    {
        if (IsDisposed) return;
        _badge.Text = status.Badge;
        _badge.BackColor = status.BadgeColor;
        _badge.ForeColor = status.BadgeTextColor;
        _summary.Text = status.Summary;
        _version.Text = status.Version;
        _account.Text = status.Account;
        _cloud.Text = status.Cloud;
        _production.Text = status.Production;
    }
}
