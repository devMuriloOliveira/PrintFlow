$ErrorActionPreference = 'Stop'

# Store package identity is linked by the official OrcaSlicer release notes.
$storePackage = Get-AppxPackage -Name 'OrcaSlicer.OrcaSlicer' |
  Where-Object { $_.PackageFamilyName -eq 'OrcaSlicer.OrcaSlicer_3qd7h69xpne0g' -and $_.SignatureKind -eq 'Store' }
if (-not $storePackage) {
  $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Instale o App Installer da Microsoft para permitir a instalacao automatica do OrcaSlicer pela Store (9MV6GL23XM59).'
  }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $winget.Source
  $startInfo.Arguments = 'install --id 9MV6GL23XM59 --exact --source msstore --accept-source-agreements --accept-package-agreements --disable-interactivity --silent'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $installProcess = [Diagnostics.Process]::Start($startInfo)
  try {
    $stdoutTask = $installProcess.StandardOutput.ReadToEndAsync()
    $stderrTask = $installProcess.StandardError.ReadToEndAsync()
    if (-not $installProcess.WaitForExit(300000)) {
      $installProcess.Kill()
      throw 'Instalacao do OrcaSlicer pela Microsoft Store excedeu 5 minutos. Tente novamente com acesso a Store.'
    }
    if ($installProcess.ExitCode -ne 0) {
      throw "Instalacao do OrcaSlicer pela Microsoft Store falhou: $($stdoutTask.Result) $($stderrTask.Result)"
    }
  } finally {
    $installProcess.Dispose()
  }
  $storePackage = Get-AppxPackage -Name 'OrcaSlicer.OrcaSlicer' |
    Where-Object { $_.PackageFamilyName -eq 'OrcaSlicer.OrcaSlicer_3qd7h69xpne0g' -and $_.SignatureKind -eq 'Store' }
}
if (-not $storePackage -or [string]$storePackage.Version -ne '2.4.3.0' -or
    -not (Test-Path -LiteralPath (Join-Path $storePackage.InstallLocation 'orca-slicer.exe'))) {
  throw 'Pacote oficial OrcaSlicer Store ausente ou versao ainda nao validada. Versao testada: 2.4.3.0 (motor 2.4.2).'
}
Write-Host 'OrcaSlicer oficial Microsoft Store disponivel; nenhuma alteracao na politica de seguranca.'
