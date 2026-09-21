import axios from 'axios'
import os from 'node:os'

import { config } from './config/config.js'
import { installFileLogger } from './logging/fileLogger.js'
import { AGENT_VERSION, getAgentRuntimeInfo } from './agentInfo.js'
import {
  consumePendingPairingCode,
  loadCredentials,
  saveCredentials
} from './storage/credentials.js'
import { pairAgent } from './pairing/pairing.js'
import { verifyAgent } from './cloud/auth.js'

import {
  sendHeartbeat,
  getPendingCommand,
  completeCommand,
  syncAgentEvents,
  rotateAgentCredential,
  confirmAgentCredentialRotation,
  reportPrintJobMetrics,
  uploadSlicedPrintArtifact
} from './cloud/apiClient.js'

import { startLocalServer } from './localServer.js'
import { cleanupPrintFileCache } from './files/printFileCache.js'
import {
  createLocalOperationsDb
} from './storage/localOperationsDb.js'
import {
  executeAgentCommand,
  flushPendingCommandCompletions,
  flushPendingEvents,
  flushPendingProductionMetrics
} from './commands/commandExecution.js'
import {
  startCommandEvents
} from './cloud/commandEvents.js'
import {
  startAgentWebSocket
} from './cloud/websocket.js'
import { monitorPrintJobCompletion } from './printing/productionJobMonitor.js'

const logger =
  installFileLogger()

const apiUrl = config.apiUrl

const pairingCode =
  process.env.PRINTFLOW_PAIRING_CODE ||
  ''

const wait = (delay) =>
  new Promise(resolve =>
    setTimeout(resolve, delay)
  )

const startCacheCleanup =
  () => {
    const intervalMs =
      Math.max(
        60_000,
        Number(
          process.env.PRINTFLOW_AGENT_CACHE_CLEANUP_INTERVAL_MS ||
            6 *
              60 *
              60 *
              1000
        )
      )

    const run =
      async () => {
        try {
          const result =
            await cleanupPrintFileCache()

          if (
            result.removed >
            0
          ) {
            console.log(
              `[Cache] Limpeza removeu ${result.removed} arquivo(s), ${result.removedBytes} bytes.`
            )
          }
        } catch (error) {
          console.log(
            '[Cache] Falha ao limpar arquivos antigos:',
            error.message ||
              error
          )
        }
      }

    void run()

    const timer =
      setInterval(
        run,
        intervalMs
      )

    timer.unref?.()

    return timer
  }

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

process.on('uncaughtException', error => {
  console.log(
    '[Fatal] Excecao nao tratada:',
    error?.stack ||
      error?.message ||
      error
  )
})

process.on('unhandledRejection', error => {
  console.log(
    '[Fatal] Promise rejeitada sem tratamento:',
    error?.stack ||
      error?.message ||
      error
  )
})

startLocalServer()
startCacheCleanup()

const localOperations =
  createLocalOperationsDb()

const recoveredCommands =
  localOperations.recoverInterruptedCommands()

if (
  recoveredCommands >
  0
) {
  console.log(
    `[Commands] ${recoveredCommands} comando(s) interrompido(s) foram concluídos sem repetição.`
  )
}

