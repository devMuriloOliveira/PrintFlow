using System.Drawing;

namespace PrintFlowAgentSetup;

internal sealed class SetupConsentForm : Form
{
    private readonly CheckBox _accept = new();
    private readonly Button _continue = new();

    private SetupConsentForm(string title, string heading, string summary, string terms)
    {
        Text = title;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        ClientSize = new Size(720, 650);
        MinimumSize = new Size(720, 650);
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.FromArgb(248, 250, 252);

        var titleLabel = new Label
        {
            Text = heading,
            Font = new Font("Segoe UI", 19F, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(28, 20),
            Size = new Size(660, 38)
        };
        var summaryLabel = new Label
        {
            Text = summary,
            ForeColor = Color.FromArgb(51, 65, 85),
            Location = new Point(31, 66),
            Size = new Size(656, 86)
        };
        var termsLabel = new Label
        {
            Text = "Termos de Uso do PrintFlow Agent — Early Access",
            Font = new Font("Segoe UI", 10F, FontStyle.Bold),
            ForeColor = Color.FromArgb(30, 41, 59),
            Location = new Point(31, 158),
            Size = new Size(650, 24)
        };
        var termsBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            WordWrap = true,
            BackColor = Color.White,
            Font = new Font("Segoe UI", 9F),
            Text = terms,
            Location = new Point(30, 187),
            Size = new Size(658, 325),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom
        };
        _accept.Text = "Li e aceito os Termos de Uso do PrintFlow Agent.";
        _accept.Location = new Point(31, 525);
        _accept.Size = new Size(650, 26);
        _accept.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
        _accept.CheckedChanged += (_, _) => _continue.Enabled = _accept.Checked;

        var cancel = new Button
        {
            Text = "Cancelar",
            DialogResult = DialogResult.Cancel,
            Location = new Point(442, 582),
            Size = new Size(112, 36),
            Anchor = AnchorStyles.Bottom | AnchorStyles.Right
        };
        _continue.Text = "Aceitar e continuar";
        _continue.Enabled = false;
        _continue.DialogResult = DialogResult.OK;
        _continue.Location = new Point(565, 582);
        _continue.Size = new Size(123, 36);
        _continue.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;

        Controls.AddRange([titleLabel, summaryLabel, termsLabel, termsBox, _accept, cancel, _continue]);
        AcceptButton = _continue;
        CancelButton = cancel;
    }

    public static bool ShowInstall(string? targetVersion, string installedVersion, string terms, bool termsPreviouslyAccepted)
    {
        var isUpdate = !string.IsNullOrWhiteSpace(installedVersion);
        var change = isUpdate ? $"Atualizar PrintFlow Agent {installedVersion} para {targetVersion ?? "a nova versão"}" : $"Instalar PrintFlow Agent {targetVersion ?? ""}";
        var summary = change + Environment.NewLine +
            "O Agent inicia quando você entra no Windows, cria atalhos e aparece em Aplicativos Instalados para desinstalação. " +
            "O Agent verifica atualizações e pede confirmação antes de aplicá-las. Pareamento e dados locais existentes são preservados." + Environment.NewLine +
            "O Windows solicitará permissão para concluir a instalação. No Early Access, também será apresentada a confirmação separada do certificado de teste.";
        using var dialog = new SetupConsentForm(isUpdate ? "Atualizar PrintFlow Agent" : "Instalar PrintFlow Agent", change, summary, terms);
        dialog._accept.Checked = termsPreviouslyAccepted;
        return dialog.ShowDialog() == DialogResult.OK;
    }

    public static bool ShowUninstall(string installedVersion, out bool removeUserData)
    {
        removeUserData = false;
        using var dialog = new UninstallConsentForm(installedVersion);
        if (dialog.ShowDialog() != DialogResult.OK) return false;
        removeUserData = dialog.RemoveUserData;
        return true;
    }
}

internal sealed class UninstallConsentForm : Form
{
    private readonly CheckBox _removeData = new();
    public bool RemoveUserData => _removeData.Checked;

    public UninstallConsentForm(string installedVersion)
    {
        Text = "Desinstalar PrintFlow Agent";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(520, 260);
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.FromArgb(248, 250, 252);

        var heading = new Label
        {
            Text = "Desinstalar PrintFlow Agent",
            Font = new Font("Segoe UI", 17F, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(25, 20),
            Size = new Size(470, 36)
        };
        var details = new Label
        {
            Text = $"Versão instalada: {installedVersion}\nO programa, a tarefa de inicialização e os atalhos serão removidos. Por padrão, pareamento, credenciais e arquivos locais serão preservados.",
            ForeColor = Color.FromArgb(51, 65, 85),
            Location = new Point(28, 69),
            Size = new Size(460, 72)
        };
        _removeData.Text = "Também apagar pareamento, credenciais, cache e logs locais";
        _removeData.Location = new Point(28, 151);
        _removeData.Size = new Size(460, 27);
        var cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Location = new Point(258, 201), Size = new Size(100, 34) };
        var uninstall = new Button { Text = "Desinstalar", DialogResult = DialogResult.OK, Location = new Point(371, 201), Size = new Size(117, 34) };
        Controls.AddRange([heading, details, _removeData, cancel, uninstall]);
        AcceptButton = uninstall;
        CancelButton = cancel;
    }
}
