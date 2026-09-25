param(
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$TaskName = "PrintFlowAgent",
  [switch]$Quiet,
  [switch]$RemoveUserData
)

$ErrorActionPreference = "Stop"

$installRoot = [System.IO.Path]::GetFullPath($InstallDir)
$dataRoot = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA "PrintFlow Agent"))
$iconPath = Join-Path $installRoot "assets\printflow-agent-icon.ico"
$script:UninstallSucceeded = $false
$script:UninstallAttempted = $false
$script:UninstallForm = $null

function Invoke-AgentUninstall {
  param(
    [scriptblock]$StatusCallback = {},
    [switch]$DeleteUserData
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

  if ($DeleteUserData) {
    & $StatusCallback "Removendo pareamento e dados operacionais locais..."

    if (Test-Path -LiteralPath $dataRoot) {
      Remove-Item -LiteralPath $dataRoot -Recurse -Force
    }
  }
}

if ($Quiet) {
  Invoke-AgentUninstall -DeleteUserData:$RemoveUserData
  if ($RemoveUserData) {
    Write-Host "PrintFlow Agent e dados locais desinstalados."
  } else {
    Write-Host "PrintFlow Agent desinstalado. Pareamento e dados locais foram preservados."
  }
  return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$form = New-Object System.Windows.Forms.Form
$script:UninstallForm = $form
$form.Text = "Desinstalar PrintFlow Agent"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = [System.Drawing.Size]::new(560, 408)
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
$subtitle.Text = "Desinstalacao do conector local"
$subtitle.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$subtitle.AutoSize = $true
$subtitle.Location = [System.Drawing.Point]::new(38, 78)
$form.Controls.Add($subtitle)

$panel = New-Object System.Windows.Forms.Panel
$panel.BackColor = [System.Drawing.Color]::White
$panel.BorderStyle = "None"
$panel.Location = [System.Drawing.Point]::new(38, 112)
$panel.Size = [System.Drawing.Size]::new(484, 174)
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
$description.Text = "O Agent deixara de iniciar com o Windows e este computador ficara offline no PrintFlow. Por padrao, o pareamento e as configuracoes locais serao preservados para uma futura reinstalacao."
$description.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$description.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$description.AutoSize = $false
$description.Location = [System.Drawing.Point]::new(18, 50)
$description.Size = [System.Drawing.Size]::new(448, 52)
$panel.Controls.Add($description)

$removeDataCheck = New-Object System.Windows.Forms.CheckBox
$removeDataCheck.Text = "Remover tambem pareamento, credenciais, cache, historico e logs locais"
$removeDataCheck.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$removeDataCheck.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
$removeDataCheck.AutoSize = $false
$removeDataCheck.Location = [System.Drawing.Point]::new(18, 108)
$removeDataCheck.Size = [System.Drawing.Size]::new(448, 38)
$panel.Controls.Add($removeDataCheck)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = ""
$statusLabel.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$statusLabel.AutoSize = $false
$statusLabel.Location = [System.Drawing.Point]::new(18, 148)
$statusLabel.Size = [System.Drawing.Size]::new(448, 18)
$panel.Controls.Add($statusLabel)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 0
$progress.Location = [System.Drawing.Point]::new(38, 328)
$progress.Size = [System.Drawing.Size]::new(484, 8)
$progress.Visible = $false
$form.Controls.Add($progress)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "Cancelar"
$cancelButton.Width = 110
$cancelButton.Height = 36
$cancelButton.Location = [System.Drawing.Point]::new(288, 354)
$cancelButton.FlatStyle = "Flat"
$cancelButton.BackColor = [System.Drawing.Color]::White
$cancelButton.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$cancelButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$cancelButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$cancelButton.Add_Click({
  $form.Close()
})
$form.Controls.Add($cancelButton)

$uninstallButton = New-Object System.Windows.Forms.Button
$uninstallButton.Text = "Desinstalar"
$uninstallButton.Width = 122
$uninstallButton.Height = 36
$uninstallButton.Location = [System.Drawing.Point]::new(408, 354)
$uninstallButton.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$uninstallButton.ForeColor = [System.Drawing.Color]::White
$uninstallButton.FlatStyle = "Flat"
$uninstallButton.FlatAppearance.BorderSize = 0
$uninstallButton.Cursor = [System.Windows.Forms.Cursors]::Hand
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
  $uninstallButton.Text = if ($Success) { "Concluir" } else { "Fechar" }
  $uninstallButton.Enabled = $true
  $cancelButton.Visible = $false

  if ($Success) {
    $script:UninstallSucceeded = $true
    $uninstallButton.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)

    $closeTimer = New-Object System.Windows.Forms.Timer
    $closeTimer.Interval = 1200
    $closeTimer.Add_Tick({
      param($sender, $eventArgs)

      try {
        if ($sender) {
          $sender.Stop()
          $sender.Dispose()
        }

        if ($script:UninstallForm -and -not $script:UninstallForm.IsDisposed) {
          $script:UninstallForm.Close()
        }
      } catch {
      }
    })
    $closeTimer.Start()
  } else {
    $script:UninstallSucceeded = $false
  }
}

$uninstallButton.Add_Click({
  if ($uninstallButton.Text -eq "Concluir" -or $uninstallButton.Text -eq "Fechar") {
    $form.Close()
    return
  }

  try {
    if ($removeDataCheck.Checked) {
      $confirmation = [System.Windows.Forms.MessageBox]::Show(
        "Esta opcao apaga permanentemente o pareamento, as credenciais protegidas das impressoras, o cache, o historico operacional e os logs deste computador.`n`nDeseja continuar?",
        "Remover todos os dados locais?",
        "YesNo",
        "Warning",
        "Button2"
      )

      if ($confirmation -ne "Yes") {
        return
      }
    }

    $script:UninstallAttempted = $true
    $uninstallButton.Enabled = $false
    $cancelButton.Enabled = $false
    $uninstallButton.Text = "Desinstalando..."
    $progress.Visible = $true
    $progress.Style = "Marquee"
    $progress.MarqueeAnimationSpeed = 24

    Invoke-AgentUninstall `
      -StatusCallback ${function:Set-UninstallStatus} `
      -DeleteUserData:$removeDataCheck.Checked

    $completedMessage = if ($removeDataCheck.Checked) {
      "PrintFlow Agent e todos os dados locais foram removidos."
    } else {
      "PrintFlow Agent removido. Pareamento e dados locais foram preservados."
    }
    Complete-Uninstall `
      -Message $completedMessage `
      -Success $true
  } catch {
    Complete-Uninstall `
      -Message ("Nao foi possivel desinstalar: " + $_.Exception.Message) `
      -Success $false
  } finally {
    $cancelButton.Enabled = $true
  }
})

[System.Windows.Forms.Application]::Run($form)

if ($script:UninstallAttempted -and -not $script:UninstallSucceeded) {
  exit 1
}
