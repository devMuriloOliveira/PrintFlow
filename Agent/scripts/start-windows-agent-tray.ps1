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

function Start-AgentProcess {
  if ($script:agentClosing) {
    return
  }

  if ($script:agentProcess -and -not $script:agentProcess.HasExited) {
    return
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = "node"
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

$infoItem = New-Object System.Windows.Forms.ToolStripMenuItem
$infoItem.Text = "Informacoes"
$infoItem.Add_Click({
  $message = @"
PrintFlow Agent
Versao: $version

O Agent conecta este computador ao PrintFlow para encontrar e controlar impressoras 3D conectadas por rede ou cabo USB.

Ele envia status, recebe comandos de impressao e mantem a comunicacao com o site enquanto estiver aberto.

API: $ApiUrl
Logs: $logPath
"@

  [System.Windows.Forms.MessageBox]::Show(
    $message,
    "PrintFlow Agent",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
})
[void]$menu.Items.Add($infoItem)

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

function Stop-AgentForUpdate {
  $script:agentClosing = $true
  $restartTimer.Stop()
  $updateTimer.Stop()
  $statusItem.Text = 'PrintFlow Agent atualizando...'
  Stop-AgentProcess
  $notifyIcon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
}

$updateItem = New-Object System.Windows.Forms.ToolStripMenuItem
$updateItem.Text = 'Verificar atualizações'
$updateItem.Add_Click({
  try {
    $result = & $updateScript -CurrentVersion $version -Interactive
    if ($result -and $result.deferred) {
      $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', 'Atualização programada para o próximo período sem impressão ativa.', [System.Windows.Forms.ToolTipIcon]::Info)
    } elseif ($result -and $result.updateAvailable -and -not $result.installed) {
      $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', "A atualização $($result.latestVersion) está disponível.", [System.Windows.Forms.ToolTipIcon]::Info)
    } elseif ($result -and $result.installed) {
      $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', 'Atualização iniciada. A versão anterior será restaurada automaticamente se a nova não iniciar.', [System.Windows.Forms.ToolTipIcon]::Info)
      Stop-AgentForUpdate
    } else {
      $notifyIcon.ShowBalloonTip(3000, 'PrintFlow Agent', 'Você já está usando a versão mais recente.', [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } catch {
    $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', "Não foi possível verificar atualização: $($_.Exception.Message)", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
})
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
  $result = $null
  try {
    $result = & $updateScript -CurrentVersion $version -Interactive
    if ($result -and $result.installed) {
      $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', 'Atualização iniciada com proteção de rollback.', [System.Windows.Forms.ToolTipIcon]::Info)
      Stop-AgentForUpdate
      return
    }
    if ($result -and $result.updateAvailable -and -not $result.installed -and -not $result.deferred) {
      $notifyIcon.ShowBalloonTip(5000, 'PrintFlow Agent', "A versão $($result.latestVersion) está disponível. Use 'Verificar atualizações' para instalar.", [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } catch {
    # A indisponibilidade da internet não interrompe o Agent.
  } finally {
    if (-not $script:agentClosing) {
      $updateTimer.Interval = if ($result -and $result.deferred) { 5 * 60 * 1000 } else { 6 * 60 * 60 * 1000 }
      $updateTimer.Start()
    }
  }
})

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_DoubleClick({
  $infoItem.PerformClick()
})

try {
  Start-AgentProcess
  $restartTimer.Start()
  $updateTimer.Start()
  [System.Windows.Forms.Application]::Run()
} finally {
  $script:agentClosing = $true
  $restartTimer.Stop()
  $updateTimer.Stop()
  $restartTimer.Dispose()
  $updateTimer.Dispose()
  Stop-AgentProcess
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
