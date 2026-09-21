import path from 'node:path'

const asNonEmptyString = (value, field) => {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${field} e obrigatorio.`)
  return normalized
}

const PROFILE_PRESETS = Object.freeze({
  'bambu lab p1s': { id: 'bambu-p1s-pla-basic', machine: 'Bambu Lab P1S', process: '0.20mm Standard @BBL X1C.json', filament: 'Bambu PLA Basic @BBL X1C.json' },
  'bambu lab p1p': { id: 'bambu-p1p-pla-basic', machine: 'Bambu Lab P1P', process: '0.20mm Standard @BBL P1P.json', filament: 'Bambu PLA Basic @BBL X1C.json' },
  'bambu lab x1 carbon': { id: 'bambu-x1-carbon-pla-basic', machine: 'Bambu Lab X1 Carbon', process: '0.20mm Standard @BBL X1C.json', filament: 'Bambu PLA Basic @BBL X1C.json' },
  'bambu lab a1': { id: 'bambu-a1-pla-basic', machine: 'Bambu Lab A1', process: '0.20mm Standard @BBL A1.json', filament: 'Bambu PLA Basic @BBL A1.json' },
  'bambu lab a1 mini': { id: 'bambu-a1-mini-pla-basic', machine: 'Bambu Lab A1 mini', process: '0.20mm Standard @BBL A1M.json', filament: 'Bambu PLA Basic @BBL A1M.json' }
})

const printerKey = ({ manufacturer = '', model = '', name = '' } = {}) =>
  `${String(manufacturer).trim()} ${String(model || name).trim()}`.trim().toLowerCase().replace(/\s+/g, ' ')

/** Resolve an exact official printer profile; there is no unsafe generic fallback. */
export const resolveOfficialOrcaProfileForPrinter = ({ printer, executablePath, version = '2.4.2', nozzle = '0.4' } = {}) => {
  const executable = path.resolve(asNonEmptyString(executablePath, 'executablePath'))
  const key = printerKey(printer)
  const preset = PROFILE_PRESETS[key]
  if (!preset) throw new Error(`Perfil OrcaSlicer oficial nao cadastrado para: ${key || 'modelo nao informado'}`)
  const resources = path.join(path.dirname(executable), 'resources', 'profiles', 'BBL')
  return {
    id: preset.id,
    version: asNonEmptyString(version, 'version'),
    settingsPaths: [
      path.join(resources, 'machine', `${preset.machine} ${nozzle} nozzle.json`),
      path.join(resources, 'process', preset.process)
    ],
    filamentPaths: [path.join(resources, 'filament', preset.filament)]
  }
}

export const buildOfficialBambuP1SProfile = ({ executablePath, version = '2.4.2' }) =>
  resolveOfficialOrcaProfileForPrinter({ printer: { manufacturer: 'Bambu Lab', model: 'P1S' }, executablePath, version })

export const listOfficialOrcaPrinterModels = () => Object.keys(PROFILE_PRESETS)
