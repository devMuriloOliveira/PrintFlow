import { existsSync } from 'node:fs'

export const discoverStoreOrcaPath = () => {
  if (process.platform !== 'win32') return ''
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const candidate = `${programFiles}\\WindowsApps\\OrcaSlicer.OrcaSlicer_2.4.3.0_x64__3qd7h69xpne0g\\orca-slicer.exe`
  return existsSync(candidate) ? candidate : ''
}

// Resolve once at startup; never download software in the command/printing path.
export const resolveOrcaSlicerPath = ({ env = process.env, exists = existsSync, discoverStore = discoverStoreOrcaPath } = {}) => {
  const configured = String(env.PRINTFLOW_ORCA_SLICER_PATH || '').trim()
  if (configured) return configured
  const storePath = discoverStore()
  if (storePath && exists(storePath)) return storePath
  return ''
}
