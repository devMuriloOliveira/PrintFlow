using System.Drawing;

namespace FilaAgent.Setup;

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

        var header = new Panel
        {
            BackColor = Color.FromArgb(239, 246, 255),
            Location = new Point(16, 14),
            Size = new Size(688, 138)
        };
        var titleLabel = new Label
        {
            Text = heading,
            Font = new Font("Segoe UI", 19F, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(18, 14),
            Size = new Size(650, 38)
        };
        var summaryLabel = new Label
        {
            Text = summary,
            ForeColor = Color.FromArgb(51, 65, 85),
            Location = new Point(21, 60),
            Size = new Size(640, 66)
        };
        header.Controls.AddRange([titleLabel, summaryLabel]);
        var termsLabel = new Label
        {
            Text = "Termos de Uso do Fila Agent — Early Access",
            Font = new Font("Segoe UI", 10F, FontStyle.Bold),
            ForeColor = Color.FromArgb(30, 41, 59),
            Location = new Point(31, 164),
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
            Location = new Point(30, 193),
            Size = new Size(658, 319),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom
        };
        var licenses = new Button
        {
            Text = "Licenças de terceiros",
            Location = new Point(31, 582),
            Size = new Size(170, 36),
            Anchor = AnchorStyles.Bottom | AnchorStyles.Left
        };
        licenses.Click += (_, _) =>
        {
            using var dialog = new ThirdPartyLicensesForm();
            dialog.ShowDialog(this);
        };
        _accept.Text = "Li e aceito os Termos de Uso do Fila Agent.";
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

        Controls.AddRange([header, termsLabel, termsBox, licenses, _accept, cancel, _continue]);
        AcceptButton = _continue;
        CancelButton = cancel;
    }

    public static bool ShowInstall(string? targetVersion, string installedVersion, string terms, bool termsPreviouslyAccepted)
    {
        var isUpdate = !string.IsNullOrWhiteSpace(installedVersion);
        var change = isUpdate ? $"Atualizar Fila Agent {installedVersion} para {targetVersion ?? "a nova versão"}" : $"Instalar Fila Agent {targetVersion ?? ""}";
        var summary = isUpdate
            ? "A versão atual será substituída após as verificações locais. Seu pareamento e os dados locais serão preservados. O Windows pode solicitar permissão para concluir a atualização."
            : "O Fila Agent inicia quando você entra no Windows, cria atalhos e aparece em Aplicativos instalados. Conecte-o pelo Filamind no navegador. O Windows pode solicitar permissão e, no Early Access, confirmação do certificado de teste.";
        using var dialog = new SetupConsentForm(isUpdate ? "Atualizar Fila Agent" : "Instalar Fila Agent", change, summary, terms);
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

internal sealed class ThirdPartyLicensesForm : Form
{
    public ThirdPartyLicensesForm()
    {
        Text = "Licenças de terceiros — Fila Agent";
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(720, 620);
        MinimumSize = new Size(720, 620);
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.FromArgb(248, 250, 252);

        var heading = new Label
        {
            Text = "Avisos e licenças de componentes incluídos",
            Font = new Font("Segoe UI", 16F, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(24, 18),
            Size = new Size(660, 34)
        };
        var selector = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Location = new Point(27, 65),
            Size = new Size(666, 30),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };
        var content = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            WordWrap = true,
            BackColor = Color.White,
            Font = new Font("Consolas", 9F),
            Location = new Point(27, 107),
            Size = new Size(666, 455),
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
        };
        var close = new Button
        {
            Text = "Fechar",
            DialogResult = DialogResult.OK,
            Location = new Point(581, 572),
            Size = new Size(112, 34),
            Anchor = AnchorStyles.Bottom | AnchorStyles.Right
        };
        selector.DisplayMember = nameof(LicenseDocument.Name);
        selector.DataSource = LoadDocuments();
        selector.SelectedIndexChanged += (_, _) =>
        {
            if (selector.SelectedItem is LicenseDocument document) content.Text = document.Content;
        };
        Controls.AddRange([heading, selector, content, close]);
        if (selector.SelectedItem is LicenseDocument initialDocument) content.Text = initialDocument.Content;
        AcceptButton = close;
        CancelButton = close;
    }

    private static List<LicenseDocument> LoadDocuments()
    {
        const string prefix = "FilaAgentSetup.ThirdParty.";
        var assembly = System.Reflection.Assembly.GetExecutingAssembly();
        return assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(prefix, StringComparison.Ordinal))
            .OrderBy(name => name, StringComparer.Ordinal)
            .Select(name =>
            {
                using var stream = assembly.GetManifestResourceStream(name)
                    ?? throw new InvalidDataException($"Recurso de licença ausente: {name}");
                using var reader = new StreamReader(stream);
                return new LicenseDocument(name[prefix.Length..], reader.ReadToEnd());
            })
            .ToList();
    }

    private sealed record LicenseDocument(string Name, string Content);
}

internal sealed class UninstallConsentForm : Form
{
    private readonly CheckBox _removeData = new();
    public bool RemoveUserData => _removeData.Checked;

    public UninstallConsentForm(string installedVersion)
    {
        Text = "Desinstalar Fila Agent";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(620, 370);
        MinimumSize = new Size(620, 370);
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.FromArgb(248, 250, 252);

        var heading = new Label
        {
            Text = "Desinstalar Fila Agent",
            Font = new Font("Segoe UI", 17F, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(28, 22),
            Size = new Size(560, 38)
        };
        var version = new Label
        {
            Text = $"Versão instalada: {installedVersion}",
            Font = new Font("Segoe UI Semibold", 9F),
            ForeColor = Color.FromArgb(71, 85, 105),
            Location = new Point(31, 66),
            Size = new Size(550, 24)
        };
        var details = new Label
        {
            Text = "O programa, a inicialização automática e os atalhos serão removidos.",
            ForeColor = Color.FromArgb(51, 65, 85),
            Location = new Point(31, 96),
            Size = new Size(550, 32)
        };
        var dataPanel = new Panel
        {
            BackColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Location = new Point(28, 140),
            Size = new Size(564, 150)
        };
        var dataHeading = new Label
        {
            Text = "Seus dados locais",
            Font = new Font("Segoe UI Semibold", 10F),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(16, 13),
            Size = new Size(520, 25)
        };
        var dataDescription = new Label
        {
            Text = "Por padrão, pareamento, credenciais protegidas, cache e logs são mantidos neste computador.",
            ForeColor = Color.FromArgb(71, 85, 105),
            Location = new Point(16, 42),
            Size = new Size(526, 42)
        };
        _removeData.Text = "Apagar também os dados locais padrão do Fila Agent";
        _removeData.Location = new Point(16, 98);
        _removeData.Size = new Size(526, 28);
        dataPanel.Controls.AddRange([dataHeading, dataDescription, _removeData]);
        var cancel = new Button { Text = "Manter instalação", DialogResult = DialogResult.Cancel, Location = new Point(332, 316), Size = new Size(128, 36) };
        var uninstall = new Button { Text = "Desinstalar", DialogResult = DialogResult.OK, Location = new Point(472, 316), Size = new Size(120, 36) };
        Controls.AddRange([heading, version, details, dataPanel, cancel, uninstall]);
        AcceptButton = uninstall;
        CancelButton = cancel;
    }
}
