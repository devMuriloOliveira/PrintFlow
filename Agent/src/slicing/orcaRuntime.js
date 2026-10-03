import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const discoverStoreOrcaPath = () => {
  if (process.platform !== 'win32') return ''
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-AppxPackage -Name 'OrcaSlicer.OrcaSlicer' | Where-Object { $_.PackageFamilyName -eq 'OrcaSlicer.OrcaSlicer_3qd7h69xpne0g' -and $_.SignatureKind -eq 'Store' -and [string]$_.Version -eq '2.4.3.0' } | ForEach-Object { Join-Path $_.InstallLocation 'orca-slicer.exe' }"
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    return output.trim()
  } catch {
    return ''
  }
}

// Resolve once at startup; never download software in the command/printing path.
export const resolveOrcaSlicerPath = ({ env = process.env, exists = existsSync, discoverStore = discoverStoreOrcaPath } = {}) => {
  const configured = String(env.PRINTFLOW_ORCA_SLICER_PATH || '').trim()
  if (configured) return configured
  const storePath = discoverStore()
  if (storePath && exists(storePath)) return storePath
  return ''
}
