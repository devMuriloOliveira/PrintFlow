import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

export const getAgentDataDirectory = () =>
  dataDirectory

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

export const clearCredentials = async () => {
  await fs.rm(
    credentialsFile,
    {
      force: true
    }
  )
}
