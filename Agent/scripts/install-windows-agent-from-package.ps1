param(
  [string]$ApiUrl = "http://localhost:3333"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$packageRoot = $PSScriptRoot
$zipPath = Join-Path $packageRoot "PrintFlow-Agent-Windows.zip"
$iconPath = Join-Path $packageRoot "printflow-agent-icon.ico"
$extractRoot = Join-Path $env:TEMP ("PrintFlowAgentSetup-" + [guid]::NewGuid().ToString("N"))

$form = New-Object System.Windows.Forms.Form
$form.Text = "PrintFlow Agent Setup"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = [System.Drawing.Size]::new(640, 520)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)

if (Test-Path $iconPath) {
  $form.Icon = [System.Drawing.Icon]::new($iconPath)
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "PrintFlow Agent"
$title.Font = [System.Drawing.Font]::new("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$title.AutoSize = $true
$title.Location = [System.Drawing.Point]::new(34, 28)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Conector local para impressoras 3D"
$subtitle.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$subtitle.AutoSize = $true
$subtitle.Location = [System.Drawing.Point]::new(38, 78)
$form.Controls.Add($subtitle)

$infoPanel = New-Object System.Windows.Forms.Panel
$infoPanel.BackColor = [System.Drawing.Color]::White
$infoPanel.BorderStyle = "FixedSingle"
$infoPanel.Location = [System.Drawing.Point]::new(38, 112)
$infoPanel.Size = [System.Drawing.Size]::new(564, 258)
$form.Controls.Add($infoPanel)

$infoTitle = New-Object System.Windows.Forms.Label
$infoTitle.Text = "Antes de instalar"
$infoTitle.Font = [System.Drawing.Font]::new("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$infoTitle.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$infoTitle.AutoSize = $true
$infoTitle.Location = [System.Drawing.Point]::new(18, 16)
$infoPanel.Controls.Add($infoTitle)

$termsBox = New-Object System.Windows.Forms.TextBox
$termsBox.Multiline = $true
$termsBox.ReadOnly = $true
$termsBox.ScrollBars = "Vertical"
$termsBox.BorderStyle = "FixedSingle"
$termsBox.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$termsBox.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$termsBox.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$termsBox.Location = [System.Drawing.Point]::new(18, 46)
$termsBox.Size = [System.Drawing.Size]::new(526, 188)
$termsBox.Text = @"
O PrintFlow Agent e um aplicativo local do PrintFlow 3D.

O que ele faz:
- Encontra impressoras 3D na rede local e em portas USB deste computador.
- Conecta este computador a conta PrintFlow autorizada pelo site.
- Recebe comandos do PrintFlow para consultar status, conectar impressoras e iniciar/pausar/cancelar impressoes quando configurado.
- Baixa arquivos de impressao autorizados pelo PrintFlow para enviar a impressora selecionada.
- Fica em segundo plano e aparece na bandeja do Windows.

Dados e seguranca:
- O Agent nao acessa arquivos pessoais do usuario.
- O Agent guarda credenciais locais apenas para manter a conexao com a conta autorizada.
- As credenciais de impressoras ficam isoladas neste computador.
- Cada conta PrintFlow usa pareamento proprio para evitar mistura de dados entre clientes.
- O Agent se comunica com a API configurada: $ApiUrl

Ao continuar, voce autoriza a instalacao do Agent neste Windows, a criacao de atalhos, inicializacao no login e registro do protocolo printflow-agent://.
"@
$infoPanel.Controls.Add($termsBox)

$acceptCheck = New-Object System.Windows.Forms.CheckBox
$acceptCheck.Text = "Li e aceito instalar o PrintFlow Agent neste computador."
$acceptCheck.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$acceptCheck.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$acceptCheck.AutoSize = $true
$acceptCheck.Location = [System.Drawing.Point]::new(38, 386)
$form.Controls.Add($acceptCheck)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.BackColor = [System.Drawing.Color]::White
$statusPanel.BorderStyle = "FixedSingle"
$statusPanel.Location = [System.Drawing.Point]::new(38, 416)
$statusPanel.Size = [System.Drawing.Size]::new(564, 50)
$statusPanel.Visible = $false
$form.Controls.Add($statusPanel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Preparando instalacao..."
$statusLabel.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$statusLabel.AutoSize = $false
$statusLabel.Location = [System.Drawing.Point]::new(14, 8)
$statusLabel.Size = [System.Drawing.Size]::new(532, 18)
$statusPanel.Controls.Add($statusLabel)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 0
$progress.Location = [System.Drawing.Point]::new(14, 30)
$progress.Size = [System.Drawing.Size]::new(532, 8)
$statusPanel.Controls.Add($progress)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "Cancelar"
$cancelButton.Width = 110
$cancelButton.Height = 36
$cancelButton.Location = [System.Drawing.Point]::new(370, 476)
$cancelButton.FlatStyle = "Flat"
$cancelButton.Add_Click({
  $form.Close()
})
$form.Controls.Add($cancelButton)

$installButton = New-Object System.Windows.Forms.Button
$installButton.Text = "Instalar"
$installButton.Enabled = $false
$installButton.Width = 122
$installButton.Height = 36
$installButton.Location = [System.Drawing.Point]::new(490, 476)
$installButton.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$installButton.ForeColor = [System.Drawing.Color]::White
$installButton.FlatStyle = "Flat"
$installButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($installButton)

$acceptCheck.Add_CheckedChanged({
  $installButton.Enabled = $acceptCheck.Checked
})

function Set-InstallerStatus {
  param(
    [string]$Message
  )

  $statusLabel.Text = $Message
  $form.Refresh()
  [System.Windows.Forms.Application]::DoEvents()
}

function Complete-Installer {
  param(
    [string]$Message,
    [bool]$Success
  )

  $progress.MarqueeAnimationSpeed = 0
  $progress.Style = "Continuous"
  $progress.Value = if ($Success) { 100 } else { 0 }
  $statusLabel.Text = $Message
  $installButton.Text = "Concluir"
  $installButton.Enabled = $true
  $cancelButton.Visible = $false

  if (-not $Success) {
    $installButton.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
  }

  if ($Success) {
    $closeTimer = New-Object System.Windows.Forms.Timer
    $closeTimer.Interval = 1200
    $closeTimer.Add_Tick({
      $closeTimer.Stop()
      $closeTimer.Dispose()
      $form.Close()
    })
    $closeTimer.Start()
  }
}

function Start-Install {
  try {
    $acceptCheck.Enabled = $false
    $installButton.Enabled = $false
    $cancelButton.Enabled = $false
    $installButton.Text = "Instalando..."
    $statusPanel.Visible = $true
    $progress.Style = "Marquee"
    $progress.MarqueeAnimationSpeed = 24

    if (-not (Test-Path $zipPath)) {
      throw "Pacote PrintFlow-Agent-Windows.zip nao encontrado."
    }

    Set-InstallerStatus "Extraindo arquivos do PrintFlow Agent..."

    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

    $installScript = Join-Path $extractRoot "scripts\install-windows-agent.ps1"

    if (-not (Test-Path $installScript)) {
      throw "Instalador interno do PrintFlow Agent nao encontrado."
    }

    Set-InstallerStatus "Registrando atalhos, inicializacao e protocolo local..."

    $process = Start-Process `
      -FilePath "powershell.exe" `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installScript`" -ApiUrl `"$ApiUrl`"" `
      -WindowStyle Hidden `
      -Wait `
      -PassThru

    if ($process.ExitCode -ne 0) {
      throw "A instalacao retornou erro $($process.ExitCode)."
    }

    Complete-Installer `
      -Message "PrintFlow Agent instalado. Ele deve aparecer na bandeja do Windows." `
      -Success $true
  } catch {
    Complete-Installer `
      -Message ("Nao foi possivel instalar: " + $_.Exception.Message) `
      -Success $false
  } finally {
    $cancelButton.Enabled = $true
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$installButton.Add_Click({
  if ($installButton.Text -eq "Concluir") {
    $form.Close()
    return
  }

  Start-Install
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
