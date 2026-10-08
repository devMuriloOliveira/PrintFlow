param(
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$PairingCode = ""
)

$ErrorActionPreference = "Stop"

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\PrintFlowAgentTray", [ref]$createdNew)

if (-not $createdNew) {
  return
}

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$logPath = Join-Path $agentRoot "logs"
$iconPath = Join-Path $agentRoot "assets\printflow-agent-icon.ico"
$packagePath = Join-Path $agentRoot "package.json"
$scriptPath = Join-Path $agentRoot "src\index.js"

if (-not (Test-Path $logPath)) {
  New-Item -ItemType Directory -Path $logPath | Out-Null
}

$version = "0.1.0"
if (Test-Path $packagePath) {
  try {
    $package = Get-Content -Raw $packagePath | ConvertFrom-Json
    if ($package.version) {
      $version = $package.version
    }
  } catch {
    $version = "0.1.0"
  }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$agentProcess = $null
$agentClosing = $false

function Write-AgentLauncherError {
  param(
    [string]$Message
  )

  try {
    Add-Content `
      -LiteralPath (Join-Path $logPath "launcher.log") `
      -Value ("{0} {1}" -f ([DateTime]::UtcNow.ToString("o")), $Message) `
      -Encoding UTF8
  } catch {
  }
}

function Resolve-NodeExecutable {
  $candidates = @(
    (Join-Path $agentRoot "runtime\node.exe")
  )

  try {
    $command = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
      $candidates += $command.Source
    }
  } catch {
  }

  $candidates += @(
    (Join-Path ${env:ProgramFiles} "nodejs\node.exe"),
    (Join-Path ${env:ProgramW6432} "nodejs\node.exe"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\nodejs\node.exe")
  )

  foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate)) {
      continue
    }

    try {
      $version = (& $candidate --version 2>$null).Trim()
      if ($version -match '^v(\d+)\.') {
        $major = [int]$Matches[1]
        if ($major -ge 22) {
          return (Resolve-Path -LiteralPath $candidate).Path
        }
      }
    } catch {
    }
  }

  throw "Node.js 22.13 ou superior nao encontrado. Instale o Node.js LTS e inicie o PrintFlow Agent novamente."
}

try {
  $nodeExecutable = Resolve-NodeExecutable
} catch {
  Write-AgentLauncherError $_.Exception.Message
  throw
}

function Start-AgentProcess {
  if ($script:agentClosing) {
    return
  }

  if ($script:agentProcess -and -not $script:agentProcess.HasExited) {
    return
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeExecutable
  $startInfo.Arguments = "`"$scriptPath`""
  $startInfo.WorkingDirectory = $agentRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.EnvironmentVariables["PRINTFLOW_API_URL"] = $ApiUrl
  $startInfo.EnvironmentVariables["PRINTFLOW_ENVIRONMENT"] = "PRODUCTION"
  $startInfo.EnvironmentVariables["PRINTFLOW_AGENT_LOG_DIR"] = $logPath

  if ($PairingCode) {
    $startInfo.EnvironmentVariables["PRINTFLOW_PAIRING_CODE"] = $PairingCode
  } elseif ($startInfo.EnvironmentVariables.ContainsKey("PRINTFLOW_PAIRING_CODE")) {
    $startInfo.EnvironmentVariables.Remove("PRINTFLOW_PAIRING_CODE")
  }

  $script:agentProcess = New-Object System.Diagnostics.Process
  $script:agentProcess.StartInfo = $startInfo
  [void]$script:agentProcess.Start()
}

function Stop-AgentProcessTree {
  param(
    [int]$ProcessId
  )

  try {
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ParentProcessId -eq $ProcessId
      } |
      ForEach-Object {
        Stop-AgentProcessTree -ProcessId $_.ProcessId
      }
  } catch {
  }

  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  } catch {
  }
}

