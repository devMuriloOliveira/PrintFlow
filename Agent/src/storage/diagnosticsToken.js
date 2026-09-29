import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  getAgentDataDirectory,
  protectWithWindowsDpapi,
  unprotectWithWindowsDpapi
} from './credentials.js'

export const getDiagnosticsTokenPath = () =>
  path.join(getAgentDataDirectory(), 'diagnostics.token')

export const createDiagnosticsToken = async () => {
  const directory = getAgentDataDirectory()
  const tokenPath = getDiagnosticsTokenPath()
  const token = randomBytes(32).toString('base64url')

  await fs.promises.mkdir(directory, { recursive: true })
  const protectedValue = await protectWithWindowsDpapi(token)
  const stored = protectedValue
    ? JSON.stringify({
        version: 1,
        protection: 'windows-dpapi',
        payload: protectedValue.toString('base64')
      })
    : token
  await fs.promises.writeFile(tokenPath, `${stored}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.promises.chmod(tokenPath, 0o600)
  } catch {
    // Windows enforces the inherited per-user ACL on the Agent data directory.
  }

  return { token, tokenPath }
}

export const readDiagnosticsToken = async () => {
  const stored = (await fs.promises.readFile(getDiagnosticsTokenPath(), 'utf8')).trim()
  let token = stored
  try {
    const envelope = JSON.parse(stored)
    if (envelope?.protection === 'windows-dpapi' && envelope.payload) {
      const plaintext = await unprotectWithWindowsDpapi(Buffer.from(envelope.payload, 'base64'))
      if (!plaintext) throw new Error('DPAPI indisponivel.')
      token = plaintext.toString('utf8')
    }
  } catch (error) {
    if (error instanceof SyntaxError) token = stored
    else throw error
  }
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    throw new Error('Token local de diagnostico ausente ou invalido.')
  }
  return token
}

export const removeDiagnosticsToken = () => {
  try {
    fs.rmSync(getDiagnosticsTokenPath(), { force: true })
  } catch {
  }
}
