import os from 'node:os'

import { config } from './config/config.js'
import { installFileLogger } from './logging/fileLogger.js'
import { AGENT_VERSION, getAgentRuntimeInfo } from './agentInfo.js'
import {
  consumePendingPairingCode,
  clearCredentials,
  loadCredentials,
  saveCredentials
} from './storage/credentials.js'
import { pairAgent } from './pairing/pairing.js'
import {
  isInvalidAgentCredentialError,
  verifyAgent
} from './cloud/auth.js'

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
import { cloudHttp } from './cloud/httpClient.js'
import { createFatalShutdownController } from './runtime/fatalShutdown.js'
import { createSingleFlightScheduler } from './cloud/singleFlightScheduler.js'
import { retryUntilStarted } from './cloud/startupRetry.js'
import {
  cleanupPrintFileCache,
  recoverStalePrintFilePins,
  unpinPrintFileCacheByPrintJobId
} from './files/printFileCache.js'
import {
  createLocalOperationsDb
} from './storage/localOperationsDb.js'
import {
  createDiagnosticsToken,
  removeDiagnosticsToken
} from './storage/diagnosticsToken.js'
import {
  recordOperationalMetric
} from './runtime/operationalMetrics.js'
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
import {
  startCommandRealtime
} from './cloud/commandRealtime.js'
import {
  ensurePrinterConnectionForMonitor,
  monitorPrintJobCompletion
} from './printing/productionJobMonitor.js'
import {
  disconnectPrinter,
  getPrinterStatus,
  getCachedActivePrintCount,
  getCachedPrinterPrintActivity,
  getDisconnectedActivePrintCount,
  hasActiveConnection,
  isKnownIdlePrinterStatus,
  listActiveConnections,
  listPrinterConnectionStates,
  startPrinterStatusPolling
} from './printers/printerManager.js'

const logger =
  installFileLogger()
const diagnosticsAccess = await createDiagnosticsToken()
process.on('exit', removeDiagnosticsToken)

const apiUrl = config.apiUrl

const pairingCode =
  process.env.PRINTFLOW_PAIRING_CODE ||
  ''

let localOperations = null
let processingCommand = false

function getActivePrintJobCount() {
  if (!localOperations) return 0
  const monitoredPrintJobs = localOperations
    .listPendingProductionJobMonitors()
    .reduce((count, monitor) => {
      const activity = getCachedPrinterPrintActivity(monitor.printer)
      return count + (activity === true || activity === undefined ? 1 : 0)
    }, 0)
  return Math.max(
    monitoredPrintJobs,
    getCachedActivePrintCount(),
    getDisconnectedActivePrintCount()
  )
}

const fatalShutdown = createFatalShutdownController({
  getActivePrintJobs: getActivePrintJobCount,
  isCommandRunning: () => processingCommand
})

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
          const monitors = localOperations.listPendingProductionJobMonitors()
          const activePrintJobs = getActivePrintJobCount()
          const stalePins = await recoverStalePrintFilePins({
            activePrintJobIds: monitors.map(monitor => monitor.printJobId),
            hasActivePrints: activePrintJobs > 0,
            isPrinterIdle: async printer => {
              const alreadyConnected = hasActiveConnection(printer)
              try {
                await ensurePrinterConnectionForMonitor(printer)
                return isKnownIdlePrinterStatus(await getPrinterStatus(printer))
              } catch (error) {
                console.log(
                  `[Cache] Pin antigo mantido; nao foi possivel confirmar estado da impressora: ${error.message}`
                )
                return false
              } finally {
                if (!alreadyConnected) {
                  await disconnectPrinter(printer).catch(() => {})
                }
              }
            }
          })
          if (stalePins.released > 0) {
            console.log(`[Cache] ${stalePins.released} pin(s) antigo(s) liberado(s) apos confirmar impressora ociosa.`)
          }
          const result = await cleanupPrintFileCache()

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
console.log('Log:', logger.logPath)
console.log('Token local de diagnostico:', diagnosticsAccess.tokenPath)

process.on('uncaughtException', error => fatalShutdown.handle(error))
process.on('unhandledRejection', error => fatalShutdown.handle(error))

localOperations = createLocalOperationsDb()
const prunedLocalData = localOperations.pruneLocalData()
if (prunedLocalData.localStatesRemoved > 0 || prunedLocalData.processedCommandsRemoved > 0) {
  console.log(
    `[Storage] Retencao local removeu ${prunedLocalData.localStatesRemoved} estado(s) e ${prunedLocalData.processedCommandsRemoved} comando(s) concluido(s) antigo(s).`
  )
}

let pairingAllowed = false

startCacheCleanup()

const localServer = startLocalServer({
  allowedOrigins: config.appOrigins,
  diagnosticsToken: diagnosticsAccess.token,
  canAcceptPairing: () => pairingAllowed && !fatalShutdown.isShutdownRequested(),
  getRuntimeStatus: () => {
    const disconnectedActivePrintJobs =
      getDisconnectedActivePrintCount()
    const activePrintJobs = getActivePrintJobCount()

    return {
      updateBlocked:
        activePrintJobs > 0,
      updateBlockedReason:
        disconnectedActivePrintJobs > 0
          ? 'print_connection_lost'
          : activePrintJobs > 0
          ? 'active_print'
          : null,
      activePrintJobs
    }
  },
  getDiagnostics: () => ({
    connections: listActiveConnections().map(item => ({
      key: item.key,
      protocol: item.protocol,
      connected: item.connected,
      connectedAt: item.connectedAt,
      lastStatusAt: item.lastStatusAt,
      printer: {
        protocol: item.printer?.protocol || null,
        manufacturer: item.printer?.manufacturer || null,
        model: item.printer?.model || null,
        serial: item.printer?.serial || null,
        ip: item.printer?.ip || null,
        port: item.printer?.port || null
      }
    }))
  })
})

