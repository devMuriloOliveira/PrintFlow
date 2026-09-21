import { createHash } from 'node:crypto'
import { access, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

const asNonEmptyString = (value, field) => {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${field} e obrigatorio.`)
  return normalized
}

export const normalizeOrcaProfile = profile => {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Perfil OrcaSlicer ausente.')
  }

  const settingsPaths = Array.isArray(profile.settingsPaths)
    ? profile.settingsPaths
    : [profile.path]
  const normalizedSettingsPaths = settingsPaths
    .map((value, index) => path.resolve(asNonEmptyString(value, `profile.settingsPaths[${index}]`)))
  if (normalizedSettingsPaths.length === 0) {
    throw new Error('profile.settingsPaths e obrigatorio.')
  }
  const filamentPaths = (Array.isArray(profile.filamentPaths) ? profile.filamentPaths : [])
    .map((value, index) => path.resolve(asNonEmptyString(value, `profile.filamentPaths[${index}]`)))

  return {
    id: asNonEmptyString(profile.id, 'profile.id'),
    version: asNonEmptyString(profile.version, 'profile.version'),
    path: normalizedSettingsPaths[0],
    settingsPaths: normalizedSettingsPaths,
    filamentPaths,
    sha256: String(profile.sha256 || '').trim().toLowerCase()
  }
}

export const buildOrcaSlicerArgs = ({ inputPath, outputPath, profile }) => {
  const input = path.resolve(asNonEmptyString(inputPath, 'inputPath'))
  const output = path.resolve(asNonEmptyString(outputPath, 'outputPath'))
  const normalizedProfile = normalizeOrcaProfile(profile)

  return [
    input,
    '--slice',
    '0',
    '--load-settings',
    normalizedProfile.settingsPaths.join(';'),
    ...(normalizedProfile.filamentPaths.length > 0
      ? ['--load-filaments', normalizedProfile.filamentPaths.join(';')]
      : []),
    '--outputdir',
    path.dirname(output)
  ]
}

const sha256File = async filePath => {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(filePath)) {
    sizeBytes += chunk.length
    hash.update(chunk)
  }
  return { sha256: hash.digest('hex'), sizeBytes }
}

const runProcess = ({ executable, args, timeoutMs, spawnImpl = spawn }) =>
  new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`OrcaSlicer excedeu o timeout de ${timeoutMs} ms.`))
    }, timeoutMs)

    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`OrcaSlicer terminou com codigo ${code}. ${stderr.trim()}`.trim()))
        return
      }
      resolve({ stdout, stderr })
    })
  })

export const sliceWithOrcaSlicer = async ({
  executablePath,
  inputPath,
  outputPath,
  profile,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl
}) => {
  const executable = path.resolve(asNonEmptyString(executablePath, 'executablePath'))
  const normalizedProfile = normalizeOrcaProfile(profile)
  const input = path.resolve(asNonEmptyString(inputPath, 'inputPath'))
  const output = path.resolve(asNonEmptyString(outputPath, 'outputPath'))

  await access(executable)
  await access(input)
  await Promise.all(normalizedProfile.settingsPaths.map(filePath => access(filePath)))
  await Promise.all(normalizedProfile.filamentPaths.map(filePath => access(filePath)))
  if (normalizedProfile.sha256) {
    const profileHash = await sha256File(normalizedProfile.path)
    if (profileHash.sha256 !== normalizedProfile.sha256) {
      throw new Error(`Hash do perfil OrcaSlicer divergente: ${normalizedProfile.id}.`)
    }
  }

  const args = buildOrcaSlicerArgs({ inputPath: input, outputPath: output, profile: normalizedProfile })
  await mkdir(path.dirname(output), { recursive: true })
  const outputBefore = await stat(output).catch(() => null)
  const filesBefore = new Set(
    (await readdir(path.dirname(output), { withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
  )
  const processResult = await runProcess({
    executable,
    args,
    timeoutMs,
    spawnImpl
  })

  let artifact = await stat(output).catch(() => null)
  const outputIsNew = artifact && (!outputBefore || artifact.mtimeMs > outputBefore.mtimeMs || artifact.size !== outputBefore.size)
  if (!outputIsNew) artifact = null
  if (!artifact?.isFile() || artifact.size === 0) {
    const generated = (await readdir(path.dirname(output), { withFileTypes: true }))
      .filter(entry => entry.isFile() && !filesBefore.has(entry.name) && entry.name.toLowerCase().endsWith('.gcode'))
      .map(entry => path.join(path.dirname(output), entry.name))
    if (generated.length === 1 && !outputBefore && generated[0] !== output) {
      await rename(generated[0], output)
      artifact = await stat(output).catch(() => null)
    }
  }
  if (!artifact?.isFile() || artifact.size === 0) {
    throw new Error('OrcaSlicer terminou sem gerar um G-code valido.')
  }
  const outputHash = await sha256File(output)

  return {
    format: 'gcode',
    outputPath: output,
    sha256: outputHash.sha256,
    sizeBytes: outputHash.sizeBytes,
    profile: {
      id: normalizedProfile.id,
      version: normalizedProfile.version,
      sha256: normalizedProfile.sha256 || null
    },
    logs: {
      stdout: processResult.stdout,
      stderr: processResult.stderr
    }
  }
}
