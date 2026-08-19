import os from 'node:os'
import axios from 'axios'
import dotenv from 'dotenv'

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

const apiUrl =
  process.env.PRINTFLOW_API_URL ||
  'http://localhost:3333'

console.log('')
console.log('=================================')
console.log('        PRINTFLOW AGENT')
console.log('=================================')

console.log('')
console.log('Versão: 0.1.0')
console.log('Computador:', os.hostname())
console.log('Sistema:', os.platform())
console.log('Arquitetura:', os.arch())

console.log('')
console.log('API:', apiUrl)

const start = async () => {
  try {
    console.log('')
    console.log('Verificando BackEnd...')

    const response = await axios.get(
      `${apiUrl}/healthz`
    )

    if (response.status !== 200) {
      throw new Error('BackEnd indisponível')
    }

    console.log('✅ BackEnd online')

    let credentials = await loadCredentials()

    if (!credentials) {
      credentials = await pairAgent(apiUrl)
    }

    if (!credentials) {
      console.log('')
      console.log('Agent não conectado.')
      return
    }

    console.log('')
    console.log('Verificando credencial do Agent...')

    const authResult = await verifyAgent(
      apiUrl,
      credentials
    )

    console.log('✅ Agent autenticado pelo PrintFlow')
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
          credentials
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

const checkCommands = async () => {
  if (processingCommand) {
    return
  }

  try {
    const command = await getPendingCommand(
      apiUrl,
      credentials
    )

    if (!command) {
      return
    }

    processingCommand = true

    const result = await handleCommand(command)

    await completeCommand(
      apiUrl,
      credentials,
      command.id,
      result
    )

    console.log(
      `[Commands] Comando ${command.id} concluído.`
    )
  } catch (error) {
    console.log(
      '[Commands] Falha ao processar comando:',
      error.response?.data?.error ||
      error.message
    )
  } finally {
    processingCommand = false
  }
}

await checkCommands()

setInterval(
  checkCommands,
  5_000
)

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

    console.log(
      'Computador:',
      credentials.machineName
    )

    console.log('')
    console.log('✅ PrintFlow Agent pronto.')
  } catch (error) {
    console.log('')
    console.log('❌ Não foi possível iniciar o Agent.')

    console.log(
      'Erro:',
      error.response?.data?.error ||
      error.message
    )
  }
}

start()