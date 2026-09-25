param(
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$PackageVersion = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$packageRoot = $PSScriptRoot
$zipPath = Join-Path $packageRoot "PrintFlow-Agent-Windows.zip"
$iconPath = Join-Path $packageRoot "printflow-agent-icon.ico"
$installRoot = Join-Path $env:LOCALAPPDATA "PrintFlowAgent"
$extractRoot = Join-Path $env:TEMP ("PrintFlowAgentSetup-" + [guid]::NewGuid().ToString("N"))
$script:InstallerSucceeded = $false
$script:InstallAttempted = $false
$script:InstallerForm = $null

$existingVersion = ""
$existingPackagePath = Join-Path $installRoot "package.json"
if (Test-Path -LiteralPath $existingPackagePath) {
  try {
    $existingVersion = [string]((Get-Content -LiteralPath $existingPackagePath -Raw | ConvertFrom-Json).version)
  } catch {
    $existingVersion = "instalada"
  }
}

$isUpgrade = [bool]$existingVersion
$operationName = if ($isUpgrade) { "Atualizacao" } else { "Instalacao" }
$actionLabel = if ($isUpgrade) { "Atualizar" } else { "Instalar" }

$form = New-Object System.Windows.Forms.Form
$script:InstallerForm = $form
$form.Text = "$operationName do PrintFlow Agent"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = [System.Drawing.Size]::new(640, 520)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$form.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi

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
$subtitle.Text = if ($isUpgrade) { "Atualize o conector local com seguranca" } else { "Conector local para impressoras 3D" }
$subtitle.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$subtitle.AutoSize = $true
$subtitle.Location = [System.Drawing.Point]::new(38, 78)
$form.Controls.Add($subtitle)

$infoPanel = New-Object System.Windows.Forms.Panel
$infoPanel.BackColor = [System.Drawing.Color]::White
$infoPanel.BorderStyle = "None"
$infoPanel.Location = [System.Drawing.Point]::new(38, 112)
$infoPanel.Size = [System.Drawing.Size]::new(564, 258)
$form.Controls.Add($infoPanel)

$infoTitle = New-Object System.Windows.Forms.Label
$infoTitle.Text = "Resumo da $($operationName.ToLowerInvariant())"
$infoTitle.Font = [System.Drawing.Font]::new("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$infoTitle.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$infoTitle.AutoSize = $true
$infoTitle.Location = [System.Drawing.Point]::new(18, 16)
$infoPanel.Controls.Add($infoTitle)

$termsBox = New-Object System.Windows.Forms.TextBox
$termsBox.Multiline = $true
$termsBox.ReadOnly = $true
$termsBox.ScrollBars = "Vertical"
$termsBox.BorderStyle = "None"
$termsBox.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$termsBox.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$termsBox.BackColor = [System.Drawing.Color]::White
$termsBox.Location = [System.Drawing.Point]::new(18, 46)
$termsBox.Size = [System.Drawing.Size]::new(526, 188)
$currentVersionText = if ($existingVersion) { $existingVersion } else { "Nao instalado" }
$targetVersionText = if ($PackageVersion) { $PackageVersion } else { "Versao do pacote" }
$termsBox.Text = @"
Versao atual: $currentVersionText
Versao a instalar: $targetVersionText
Arquitetura: Windows x64
Destino: $installRoot

O Agent encontra impressoras 3D na rede local ou USB e conecta este computador a conta PrintFlow pareada. Ele recebe somente comandos autorizados pelo PrintFlow e fica disponivel na bandeja do Windows.

Configuracao no Windows:
- Inicia automaticamente quando este usuario entrar no Windows.
- Cria atalhos e registra o protocolo printflow-agent://.
- Usa o runtime Node.js incluido; nao exige Node.js instalado separadamente.
- Mantem pareamento, credenciais protegidas e historico local durante atualizacoes.
- Comunica-se com: $ApiUrl

O Agent nao procura documentos pessoais. Arquivos de impressao autorizados ficam no cache operacional local e podem ser removidos pelo desinstalador.
"@
$infoPanel.Controls.Add($termsBox)

$acceptCheck = New-Object System.Windows.Forms.CheckBox
$acceptCheck.Text = "Entendi as informacoes e quero $($actionLabel.ToLowerInvariant()) o PrintFlow Agent."
$acceptCheck.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$acceptCheck.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$acceptCheck.AutoSize = $true
$acceptCheck.Location = [System.Drawing.Point]::new(38, 386)
$form.Controls.Add($acceptCheck)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.BackColor = [System.Drawing.Color]::FromArgb(239, 246, 255)
$statusPanel.BorderStyle = "None"
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
$progress.Style = "Continuous"
$progress.MarqueeAnimationSpeed = 0
$progress.Minimum = 0
$progress.Maximum = 100
$progress.Value = 0
$progress.Location = [System.Drawing.Point]::new(14, 30)
$progress.Size = [System.Drawing.Size]::new(532, 8)
$statusPanel.Controls.Add($progress)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "Cancelar"
$cancelButton.Width = 110
$cancelButton.Height = 36
$cancelButton.Location = [System.Drawing.Point]::new(370, 476)
$cancelButton.FlatStyle = "Flat"
$cancelButton.BackColor = [System.Drawing.Color]::White
$cancelButton.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$cancelButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$cancelButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$cancelButton.Add_Click({
  $form.Close()
})
$form.Controls.Add($cancelButton)

$installButton = New-Object System.Windows.Forms.Button
$installButton.Text = $actionLabel
$installButton.Enabled = $false
$installButton.Width = 122
$installButton.Height = 36
$installButton.Location = [System.Drawing.Point]::new(490, 476)
$installButton.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$installButton.ForeColor = [System.Drawing.Color]::White
$installButton.FlatStyle = "Flat"
$installButton.FlatAppearance.BorderSize = 0
$installButton.Cursor = [System.Windows.Forms.Cursors]::Hand
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

function Set-InstallerProgress {
  param(
    [int]$Value,
    [string]$Message = ""
  )

  if ($Value -lt $progress.Minimum) {
    $Value = $progress.Minimum
  }

  if ($Value -gt $progress.Maximum) {
    $Value = $progress.Maximum
  }

  if ($Message) {
    $statusLabel.Text = $Message
  }

  $progress.Value = $Value
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
  $installButton.Text = if ($Success) { "Concluir" } else { "Fechar" }
  $installButton.Enabled = $true
  $cancelButton.Visible = $false

  if (-not $Success) {
    $installButton.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
    $script:InstallerSucceeded = $false
  }

  if ($Success) {
    $script:InstallerSucceeded = $true
    $closeTimer = New-Object System.Windows.Forms.Timer
    $closeTimer.Interval = 1200
    $closeTimer.Add_Tick({
      param($sender, $eventArgs)

      try {
        if ($sender) {
          $sender.Stop()
          $sender.Dispose()
        }

        if ($script:InstallerForm -and -not $script:InstallerForm.IsDisposed) {
          $script:InstallerForm.Close()
        }
      } catch {
      }
    })
    $closeTimer.Start()
  }
}

function Start-Install {
  try {
    $script:InstallAttempted = $true
    $acceptCheck.Enabled = $false
    $installButton.Enabled = $false
    $cancelButton.Enabled = $false
    $installButton.Text = if ($isUpgrade) { "Atualizando..." } else { "Instalando..." }
    $statusPanel.Visible = $true
    $progress.Style = "Continuous"
    $progress.MarqueeAnimationSpeed = 0
    $progress.Value = 0

    if (-not (Test-Path $zipPath)) {
      throw "Pacote PrintFlow-Agent-Windows.zip nao encontrado."
    }

    Set-InstallerProgress 10 "Preparando arquivos do PrintFlow Agent..."

    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Set-InstallerProgress 25 "Extraindo pacote local..."
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractRoot)

    $installScript = Join-Path $extractRoot "scripts\install-windows-agent.ps1"

    if (-not (Test-Path $installScript)) {
      throw "Instalador interno do PrintFlow Agent nao encontrado."
    }

    Set-InstallerProgress 55 "Registrando atalhos e protocolo local..."
    & $installScript -ApiUrl $ApiUrl

    Set-InstallerProgress 90 "Iniciando Agent em segundo plano..."

    Complete-Installer `
      -Message "PrintFlow Agent $targetVersionText pronto. Ele deve aparecer na bandeja do Windows." `
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
  if ($installButton.Text -eq "Concluir" -or $installButton.Text -eq "Fechar") {
    $form.Close()
    return
  }

  Start-Install
})

[System.Windows.Forms.Application]::Run($form)

if ($script:InstallAttempted -and -not $script:InstallerSucceeded) {
  exit 1
}
