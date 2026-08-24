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
$form.ClientSize = [System.Drawing.Size]::new(520, 300)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)

if (Test-Path $iconPath) {
  $form.Icon = [System.Drawing.Icon]::new($iconPath)
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "PrintFlow Agent"
$title.Font = [System.Drawing.Font]::new("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$title.AutoSize = $true
$title.Location = [System.Drawing.Point]::new(32, 28)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Instalando o conector local das impressoras 3D."
$subtitle.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$subtitle.AutoSize = $true
$subtitle.Location = [System.Drawing.Point]::new(36, 74)
$form.Controls.Add($subtitle)

$panel = New-Object System.Windows.Forms.Panel
$panel.BackColor = [System.Drawing.Color]::White
$panel.BorderStyle = "FixedSingle"
$panel.Location = [System.Drawing.Point]::new(36, 112)
$panel.Size = [System.Drawing.Size]::new(448, 104)
$form.Controls.Add($panel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Preparando instalacao..."
$statusLabel.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$statusLabel.AutoSize = $false
$statusLabel.Location = [System.Drawing.Point]::new(18, 18)
$statusLabel.Size = [System.Drawing.Size]::new(410, 24)
$panel.Controls.Add($statusLabel)

$detailLabel = New-Object System.Windows.Forms.Label
$detailLabel.Text = "O Agent sera iniciado em segundo plano e aparecera na bandeja do Windows."
$detailLabel.Font = [System.Drawing.Font]::new("Segoe UI", 8)
$detailLabel.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
$detailLabel.AutoSize = $false
$detailLabel.Location = [System.Drawing.Point]::new(18, 46)
$detailLabel.Size = [System.Drawing.Size]::new(410, 20)
$panel.Controls.Add($detailLabel)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 24
$progress.Location = [System.Drawing.Point]::new(18, 72)
$progress.Size = [System.Drawing.Size]::new(410, 12)
$panel.Controls.Add($progress)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = "Instalando..."
$closeButton.Enabled = $false
$closeButton.Width = 132
$closeButton.Height = 36
$closeButton.Location = [System.Drawing.Point]::new(352, 238)
$closeButton.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$closeButton.ForeColor = [System.Drawing.Color]::White
$closeButton.FlatStyle = "Flat"
$closeButton.FlatAppearance.BorderSize = 0
$closeButton.Add_Click({
  $form.Close()
})
$form.Controls.Add($closeButton)

function Set-InstallerStatus {
  param(
    [string]$Message,
    [string]$Detail = ""
  )

  $statusLabel.Text = $Message

  if ($Detail) {
    $detailLabel.Text = $Detail
  }

  $form.Refresh()
  [System.Windows.Forms.Application]::DoEvents()
}

function Complete-Installer {
  param(
    [string]$Message,
    [string]$Detail,
    [bool]$Success
  )

  $progress.MarqueeAnimationSpeed = 0
  $progress.Style = "Continuous"
  $progress.Value = if ($Success) { 100 } else { 0 }
  $statusLabel.Text = $Message
  $detailLabel.Text = $Detail
  $closeButton.Text = "Concluir"
  $closeButton.Enabled = $true

  if (-not $Success) {
    $closeButton.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
  }
}

$form.Add_Shown({
  try {
    if (-not (Test-Path $zipPath)) {
      throw "Pacote PrintFlow-Agent-Windows.zip nao encontrado."
    }

    Set-InstallerStatus `
      -Message "Extraindo arquivos..." `
      -Detail "Preparando o PrintFlow Agent neste computador."

    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

    $installScript = Join-Path $extractRoot "scripts\install-windows-agent.ps1"

    if (-not (Test-Path $installScript)) {
      throw "Instalador interno do PrintFlow Agent nao encontrado."
    }

    Set-InstallerStatus `
      -Message "Instalando no Windows..." `
      -Detail "Criando atalhos, inicializacao automatica e protocolo printflow-agent://."

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
      -Message "PrintFlow Agent instalado." `
      -Detail "O Agent ja foi iniciado e deve aparecer na bandeja do Windows." `
      -Success $true
  } catch {
    Complete-Installer `
      -Message "Nao foi possivel instalar." `
      -Detail $_.Exception.Message `
      -Success $false
  } finally {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
