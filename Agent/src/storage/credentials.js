import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const resolveDefaultDataDirectory = () => {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ||
        path.join(os.homedir(), 'AppData', 'Roaming'),
      'PrintFlow Agent'
    )
  }

  return path.join(
    process.env.XDG_CONFIG_HOME ||
      path.join(os.homedir(), '.config'),
    'printflow-agent'
  )
}

const dataDirectory = process.env.PRINTFLOW_AGENT_DATA_DIR
  ? path.resolve(process.env.PRINTFLOW_AGENT_DATA_DIR)
  : resolveDefaultDataDirectory()
const credentialsFile = path.join(dataDirectory, 'agent.json')
const pendingPairingFile = path.join(dataDirectory, 'pending-pairing.json')
const PENDING_PAIRING_MAX_AGE_MS = 10 * 60 * 1000
const testDpapiValues = new Map()
const isNodeTest = Boolean(process.env.NODE_TEST_CONTEXT)
const sourceAgentRoot = path.resolve(import.meta.dirname, '..', '..')

const parseJson = content =>
  JSON.parse(
    String(content).replace(/^\uFEFF/, '')
  )

const emulateDpapiForTest = (operation, value) => {
  if (!isNodeTest) return null

  if (operation === 'protect') {
    const handle = `test-dpapi-${randomBytes(32).toString('base64url')}`
    testDpapiValues.set(handle, Buffer.from(value))
    return Buffer.from(handle, 'utf8')
  }

  const handle = Buffer.from(value).toString('utf8')
  const plaintext = testDpapiValues.get(handle)
  if (!plaintext) throw new Error('Payload DPAPI de teste indisponivel.')
  return Buffer.from(plaintext)
}

export const resolveNativeDpapiHost = () => {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const candidates = [
    process.env.FILA_AGENT_HOST_PATH,
    process.env.PRINTFLOW_AGENT_HOST_PATH,
    path.resolve(path.dirname(process.execPath), '..', 'host', 'FilaAgent.exe'),
    path.resolve(path.dirname(process.execPath), '..', 'host', 'PrintFlowAgentHost.exe'),
    path.join(localAppData, 'PrintFlowAgent', 'host', 'FilaAgent.exe'),
    path.join(localAppData, 'PrintFlowAgent', 'host', 'PrintFlowAgentHost.exe'),
    path.join(localAppData, 'FilaAgent', 'host', 'FilaAgent.exe'),
    path.join(sourceAgentRoot, 'windows-host', 'bin', 'Release', 'net8.0-windows', 'FilaAgent.exe'),
    path.join(sourceAgentRoot, 'windows-host', 'bin', 'Debug', 'net8.0-windows', 'FilaAgent.exe'),
    path.join(sourceAgentRoot, 'windows-host', 'bin', 'Release', 'net8.0-windows', 'PrintFlowAgentHost.exe'),
    path.join(sourceAgentRoot, 'windows-host', 'bin', 'Debug', 'net8.0-windows', 'PrintFlowAgentHost.exe')
  ].filter(Boolean)
  return candidates.map(candidate => path.resolve(candidate)).find(candidate => existsSync(candidate)) || ''
}

const runNativeDpapi = async (
  operation,
  value
) => {
  if (isNodeTest) return emulateDpapiForTest(operation, value)
  if (process.platform !== 'win32') {
    return null
  }

  const input =
    Buffer.from(value).toString('base64')
  const host = resolveNativeDpapiHost()
  if (!host) throw new Error('Host nativo do Fila Agent indisponivel para DPAPI. Informe FILA_AGENT_HOST_PATH ou compile o host C#.')

  return new Promise((resolve, reject) => {
    const child =
      spawn(
        host,
        [`--dpapi-${operation}`],
        {
          windowsHide:
            true,
          stdio: [
            'pipe',
            'pipe',
            'pipe'
          ]
        }
      )
    let output = ''
    let errorOutput = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
    })
    child.stderr.on('data', chunk => {
      errorOutput += chunk
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0 || !output.trim()) {
        const emulated = emulateDpapiForTest(operation, value)
        if (emulated) {
          resolve(emulated)
          return
        }
        reject(
          new Error(
            `DPAPI indisponivel (${String(errorOutput).trim() || code}).`
          )
        )
        return
      }

      try {
        resolve(
          Buffer.from(
            output.trim(),
            'base64'
          )
        )
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(input)
  })
}

