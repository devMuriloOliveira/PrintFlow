import os from 'node:os'
import axios from 'axios'
import dotenv from 'dotenv'

import { installFileLogger } from './logging/fileLogger.js'
import { AGENT_VERSION, getAgentRuntimeInfo } from './agentInfo.js'
import { loadCredentials } from './storage/credentials.js'
import { pairAgent } from './pairing/pairing.js'
import { verifyAgent } from './cloud/auth.js'

import {
  sendHeartbeat,
  getPendingCommand,
  completeCommand
} from './cloud/apiClient.js'

import { handleCommand } from './commands/commandHandler.js'

dotenv.config()

const logger =
  installFileLogger()

const apiUrl =
  process.env.PRINTFLOW_API_URL ||
  'http://localhost:3333'

const pairingCode =
  process.env.PRINTFLOW_PAIRING_CODE ||
  ''

console.log('')
console.log('=================================')
console.log('        PRINTFLOW AGENT')
console.log('=================================')

console.log('')
console.log('Versao:', AGENT_VERSION)
console.log('Computador:', os.hostname())
console.log('Sistema:', os.platform())
console.log('Arquitetura:', os.arch())

console.log('')
console.log('API:', apiUrl)
console.log('Log:', logger.logPath)

const start = async () => {
  try {
    console.log('')
    console.log('Verificando BackEnd...')

    const response = await axios.get(
      `${apiUrl}/healthz`
    )

    if (response.status !== 200) {
      throw new Error('BackEnd indisponivel')
    }

    console.log('BackEnd online')

    let credentials = await loadCredentials()

    if (pairingCode) {
      credentials = await pairAgent(
        apiUrl,
        pairingCode,
        credentials
      )
    } else if (!credentials) {
      credentials = await pairAgent(
        apiUrl,
        pairingCode
      )
    }

    if (!credentials) {
      console.log('')
      console.log('Agent nao conectado.')
      return
    }

    console.log('')
    console.log('Verificando credencial do Agent...')

    const authResult = await verifyAgent(
      apiUrl,
      credentials
    )

    console.log('Agent autenticado pelo PrintFlow')
    console.log('Status:', authResult.status)

    // =====================================================
    // HEARTBEAT
    // =====================================================

    console.log('')
    console.log('Iniciando heartbeat...')

    const heartbeat = async () => {
      try {
        await sendHeartbeat(
          apiUrl,
          credentials,
          getAgentRuntimeInfo()
        )

        console.log(
          `[Heartbeat] Agent online - ${new Date().toLocaleTimeString()}`
        )
      } catch (error) {
        console.log(
          `[Heartbeat] Falha - ${
            error.response?.data?.error ||
            error.message
          }`
        )
      }
    }

    await heartbeat()

    setInterval(
      heartbeat,
      30_000
    )

    // =====================================================
// BUSCA DE COMANDOS
// =====================================================

console.log('')
console.log('Iniciando busca de comandos...')

let processingCommand = false
let commandPollDelay = 5_000

const scheduleCommandCheck = (
  delay = commandPollDelay
) => {
  setTimeout(
    checkCommands,
    delay
  )
}

const checkCommands = async () => {
  if (processingCommand) {
    scheduleCommandCheck()
    return
  }

  try {
    const command = await getPendingCommand(
      apiUrl,
      credentials
    )

    commandPollDelay = 5_000

    if (!command) {
      return
    }

    processingCommand = true

    const result = await handleCommand(
      command,
      {
        apiUrl,
        credentials
      }
    )

    await completeCommand(
      apiUrl,
      credentials,
      command.id,
      result
    )

    console.log(
      `[Commands] Comando ${command.id} concluido.`
    )
  } catch (error) {
    commandPollDelay =
      Math.min(
        commandPollDelay * 2,
        30_000
      )

    console.log(
      '[Commands] Falha ao processar comando:',
      error.response?.data?.error ||
      error.message
    )

    console.log(
      `[Commands] Nova tentativa em ${Math.round(commandPollDelay / 1000)}s.`
    )
  } finally {
    processingCommand = false
    scheduleCommandCheck()
  }
}

await checkCommands()

    // =====================================================
    // AGENT PRONTO
    // =====================================================

    console.log('')
    console.log('=================================')
    console.log('          AGENT PRONTO')
    console.log('=================================')

    console.log('')
    console.log(
      'Agent ID:',
      credentials.agentId
    )

    if (credentials.tenantName || credentials.tenantId) {
      console.log(
        'Empresa:',
        credentials.tenantName ||
          credentials.tenantId
      )
    }

    console.log(
      'Computador:',
      credentials.machineName
    )

    console.log('')
    console.log('PrintFlow Agent pronto.')
  } catch (error) {
    console.log('')
    console.log('Nao foi possivel iniciar o Agent.')

    console.log(
      'Erro:',
      error.response?.data?.error ||
      error.message
    )
  }
}

start()