console.log(
  'Operacoes locais:',
  localOperations.databasePath
)

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
    let startupPairingCode = pairingCode

    while (!credentials) {
      const pendingPairingCode =
        startupPairingCode ||
        await consumePendingPairingCode()

      startupPairingCode = ''

      if (pendingPairingCode) {
        credentials = await pairAgent(
          apiUrl,
          pendingPairingCode,
          credentials
        )
      }

      if (!credentials) {
        console.log('')
        console.log(
          'Agent aguardando conexao pelo site PrintFlow.'
        )
        console.log(
          'Use a opcao Conectar Agent instalado na tela de impressoras.'
        )

        await wait(5000)
      }
    }

    console.log('')
    console.log('Verificando credencial do Agent...')

    const authResult = await verifyAgent(
      apiUrl,
      credentials
    )

    console.log('Agent autenticado pelo PrintFlow')
    console.log('Status:', authResult.status)

    // A nova credencial é salva primeiro e confirmada usando o hash pendente.
    // O Backend mantém a anterior por quinze minutos, evitando perda de pareamento.
    if (credentials.pendingCredentialVersion) {
      const confirmed = await confirmAgentCredentialRotation(apiUrl, credentials)
      credentials = { ...credentials, credentialVersion: confirmed.credentialVersion }
      delete credentials.pendingCredentialVersion
      await saveCredentials(credentials)
    }

    try {
      const rotation = await rotateAgentCredential(apiUrl, credentials)
      if (!rotation.agentSecret) {
        // A credencial ainda está dentro da janela de rotação de 30 dias.
      } else {
      const rotatedCredentials = { ...credentials, agentSecret: rotation.agentSecret, pendingCredentialVersion: rotation.credentialVersion }
      await saveCredentials(rotatedCredentials)
      const confirmed = await confirmAgentCredentialRotation(apiUrl, rotatedCredentials)
      credentials = { ...rotatedCredentials, credentialVersion: confirmed.credentialVersion }
      delete credentials.pendingCredentialVersion
      await saveCredentials(credentials)
      }
    } catch (error) {
      if (error.response?.status !== 409) console.log('[Credentials] Rotacao adiada:', error.response?.data?.error || error.message)
    }

    // =====================================================
    // HEARTBEAT
    // =====================================================

    console.log('')
    console.log('Iniciando heartbeat...')

    const heartbeat = async () => {
      try {
        const pendingPairingCode =
          await consumePendingPairingCode()

        if (pendingPairingCode) {
          const pairedCredentials = await pairAgent(
            apiUrl,
            pendingPairingCode,
            credentials
          )

          if (pairedCredentials) {
            credentials = pairedCredentials
          }
        }

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

const reportProductionJobCompletion = async (
  targetApiUrl,
  targetCredentials,
  printJobId,
  payload
) => {
  try {
    return await reportPrintJobMetrics(
      targetApiUrl,
      targetCredentials,
      printJobId,
      payload
    )
  } catch (error) {
    localOperations.queueProductionMetrics({
      printJobId,
      payload
    })

    return {
      queued: true,
      error: error.message
    }
  }
}

const runProductionJobMonitor = (
  monitor
) => {
  const command = {
    id: monitor.commandId,
    payload: {
      printJobId: monitor.printJobId,
      printer: monitor.printer,
      startedAt: monitor.startedAt
    }
  }

  void monitorPrintJobCompletion({
    command,
    context: { apiUrl, credentials },
    report: reportProductionJobCompletion
  }).then(
    () => {
      localOperations.acknowledgeProductionJobMonitor(
        monitor.printJobId
      )
    }
  ).catch((error) => {
    console.error(
      '[ProductionJob] Falha ao reportar conclusao',
      {
        printJobId: monitor.printJobId,
        message: error.message
      }
    )
  })
}

const startProductionJobMonitor = (
  command
) => {
  const monitor = {
    printJobId: command?.payload?.printJobId,
    commandId: command?.id,
    printer: command?.payload?.printer,
    startedAt: command?.payload?.startedAt || new Date().toISOString()
  }

  try {
    localOperations.queueProductionJobMonitor(
      monitor
    )
  } catch (error) {
    console.error(
      '[ProductionJob] Nao foi possivel persistir monitoramento',
      {
        printJobId: monitor.printJobId,
        message: error.message
      }
    )
    return
  }

  runProductionJobMonitor(
    monitor
  )
}

const pendingProductionJobMonitors =
  localOperations.listPendingProductionJobMonitors()

for (
  const monitor
  of pendingProductionJobMonitors
) {
  runProductionJobMonitor(
    monitor
  )
}

if (
  pendingProductionJobMonitors.length >
  0
) {
  console.log(
    `[ProductionJob] ${pendingProductionJobMonitors.length} monitoramento(s) retomado(s) apos reinicio.`
  )
}

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
    const metricsSynchronized = await flushPendingProductionMetrics({
      operations: localOperations,
      report: (printJobId, payload) => reportPrintJobMetrics(apiUrl, credentials, printJobId, payload)
    })
    if (metricsSynchronized > 0) console.log(`[ProductionJob] ${metricsSynchronized} métrica(s) local(is) sincronizada(s).`)

    const synchronized =
      await flushPendingCommandCompletions({
        operations:
          localOperations,

        complete: (
          commandId,
          result
        ) =>
          completeCommand(
            apiUrl,
            credentials,
            commandId,
            result
          )
      })

    const eventsSynchronized =
      await flushPendingEvents({
        operations:
          localOperations,
        publish:
          events =>
            syncAgentEvents(
              apiUrl,
              credentials,
              [events]
            )
      })

    if (
      synchronized >
      0
    ) {
      console.log(
        `[Commands] ${synchronized} conclusao(oes) local(is) sincronizada(s).`
      )
    }

    if (
      eventsSynchronized >
      0
    ) {
      console.log(
        `[Events] ${eventsSynchronized} evento(s) local(is) sincronizado(s).`
      )
    }

    const command = await getPendingCommand(
      apiUrl,
      credentials
    )

    commandPollDelay = 5_000

    if (!command) {
      return
    }

    processingCommand = true

    await executeAgentCommand({
      command,

      context: {
        apiUrl,
        credentials,
        orcaSlicerPath: process.env.PRINTFLOW_ORCA_SLICER_PATH || '',
        uploadSlicedPrintArtifact,
        onPrintJobStarted: ({ command }) => {
          startProductionJobMonitor(
            command
          )
        }
      },

      operations:
        localOperations
    })

    await flushPendingCommandCompletions({
      operations:
        localOperations,

      complete: (
        commandId,
        result
      ) =>
        completeCommand(
          apiUrl,
          credentials,
          commandId,
          result
        )
      })

    await flushPendingEvents({
      operations:
        localOperations,
      publish:
        events =>
          syncAgentEvents(
            apiUrl,
            credentials,
            [events]
          )
    })

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

    startCommandEvents({
      apiUrl,
      credentials,

      onCommandAvailable: async () => {
        commandPollDelay =
          5_000

        scheduleCommandCheck(0)
      },

      onError: error => {
        console.log(
          '[Events] Canal em tempo real indisponivel; polling permanece ativo:',
          error.message ||
            error
        )
      }
    })

    startAgentWebSocket({
      apiUrl,
      credentials,
      onCommandAvailable: async () => {
        commandPollDelay = 5_000
        scheduleCommandCheck(0)
      },
      onError: error => {
        console.log('[WebSocket] Canal indisponivel; SSE e polling permanecem ativos:', error.message || error)
      }
    })

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