await localServer.ready

// Atualiza periodicamente conexoes abertas para detectar
// impressoes iniciadas fora do Agent e bloquear atualizacoes
// durante o trabalho ativo.
startPrinterStatusPolling({
  onStatusChecked: ({ protocol, durationMs, failed }) => {
    recordOperationalMetric({
      operations: localOperations,
      category: 'printer_status',
      key: protocol,
      durationMs,
      failed
    })
  }
})

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

    const response = await cloudHttp.get(
      `${apiUrl}/healthz`
    )

    if (response.status !== 200) {
      throw new Error('BackEnd indisponivel')
    }

    console.log('BackEnd online')

    let credentials = await loadCredentials()
    pairingAllowed = !credentials
    let startupPairingCode = pairingCode

    if (credentials) {
      await consumePendingPairingCode()
    }

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
        pairingAllowed = !credentials
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

    pairingAllowed = false

    console.log('')
    console.log('Verificando credencial do Agent...')

    let authResult
    try {
      authResult = await verifyAgent(
        apiUrl,
        credentials
      )
    } catch (error) {
      if (!isInvalidAgentCredentialError(error)) {
        throw error
      }

      await clearCredentials()
      pairingAllowed = true
      console.log(
        'Credencial do Agent recusada; aguardando novo pareamento pelo site.'
      )
      return false
    }

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

    let heartbeatInFlight = false
    let restartRequested = false

    const heartbeat = async () => {
      if (heartbeatInFlight || restartRequested || fatalShutdown.isShutdownRequested()) return
      heartbeatInFlight = true

      try {
        const ignoredPairingCode = await consumePendingPairingCode()
        if (ignoredPairingCode) {
          console.log(
            '[Pairing] Pedido ignorado porque o Agent ja esta pareado.'
          )
        }

        await sendHeartbeat(
          apiUrl,
          credentials,
          {
            ...getAgentRuntimeInfo(),
            printers: listPrinterConnectionStates()
          }
        )

        console.log(
          `[Heartbeat] Agent online - ${new Date().toLocaleTimeString()}`
        )
      } catch (error) {
        if (isInvalidAgentCredentialError(error)) {
          restartRequested = true
          await clearCredentials()
          pairingAllowed = true
          console.log(
            '[Heartbeat] Credencial revogada; reiniciando para permitir novo pareamento.'
          )
          fatalShutdown.handle(new Error('Credencial do Agent revogada; reinicio necessario.'))
          return
        }

        console.log(
          `[Heartbeat] Falha - ${
            error.response?.data?.error ||
            error.message
          }`
        )
      } finally {
        heartbeatInFlight = false
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

let commandPollDelay = 5_000
const maxPendingLocalOperations = Math.max(
  100,
  Number(process.env.PRINTFLOW_AGENT_MAX_PENDING_OPERATIONS) || 5_000
)
let pendingQueueBlocked = false

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
    async result => {
      if (result?.skipped) return
      await unpinPrintFileCacheByPrintJobId(monitor.printJobId)
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
    printJobId: command?.payload?.printJobId || command?.payload?.job?.id,
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

const checkCommands = async () => {
  if (processingCommand || fatalShutdown.isShutdownRequested()) {
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

    const pendingCounts = localOperations.getPendingCounts()
    if (pendingCounts.total >= maxPendingLocalOperations) {
      if (!pendingQueueBlocked) {
        console.error(
          `[Storage] ${pendingCounts.total} operacao(oes) aguardam confirmacao do backend; novos comandos serao pausados ate a sincronizacao.`
        )
      }
      pendingQueueBlocked = true
      return
    }
    pendingQueueBlocked = false

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
        operations: localOperations,
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
  }
}

const commandScheduler = createSingleFlightScheduler({
  run: checkCommands,
  getDefaultDelay: () => commandPollDelay
})

commandScheduler.schedule(0)

    const onCommandAvailable = async () => {
        commandPollDelay = 5_000
        commandScheduler.schedule(0)
    }

    startCommandRealtime({
      startWebSocket: callbacks => startAgentWebSocket({
        apiUrl,
        credentials,
        onCommandAvailable,
        ...callbacks
      }),
      startSse: () => startCommandEvents({
        apiUrl,
        credentials,
        onCommandAvailable
      }),
      onError: error => {
        console.log('[Events] WebSocket indisponivel; SSE e polling permanecem ativos:', error.message || error)
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
    return true
  } catch (error) {
    console.log('')
    console.log('Nao foi possivel iniciar o Agent.')

    console.log(
      'Erro:',
      error.response?.data?.error ||
      error.message
    )
    return false
  }
}

void retryUntilStarted({
  start,
  wait,
  onRetry: retryDelay => {
    console.log(
      `[Startup] Nova tentativa em ${Math.round(retryDelay / 1000)}s.`
    )
  }
})
