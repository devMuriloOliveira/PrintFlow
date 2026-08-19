import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDirectory = path.resolve(__dirname, '../../data')
const credentialsFile = path.join(dataDirectory, 'agent.json')

export const loadCredentials = async () => {
  try {
    const content = await fs.readFile(credentialsFile, 'utf8')

    return JSON.parse(content)
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

  await fs.writeFile(
    credentialsFile,
    JSON.stringify(credentials, null, 2),
    'utf8'
  )
}