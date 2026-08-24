param(
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$TaskName = "PrintFlowAgent",
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$installRoot = [System.IO.Path]::GetFullPath($InstallDir)
$iconPath = Join-Path $installRoot "assets\printflow-agent-icon.ico"

function Invoke-AgentUninstall {
  param(
    [scriptblock]$StatusCallback = {}
  )

  & $StatusCallback "Removendo inicializacao automatica..."

  if (Test-Path (Join-Path $installRoot "scripts\uninstall-windows-startup.ps1")) {
    & (Join-Path $installRoot "scripts\uninstall-windows-startup.ps1") -TaskName $TaskName
  }

  & $StatusCallback "Encerrando o PrintFlow Agent..."

  try {
    $escapedInstallRoot = [regex]::Escape($installRoot)
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -and
        $_.CommandLine -match $escapedInstallRoot
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {
  }

  & $StatusCallback "Removendo atalhos..."

  $desktopShortcut = Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "PrintFlow Agent.lnk"
  $startMenuFolder = Join-Path ([Environment]::GetFolderPath("Programs")) "PrintFlow 3D"
  $startMenuShortcut = Join-Path $startMenuFolder "PrintFlow Agent.lnk"
  $uninstallShortcut = Join-Path $startMenuFolder "Desinstalar PrintFlow Agent.lnk"

  foreach ($shortcut in @($desktopShortcut, $startMenuShortcut, $uninstallShortcut)) {
    if (Test-Path $shortcut) {
      Remove-Item -LiteralPath $shortcut -Force
    }
  }

  if ((Test-Path $startMenuFolder) -and -not (Get-ChildItem -LiteralPath $startMenuFolder -Force)) {
    Remove-Item -LiteralPath $startMenuFolder -Force
  }

  & $StatusCallback "Removendo integracao com o Windows..."

  $protocolKey = "HKCU:\Software\Classes\printflow-agent"
  if (Test-Path $protocolKey) {
    Remove-Item -LiteralPath $protocolKey -Recurse -Force
  }

  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent"
  if (Test-Path $uninstallKey) {
    Remove-Item -LiteralPath $uninstallKey -Recurse -Force
  }

  & $StatusCallback "Removendo arquivos locais..."

  if (Test-Path $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
  }
}

if ($Quiet) {
  Invoke-AgentUninstall
  Write-Host "PrintFlow Agent desinstalado."
  return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Desinstalar PrintFlow Agent"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = [System.Drawing.Size]::new(560, 340)
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
$subtitle.Text = "Desinstalacao do conector local"
$subtitle.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$subtitle.AutoSize = $true
$subtitle.Location = [System.Drawing.Point]::new(38, 78)
$form.Controls.Add($subtitle)

$panel = New-Object System.Windows.Forms.Panel
$panel.BackColor = [System.Drawing.Color]::White
$panel.BorderStyle = "FixedSingle"
$panel.Location = [System.Drawing.Point]::new(38, 112)
$panel.Size = [System.Drawing.Size]::new(484, 142)
$form.Controls.Add($panel)

$question = New-Object System.Windows.Forms.Label
$question.Text = "Tem certeza que deseja desinstalar o PrintFlow Agent?"
$question.Font = [System.Drawing.Font]::new("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$question.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$question.AutoSize = $false
$question.Location = [System.Drawing.Point]::new(18, 18)
$question.Size = [System.Drawing.Size]::new(448, 28)
$panel.Controls.Add($question)

$description = New-Object System.Windows.Forms.Label
$description.Text = "O Agent deixara de conectar este computador ao PrintFlow, nao iniciara mais com o Windows e as impressoras vinculadas por este computador ficarao indisponiveis ate novo pareamento."
$description.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$description.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$description.AutoSize = $false
$description.Location = [System.Drawing.Point]::new(18, 50)
$description.Size = [System.Drawing.Size]::new(448, 54)
$panel.Controls.Add($description)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = ""
$statusLabel.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$statusLabel.AutoSize = $false
$statusLabel.Location = [System.Drawing.Point]::new(18, 108)
$statusLabel.Size = [System.Drawing.Size]::new(448, 18)
$panel.Controls.Add($statusLabel)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 0
$progress.Location = [System.Drawing.Point]::new(38, 274)
$progress.Size = [System.Drawing.Size]::new(484, 8)
$progress.Visible = $false
$form.Controls.Add($progress)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "Cancelar"
$cancelButton.Width = 110
$cancelButton.Height = 36
$cancelButton.Location = [System.Drawing.Point]::new(288, 296)
$cancelButton.FlatStyle = "Flat"
$cancelButton.Add_Click({
  $form.Close()
})
$form.Controls.Add($cancelButton)

$uninstallButton = New-Object System.Windows.Forms.Button
$uninstallButton.Text = "Desinstalar"
$uninstallButton.Width = 122
$uninstallButton.Height = 36
$uninstallButton.Location = [System.Drawing.Point]::new(408, 296)
$uninstallButton.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$uninstallButton.ForeColor = [System.Drawing.Color]::White
$uninstallButton.FlatStyle = "Flat"
$uninstallButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($uninstallButton)

function Set-UninstallStatus {
  param(
    [string]$Message
  )

  $statusLabel.Text = $Message
  $form.Refresh()
  [System.Windows.Forms.Application]::DoEvents()
}

function Complete-Uninstall {
  param(
    [string]$Message,
    [bool]$Success
  )

  $progress.MarqueeAnimationSpeed = 0
  $progress.Style = "Continuous"
  $progress.Value = if ($Success) { 100 } else { 0 }
  $statusLabel.Text = $Message
  $uninstallButton.Text = "Concluir"
  $uninstallButton.Enabled = $true
  $cancelButton.Visible = $false

  if ($Success) {
    $uninstallButton.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
  }
}

$uninstallButton.Add_Click({
  if ($uninstallButton.Text -eq "Concluir") {
    $form.Close()
    return
  }

  try {
    $uninstallButton.Enabled = $false
    $cancelButton.Enabled = $false
    $uninstallButton.Text = "Desinstalando..."
    $progress.Visible = $true
    $progress.Style = "Marquee"
    $progress.MarqueeAnimationSpeed = 24

    Invoke-AgentUninstall -StatusCallback ${function:Set-UninstallStatus}

    Complete-Uninstall `
      -Message "PrintFlow Agent desinstalado com sucesso." `
      -Success $true
  } catch {
    Complete-Uninstall `
      -Message ("Nao foi possivel desinstalar: " + $_.Exception.Message) `
      -Success $false
  } finally {
    $cancelButton.Enabled = $true
  }
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
