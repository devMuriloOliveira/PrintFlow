import fs from 'node:fs/promises'
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

const powershellScript = (operation) => `
$inputText = [Console]::In.ReadToEnd()
$inputBytes = [Convert]::FromBase64String($inputText)
Add-Type -AssemblyName System.Security
if ('${operation}' -eq 'protect') {
  $outputBytes = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
} else {
  $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
}
[Console]::Out.Write([Convert]::ToBase64String($outputBytes))
`

const runPowerShellDpapi = async (
  operation,
  value
) => {
  if (process.platform !== 'win32') {
    return null
  }

  const script =
    Buffer.from(
      powershellScript(operation),
      'utf16le'
    ).toString('base64')
  const input =
    Buffer.from(value).toString('base64')

  return new Promise((resolve, reject) => {
    const child =
      spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          script
        ],
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

export const getAgentDataDirectory = () =>
  dataDirectory

export const loadCredentials = async () => {
  try {
    const content = await fs.readFile(credentialsFile, 'utf8')
    const stored = JSON.parse(content)

    if (
      stored?.protection ===
        'windows-dpapi' &&
      stored.payload
    ) {
      const plaintext =
        await runPowerShellDpapi(
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
    await runPowerShellDpapi(
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

  await fs.writeFile(
    pendingPairingFile,
    JSON.stringify(
      {
        code: normalizedCode,
        createdAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
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

    const data = JSON.parse(content)

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