function Stop-AgentProcess {
  if ($script:agentProcess -and -not $script:agentProcess.HasExited) {
    $processId = $script:agentProcess.Id

    try {
      $script:agentProcess.CloseMainWindow() | Out-Null

      if ($script:agentProcess.WaitForExit(1200)) {
        return
      }
    } catch {
    }

    Stop-AgentProcessTree -ProcessId $processId
  }

  try {
    $script:agentProcess = $null
  } catch {
  }
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Text = "PrintFlow Agent em funcionamento"
$notifyIcon.Visible = $true

if (Test-Path $iconPath) {
  $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Text = "PrintFlow Agent ativo"
$statusItem.Enabled = $false
[void]$menu.Items.Add($statusItem)

$localHealthUrl = 'http://127.0.0.1:17873/healthz'
$script:statusForm = $null
$script:statusRefreshTimer = $null
$script:statusBadge = $null
$script:statusSummary = $null
$script:statusVersionValue = $null
$script:statusPairingValue = $null
$script:statusCloudValue = $null
$script:statusPrintValue = $null

function Get-AgentLocalHealth {
  try {
    return Invoke-RestMethod `
      -Uri $localHealthUrl `
      -Method Get `
      -TimeoutSec 2
  } catch {
    return $null
  }
}

function Update-AgentStatusWindow {
  $health = Get-AgentLocalHealth

  if (-not $health) {
    $statusItem.Text = 'PrintFlow Agent indisponível'
    $notifyIcon.Text = 'PrintFlow Agent - indisponível'
    if ($script:statusBadge) {
      $script:statusBadge.Text = 'INDISPONÍVEL'
      $script:statusBadge.BackColor = [System.Drawing.Color]::FromArgb(254, 226, 226)
      $script:statusBadge.ForeColor = [System.Drawing.Color]::FromArgb(185, 28, 28)
      $script:statusSummary.Text = 'O serviço local ainda não respondeu. O Agent tentará reiniciar automaticamente.'
      $script:statusVersionValue.Text = "v$version"
      $script:statusPairingValue.Text = 'Não foi possível verificar'
      $script:statusCloudValue.Text = 'Sem resposta local'
      $script:statusPrintValue.Text = 'Não foi possível verificar'
    }
    return
  }

  $installedVersion = if ($health.version) { "v$($health.version)" } else { "v$version" }
  $pairedText = if ($health.paired) { 'Conectado a uma conta' } else { 'Aguardando conexão pelo site' }
  $cloudText = if ($health.cloudConnected) { 'Conectado ao Filamind' } else { 'Tentando conectar' }
  $activePrintJobs = [Math]::Max(0, [int]$health.activePrintJobs)
  $printText = if ($activePrintJobs -eq 0) { 'Nenhuma impressão ativa' } elseif ($activePrintJobs -eq 1) { '1 impressão ativa' } else { "$activePrintJobs impressões ativas" }

  if (-not $health.paired) {
    $statusLabel = 'AGUARDANDO CONEXÃO'
    $summary = 'Abra o Filamind no navegador para conectar este computador à sua conta.'
    $badgeBackColor = [System.Drawing.Color]::FromArgb(254, 249, 195)
    $badgeForeColor = [System.Drawing.Color]::FromArgb(133, 77, 14)
    $statusItem.Text = 'PrintFlow Agent aguardando conexão'
    $notifyIcon.Text = 'PrintFlow Agent - aguardando conexão'
  } elseif (-not $health.cloudConnected) {
    $statusLabel = 'RECONECTANDO'
    $summary = 'O Agent está aberto e tentando restabelecer a comunicação com o Filamind.'
    $badgeBackColor = [System.Drawing.Color]::FromArgb(255, 237, 213)
    $badgeForeColor = [System.Drawing.Color]::FromArgb(154, 52, 18)
    $statusItem.Text = 'PrintFlow Agent reconectando...'
    $notifyIcon.Text = 'PrintFlow Agent - reconectando'
  } else {
    $statusLabel = 'ONLINE'
    $summary = 'Este computador está pronto para receber comandos autorizados do Filamind.'
    $badgeBackColor = [System.Drawing.Color]::FromArgb(220, 252, 231)
    $badgeForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
    $statusItem.Text = 'PrintFlow Agent online'
    $notifyIcon.Text = 'PrintFlow Agent - online'
  }

  if ($script:statusBadge) {
    $script:statusBadge.Text = $statusLabel
    $script:statusBadge.BackColor = $badgeBackColor
    $script:statusBadge.ForeColor = $badgeForeColor
    $script:statusSummary.Text = $summary
    $script:statusVersionValue.Text = $installedVersion
    $script:statusPairingValue.Text = $pairedText
    $script:statusCloudValue.Text = $cloudText
    $script:statusPrintValue.Text = $printText
  }
}

function Show-AgentStatusWindow {
  if (-not $script:statusForm -or $script:statusForm.IsDisposed) {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Status do PrintFlow Agent'
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $true
    $form.ClientSize = [System.Drawing.Size]::new(620, 430)
    $form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
    $form.Font = [System.Drawing.Font]::new('Segoe UI', 9)
    $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    if (Test-Path $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = 'PrintFlow Agent'
    $title.Font = [System.Drawing.Font]::new('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $title.AutoSize = $true
    $title.Location = [System.Drawing.Point]::new(32, 24)
    $form.Controls.Add($title)

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = 'Conector local do Filamind para impressoras 3D'
    $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
    $subtitle.AutoSize = $true
    $subtitle.Location = [System.Drawing.Point]::new(36, 70)
    $form.Controls.Add($subtitle)

    $script:statusBadge = New-Object System.Windows.Forms.Label
    $script:statusBadge.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $script:statusBadge.Font = [System.Drawing.Font]::new('Segoe UI Semibold', 8)
    $script:statusBadge.Location = [System.Drawing.Point]::new(454, 31)
    $script:statusBadge.Size = [System.Drawing.Size]::new(132, 30)
    $form.Controls.Add($script:statusBadge)

    $panel = New-Object System.Windows.Forms.Panel
    $panel.BackColor = [System.Drawing.Color]::White
    $panel.Location = [System.Drawing.Point]::new(36, 104)
    $panel.Size = [System.Drawing.Size]::new(548, 236)
    $form.Controls.Add($panel)

    $script:statusSummary = New-Object System.Windows.Forms.Label
    $script:statusSummary.Font = [System.Drawing.Font]::new('Segoe UI', 10)
    $script:statusSummary.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $script:statusSummary.Location = [System.Drawing.Point]::new(20, 18)
    $script:statusSummary.Size = [System.Drawing.Size]::new(508, 42)
    $panel.Controls.Add($script:statusSummary)

    $rows = @(
      @{ Label = 'Versão instalada'; Y = 78; Target = 'statusVersionValue' },
      @{ Label = 'Conta'; Y = 116; Target = 'statusPairingValue' },
      @{ Label = 'Filamind Cloud'; Y = 154; Target = 'statusCloudValue' },
      @{ Label = 'Produção'; Y = 192; Target = 'statusPrintValue' }
    )

    foreach ($row in $rows) {
      $label = New-Object System.Windows.Forms.Label
      $label.Text = $row.Label
      $label.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
      $label.Location = [System.Drawing.Point]::new(20, $row.Y)
      $label.Size = [System.Drawing.Size]::new(150, 22)
      $panel.Controls.Add($label)

      $value = New-Object System.Windows.Forms.Label
      $value.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
      $value.Font = [System.Drawing.Font]::new('Segoe UI Semibold', 9)
      $value.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
      $value.Location = [System.Drawing.Point]::new(178, ($row.Y - 3))
      $value.Size = [System.Drawing.Size]::new(350, 25)
      $panel.Controls.Add($value)
      Set-Variable -Scope Script -Name $row.Target -Value $value
    }

    $updateButton = New-Object System.Windows.Forms.Button
    $updateButton.Text = 'Verificar atualizações'
    $updateButton.FlatStyle = 'Flat'
    $updateButton.Location = [System.Drawing.Point]::new(36, 364)
    $updateButton.Size = [System.Drawing.Size]::new(174, 36)
    $updateButton.Add_Click({ Start-InteractiveUpdateCheck })
    $form.Controls.Add($updateButton)

    $logsButton = New-Object System.Windows.Forms.Button
    $logsButton.Text = 'Abrir logs'
    $logsButton.FlatStyle = 'Flat'
    $logsButton.Location = [System.Drawing.Point]::new(220, 364)
    $logsButton.Size = [System.Drawing.Size]::new(120, 36)
    $logsButton.Add_Click({ Start-Process -FilePath 'explorer.exe' -ArgumentList $logPath })
    $form.Controls.Add($logsButton)

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Text = 'Fechar'
    $closeButton.Location = [System.Drawing.Point]::new(464, 364)
    $closeButton.Size = [System.Drawing.Size]::new(120, 36)
    $closeButton.Add_Click({ $script:statusForm.Hide() })
    $form.Controls.Add($closeButton)

    $form.Add_FormClosing({
      param($sender, $eventArgs)
      if (-not $script:agentClosing) {
        $eventArgs.Cancel = $true
        $sender.Hide()
      }
    })

    $script:statusRefreshTimer = New-Object System.Windows.Forms.Timer
    $script:statusRefreshTimer.Interval = 3000
    $script:statusRefreshTimer.Add_Tick({ Update-AgentStatusWindow })
    $script:statusRefreshTimer.Start()
    $script:statusForm = $form
  }

  Update-AgentStatusWindow
  $script:statusForm.Show()
  $script:statusForm.Activate()
}

$openStatusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openStatusItem.Text = 'Abrir status'
$openStatusItem.Add_Click({ Show-AgentStatusWindow })
[void]$menu.Items.Add($openStatusItem)

$restartTimer = New-Object System.Windows.Forms.Timer
$restartTimer.Interval = 5000
$restartTimer.Add_Tick({
  if ($script:agentClosing) {
    return
  }

  try {
    if (-not $script:agentProcess -or $script:agentProcess.HasExited) {
      $statusItem.Text = "PrintFlow Agent reiniciando..."
      Start-AgentProcess
      $statusItem.Text = "PrintFlow Agent ativo"
    }
  } catch {
    $statusItem.Text = "PrintFlow Agent com erro"
  }
})

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Fechar Agent"
$exitItem.Add_Click({
  $script:agentClosing = $true
  $restartTimer.Stop()
  $statusItem.Text = "PrintFlow Agent encerrando..."
  Stop-AgentProcess
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
[void]$menu.Items.Add($exitItem)

$updateScript = Join-Path $agentRoot 'scripts\check-and-update-windows-agent.ps1'
$updateHistoryPath = Join-Path $env:APPDATA 'PrintFlow Agent\updates\update-history.jsonl'
$script:updateCheckProcess = $null
$script:updateCheckPollTimer = $null

$updateItem = New-Object System.Windows.Forms.ToolStripMenuItem
$updateItem.Text = 'Verificar atualizações'

function Start-InteractiveUpdateCheck {
  if ($script:updateCheckProcess -and -not $script:updateCheckProcess.HasExited) {
    $notifyIcon.ShowBalloonTip(3000, 'PrintFlow Agent', 'A verificação de atualização já está em andamento.', [System.Windows.Forms.ToolTipIcon]::Info)
    return
  }

  try {
    $script:updateCheckProcess = Start-Process `
      -FilePath 'powershell.exe' `
      -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', "`"$updateScript`"",
        '-CurrentVersion', "`"$version`"",
        '-Interactive'
      ) `
      -WindowStyle Hidden `
      -PassThru

    $notifyIcon.ShowBalloonTip(3000, 'PrintFlow Agent', 'Verificando atualizações em segundo plano...', [System.Windows.Forms.ToolTipIcon]::Info)

    if (-not $script:updateCheckPollTimer) {
      $script:updateCheckPollTimer = New-Object System.Windows.Forms.Timer
      $script:updateCheckPollTimer.Interval = 500
      $script:updateCheckPollTimer.Add_Tick({
        if (-not $script:updateCheckProcess -or -not $script:updateCheckProcess.HasExited) {
          return
        }

        $exitCode = $script:updateCheckProcess.ExitCode
        $script:updateCheckProcess.Dispose()
        $script:updateCheckProcess = $null
        $script:updateCheckPollTimer.Stop()

        if ($exitCode -ne 0 -and -not $script:agentClosing) {
          $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', 'Não foi possível verificar a atualização. Consulte o histórico de atualizações.', [System.Windows.Forms.ToolTipIcon]::Warning)
        }
      })
    }

    $script:updateCheckPollTimer.Start()
  } catch {
    $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', "Não foi possível iniciar a verificação: $($_.Exception.Message)", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
}

$updateItem.Add_Click({ Start-InteractiveUpdateCheck })
[void]$menu.Items.Insert(1, $updateItem)

$updateHistoryItem = New-Object System.Windows.Forms.ToolStripMenuItem
$updateHistoryItem.Text = 'Histórico de atualizações'
$updateHistoryItem.Add_Click({
  if (Test-Path -LiteralPath $updateHistoryPath) {
    Start-Process -FilePath 'notepad.exe' -ArgumentList $updateHistoryPath
  } else {
    [System.Windows.Forms.MessageBox]::Show('Ainda não há atualizações registradas.', 'PrintFlow Agent', 'OK', 'Information') | Out-Null
  }
})
[void]$menu.Items.Insert(2, $updateHistoryItem)

$updateTimer = New-Object System.Windows.Forms.Timer
$updateTimer.Interval = 30 * 1000
$updateTimer.Add_Tick({
  $updateTimer.Stop()
  try {
    # A verificacao usa outro processo para nunca bloquear a thread da bandeja.
    Start-InteractiveUpdateCheck
  } catch {
    # A indisponibilidade da internet não interrompe o Agent.
  } finally {
    if (-not $script:agentClosing) {
      $updateTimer.Interval = 6 * 60 * 60 * 1000
      $updateTimer.Start()
    }
  }
})

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_DoubleClick({
  Show-AgentStatusWindow
})

try {
  Start-AgentProcess
  $restartTimer.Start()
  $updateTimer.Start()
  [System.Windows.Forms.Application]::Run()
} catch {
  Write-AgentLauncherError $_.Exception.Message
  throw
} finally {
  $script:agentClosing = $true
  $restartTimer.Stop()
  $updateTimer.Stop()
  $restartTimer.Dispose()
  $updateTimer.Dispose()
  if ($script:statusRefreshTimer) {
    $script:statusRefreshTimer.Stop()
    $script:statusRefreshTimer.Dispose()
  }
  if ($script:statusForm) {
    $script:statusForm.Dispose()
  }
  Stop-AgentProcess
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