export const protectWithWindowsDpapi = async value =>
  runNativeDpapi(
    'protect',
    Buffer.isBuffer(value)
      ? value
      : Buffer.from(String(value), 'utf8')
  )

export const unprotectWithWindowsDpapi = async value =>
  runNativeDpapi(
    'unprotect',
    Buffer.isBuffer(value)
      ? value
      : Buffer.from(String(value), 'base64')
  )

export const getAgentDataDirectory = () =>
  dataDirectory

export const loadCredentials = async () => {
  try {
    const content = await fs.readFile(credentialsFile, 'utf8')
    const stored = parseJson(content)

    if (
      stored?.protection ===
        'windows-dpapi' &&
      stored.payload
    ) {
      const plaintext =
        await runNativeDpapi(
          'unprotect',
          Buffer.from(
            stored.payload,
            'base64'
          )
        )

      if (!plaintext) {
        throw new Error(
          'Protecao DPAPI indisponivel.'
        )
      }

      return JSON.parse(
        plaintext.toString('utf8')
      )
    }

    // Compatibilidade: instalações legadas são migradas na próxima gravação.
    if (
      process.platform === 'win32' &&
      stored &&
      typeof stored === 'object'
    ) {
      await saveCredentials(stored)
    }

    return stored
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export const saveCredentials = async (credentials) => {
  await fs.mkdir(dataDirectory, {
    recursive: true
  })

  const plaintext =
    Buffer.from(
      JSON.stringify(credentials),
      'utf8'
    )
  const protectedValue =
    await runNativeDpapi(
      'protect',
      plaintext
    )

  if (protectedValue) {
    await fs.writeFile(
      credentialsFile,
      JSON.stringify({
        version:
          2,
        protection:
          'windows-dpapi',
        payload:
          protectedValue.toString('base64')
      }, null, 2),
      'utf8'
    )
    return
  }

  // Plataformas não-Windows permanecem compatíveis; restringimos o arquivo.
  await fs.writeFile(
    credentialsFile,
    JSON.stringify(credentials, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600
    }
  )
}

export const clearCredentials = async () => {
  await fs.rm(
    credentialsFile,
    {
      force: true
    }
  )
}

export const savePendingPairingCode = async (code) => {
  const normalizedCode =
    String(code || '')
      .trim()
      .toUpperCase()

  if (!normalizedCode) {
    return
  }

  await fs.mkdir(dataDirectory, {
    recursive: true
  })

  const payload = Buffer.from(JSON.stringify({
    code: normalizedCode,
    createdAt: new Date().toISOString()
  }), 'utf8')
  const protectedValue = await protectWithWindowsDpapi(payload)
  const stored = protectedValue
    ? {
        version: 1,
        protection: 'windows-dpapi',
        payload: protectedValue.toString('base64')
      }
    : JSON.parse(payload.toString('utf8'))

  await fs.writeFile(
    pendingPairingFile,
    JSON.stringify(stored, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600
    }
  )
}

export const consumePendingPairingCode = async () => {
  try {
    const content = await fs.readFile(
      pendingPairingFile,
      'utf8'
    )

    await fs.rm(
      pendingPairingFile,
      {
        force: true
      }
    )

    const stored = parseJson(content)
    const payload = stored?.protection === 'windows-dpapi' && stored.payload
      ? await unprotectWithWindowsDpapi(Buffer.from(stored.payload, 'base64'))
      : Buffer.from(content, 'utf8')
    const data = parseJson(payload.toString('utf8'))
    const createdAt = Date.parse(data?.createdAt || '')
    const ageMs = Date.now() - createdAt

    if (!Number.isFinite(createdAt) || ageMs < -60_000 || ageMs > PENDING_PAIRING_MAX_AGE_MS) {
      return ''
    }

    return String(data?.code || '')
      .trim()
      .toUpperCase()
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ''
    }

    throw error
  }
}
