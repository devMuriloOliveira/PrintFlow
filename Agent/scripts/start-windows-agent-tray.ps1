param(
  [string]$ApiUrl = "http://localhost:3333",
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

function Start-AgentProcess {
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

function Stop-AgentProcess {
  if ($script:agentProcess -and -not $script:agentProcess.HasExited) {
    try {
      $script:agentProcess.CloseMainWindow() | Out-Null
      if (-not $script:agentProcess.WaitForExit(2000)) {
        $script:agentProcess.Kill()
      }
    } catch {
      try {
        $script:agentProcess.Kill()
      } catch {
      }
    }
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
  Stop-AgentProcess
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
[void]$menu.Items.Add($exitItem)

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_DoubleClick({
  $infoItem.PerformClick()
})

try {
  Start-AgentProcess
  [System.Windows.Forms.Application]::Run()
} finally {
  Stop-AgentProcess
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
