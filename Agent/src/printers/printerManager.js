import {
  bambuAdapter
} from './adapters/bambuAdapter.js'

import {
  moonrakerAdapter
} from './adapters/moonrakerAdapter.js'

import {
  octoprintAdapter
} from './adapters/octoprintAdapter.js'

import {
  prusaLinkAdapter
} from './adapters/prusaLinkAdapter.js'

import {
  marlinSerialAdapter
} from './adapters/marlinSerialAdapter.js'

import {
  normalizePrinterConfig
} from './printerProfiles.js'

// ======================================================
// ADAPTERS DISPONIVEIS
// ======================================================

const adapters = {
  bambu:
    bambuAdapter,

  moonraker:
    moonrakerAdapter,

  octoprint:
    octoprintAdapter,

  prusalink:
    prusaLinkAdapter,

  marlin:
    marlinSerialAdapter
}

// ======================================================
// REGISTRO DE CONEXOES ATIVAS
// ======================================================
//
// IMPORTANTE:
//
// Este Map existe apenas na memoria do Agent.
//
// Nao devemos armazenar:
// - LAN Access Code
// - senha
// - token
// - options com credenciais
//
// A conexao do adapter pode internamente precisar das
// informacoes necessarias para funcionar, mas o
// PrinterManager nao mantem uma copia das credenciais.
// ======================================================

const activeConnections =
  new Map()

const printerConnectionStates =
  new Map()

const heartbeatStatusFields = [
  'state',
  'status',
  'progress',
  'remainingMinutes',
  'currentLayer',
  'totalLayers',
  'nozzleTemperature',
  'nozzleTargetTemperature',
  'bedTemperature',
  'bedTargetTemperature',
  'file'
]

const sanitizeHeartbeatStatus = status => {
  if (!status || typeof status !== 'object') return null
  const sanitized = {}
  for (const field of heartbeatStatusFields) {
    const value = status[field]
    if (value == null || !['string', 'number', 'boolean'].includes(typeof value)) continue
    sanitized[field] = typeof value === 'string' ? value.slice(0, 500) : value
  }
  return Object.keys(sanitized).length ? sanitized : null
}

const recordPrinterConnectionState = ({
  key,
  status,
  error = '',
  lastStatus = null
}) => {
  if (!key) return
  printerConnectionStates.set(key, {
    connectionKey: key,
    status: status === 'connected' ? 'connected' : 'disconnected',
    lastError: String(error || '').slice(0, 500),
    lastStatus: sanitizeHeartbeatStatus(lastStatus),
    observedAt: new Date().toISOString()
  })
}

export const listPrinterConnectionStates = () =>
  Array.from(printerConnectionStates.values(), state => ({ ...state }))

let statusPollingTimer = null
let statusPollingInFlight = false

const activePrintStates =
  new Set([
    'printing',
    'running',
    'pause',
    'paused',
    'pausing',
    'resuming',
    'prepare',
    'preparing'
  ])

export const isActivePrinterStatus = (
  status
) =>
  activePrintStates.has(
    String(
      status?.state ||
        status?.status ||
        ''
    )
      .trim()
      .toLowerCase()
  )

export const getCachedActivePrintCount =
  () => {
    let count = 0

    for (const entry of activeConnections.values()) {
      if (
        isConnectionEntryActive(entry) &&
        isActivePrinterStatus(entry.lastStatus)
      ) {
        count += 1
      }
    }

    return count
  }

// Retorna a atividade em cache de uma impressora especifica.
//
// O resultado e tri-state de proposito:
//   true  = a conexao informa impressao ativa;
//   false = a conexao informa estado ocioso/terminal;
//   null  = nao ha conexao;
//   undefined = ha conexao, mas ainda nao recebemos status.
//
// O Agent usa o estado desconhecido como bloqueio conservador durante uma
// atualizacao, mas nao deve tratar um monitor persistido como ativo quando a
// propria impressora conectada ja informou que esta ociosa.
export const getCachedPrinterPrintActivity = (
  printer
) => {
  const key = getPrinterKey(printer)
  const entry = getActiveConnection(printer)

  if (!entry) {
    const lastKnown = key ? printerConnectionStates.get(key) : null
    if (
      lastKnown?.status === 'disconnected' &&
      isActivePrinterStatus(lastKnown.lastStatus)
    ) {
      return true
    }
    return null
  }

  if (!entry.lastStatus) {
    return undefined
  }

  return isActivePrinterStatus(entry.lastStatus)
}

export const getDisconnectedActivePrintCount = () => {
  let count = 0
  for (const state of printerConnectionStates.values()) {
    if (
      state.status === 'disconnected' &&
      isActivePrinterStatus(state.lastStatus)
    ) {
      count += 1
    }
  }
  return count
}

export const refreshActivePrinterStatuses = async ({
  failureThreshold = Number(
    process.env.PRINTFLOW_PRINTER_STATUS_FAILURE_THRESHOLD || 3
  )
} = {}) => {
  if (statusPollingInFlight) {
    return {
      refreshed: 0,
      failed: 0,
      skipped: true
    }
  }

  statusPollingInFlight = true
  const requiredFailures = Math.max(
    1,
    Math.min(10, Number(failureThreshold) || 3)
  )
  let refreshed = 0
  let failed = 0

  try {
    for (const [key, entry] of activeConnections.entries()) {
      if (!isConnectionEntryActive(entry)) {
        removeStaleConnection(key)
        continue
      }

      if (typeof entry.adapter?.getStatus !== 'function') {
        continue
      }

      try {
        entry.lastStatus = await entry.adapter.getStatus(entry.connection)
        entry.lastStatusAt = new Date()
        entry.statusFailureCount = 0
        recordPrinterConnectionState({
          key,
          status: 'connected',
          lastStatus: entry.lastStatus
        })
        refreshed += 1
      } catch (error) {
        failed += 1
        entry.statusFailureCount = Number(entry.statusFailureCount || 0) + 1

        // Socket/serial encerrado e evidencia imediata. Em conexoes HTTP,
        // exigimos falhas consecutivas para nao transformar um timeout
        // transitorio em falso offline.
        const connectionClosed = entry.connection?.connected !== true
        if (
          !connectionClosed &&
          entry.statusFailureCount < requiredFailures
        ) {
          continue
        }

        if (entry.connection) {
          entry.connection.connected = false
        }
        removeStaleConnection(
          key,
          'Impressora indisponivel ou fora da rede.'
        )
      }
    }
  } finally {
    statusPollingInFlight = false
  }

  return { refreshed, failed, skipped: false }
}

export const startPrinterStatusPolling = ({
  intervalMs = Number(process.env.PRINTFLOW_PRINTER_STATUS_POLL_MS || 15000)
} = {}) => {
  if (statusPollingTimer) {
    return () => stopPrinterStatusPolling()
  }

  const delay = Math.max(5000, Number(intervalMs) || 15000)
  statusPollingTimer = setInterval(() => {
    refreshActivePrinterStatuses().catch(error => {
      console.log(`[PrinterManager] Falha ao atualizar estados: ${error.message}`)
    })
  }, delay)
  statusPollingTimer.unref?.()

  return () => stopPrinterStatusPolling()
}

export const stopPrinterStatusPolling = () => {
  if (!statusPollingTimer) return
  clearInterval(statusPollingTimer)
  statusPollingTimer = null
}

// ======================================================
// NORMALIZAR PROTOCOLO
// ======================================================

const normalizeProtocol = (
  protocol
) => {
  return String(
    protocol ||
    ''
  )
    .trim()
    .toLowerCase()
}

// ======================================================
// NORMALIZAR SERIAL
// ======================================================

const normalizeSerial = (
  serial
) => {
  return String(
    serial ||
    ''
  ).trim()
}

// ======================================================
// GERAR CHAVE UNICA DA IMPRESSORA
// ======================================================

export const getPrinterKey = (
  printer
) => {
  if (!printer) {
    return null
  }

  const protocol =
    normalizeProtocol(
      printer.protocol
    )

  // ==================================================
  // BAMBU
  // ==================================================
  //
  // O serial e mais confiavel que o IP porque
  // o endereco IP pode mudar via DHCP.
  // ==================================================

  if (
    protocol ===
      'bambu' &&
    printer.serial
  ) {
    const serial =
      normalizeSerial(
        printer.serial
      )

    if (!serial) {
      return null
    }

    return (
      `bambu:${serial}`
    )
  }

  // ==================================================
  // IMPRESSORA DE REDE
  // ==================================================

  if (
    printer.connectionType ===
      'network' &&
    printer.ip
  ) {
    const ip =
      String(
        printer.ip
      ).trim()

    const port =
      printer.port
        ? String(
            printer.port
          ).trim()
        : ''

    return (
      `${protocol}:${ip}:${port}`
    )
  }

  // ==================================================
  // IMPRESSORA USB / SERIAL
  // ==================================================

  if (
    printer.connectionType ===
      'usb' &&
    printer.port
  ) {
    const port =
      String(
        printer.port
      ).trim()

    return (
      `${protocol}:${port}`
    )
  }

  return null
}

// ======================================================
// PEGAR ADAPTER
// ======================================================

export const getPrinterAdapter = (
  printer
) => {
  if (
    !printer?.protocol
  ) {
    throw new Error(
      'Protocolo da impressora nao informado.'
    )
  }

  const protocol =
    normalizeProtocol(
      printer.protocol
    )

  const adapter =
    adapters[
      protocol
    ]

  if (!adapter) {
    throw new Error(
      `Protocolo nao suportado: ${protocol}`
    )
  }

  return adapter
}

// ======================================================
// VERIFICAR SE ENTRY AINDA ESTA CONECTADA
// ======================================================
//
// O problema antigo era:
//
// activeConnections.has(key)
//
// retornar true mesmo se o MQTT ja tivesse caido.
//
// Agora validamos tambem:
// connection.connected === true
// ======================================================

const isConnectionEntryActive = (
  entry
) => {
  if (!entry) {
    return false
  }

  if (!entry.connection) {
    return false
  }

  return (
    entry.connection
      .connected ===
    true
  )
}

// ======================================================
// REMOVER ENTRY MORTA
// ======================================================

const removeStaleConnection = (
  key,
  error = ''
) => {
  if (!key) {
    return
  }

  if (
    activeConnections.has(
      key
    )
  ) {
    const entry = activeConnections.get(key)
    recordPrinterConnectionState({
      key,
      status: 'disconnected',
      error,
      lastStatus: entry?.lastStatus
    })
    activeConnections.delete(
      key
    )

    console.log(
      `[PrinterManager] Conexao inativa removida: ${key}`
    )
  }
}

// ======================================================
// VERIFICAR SE EXISTE CONEXAO ATIVA
// ======================================================

export const hasActiveConnection = (
  printer
) => {
  const key =
    getPrinterKey(
      printer
    )

  if (!key) {
    return false
  }

  const entry =
    activeConnections.get(
      key
    )

  if (
    !isConnectionEntryActive(
      entry
    )
  ) {
    removeStaleConnection(
      key
    )

    return false
  }

  return true
}

// ======================================================
// PEGAR CONEXAO ATIVA
// ======================================================

export const getActiveConnection = (
  printer
) => {
  const key =
    getPrinterKey(
      printer
    )

  if (!key) {
    return null
  }

  const entry =
    activeConnections.get(
      key
    )

  if (!entry) {
    return null
  }

  // ==================================================
  // ENTRY EXISTE, MAS CONEXAO MORREU
  // ==================================================

  if (
    !isConnectionEntryActive(
      entry
    )
  ) {
    removeStaleConnection(
      key
    )

    return null
  }

  return entry
}

// ======================================================
// LISTAR CONEXOES ATIVAS
// ======================================================

export const listActiveConnections =
  () => {
    const connections =
      []

    for (
      const [
        key,
        entry
      ]
      of activeConnections.entries()
    ) {
      // ================================================
      // NAO DEVOLVER CONEXOES MORTAS
      // ================================================

      if (
        !isConnectionEntryActive(
          entry
        )
      ) {
        removeStaleConnection(
          key
        )

        continue
      }

      connections.push({
        key,

        printer:
          entry.printer,

        protocol:
          entry.printer
            ?.protocol ||
          null,

        connected:
          true,

        connectedAt:
          entry.connectedAt,

        lastStatusAt:
          entry.lastStatusAt ||
          null
      })
    }

    return connections
  }

// ======================================================
// CONECTAR IMPRESSORA
// ======================================================

export const connectPrinter = async (
  printer,
  options = {}
) => {
  const normalized =
    normalizePrinterConfig(
      printer,
      options
    )

  printer =
    normalized.printer

  options =
    normalized.options

  const adapter =
    getPrinterAdapter(
      printer
    )

  const key =
    getPrinterKey(
      printer
    )

  if (!key) {
    throw new Error(
      'Nao foi possivel gerar a identificacao da impressora.'
    )
  }

  // ==================================================
  // VERIFICAR CONEXAO EXISTENTE
  // ==================================================

  const existing =
    activeConnections.get(
      key
    )

  if (existing) {
    // ================================================
    // CONEXAO REALMENTE ESTA ATIVA
    // ================================================

    if (
      isConnectionEntryActive(
        existing
      )
    ) {
      console.log(
        `[PrinterManager] Conexao ja ativa: ${key}`
      )

      return {
        connected:
          true,

        protocol:
          normalizeProtocol(
            printer.protocol
          ),

        reused:
          true,

        key,

        capabilities:
          existing.adapter
            ?.capabilities ||
          {}
      }
    }

    // ================================================
    // ENTRY EXISTE, MAS ESTA MORTA
    // ================================================

    console.log(
      `[PrinterManager] Conexao antiga esta inativa: ${key}`
    )

    /*
     * Tentamos fechar recursos antigos antes
     * de iniciar uma nova conexao.
     */
    try {
      if (
        typeof existing.adapter
          ?.disconnect ===
        'function'
      ) {
        await existing
          .adapter
          .disconnect(
            existing.connection
          )
      }
    } catch (
      error
    ) {
      console.log(
        `[PrinterManager] Aviso ao limpar conexao antiga: ${error.message}`
      )
    }

    activeConnections.delete(
      key
    )
  }

  // ==================================================
  // NOVA CONEXAO
  // ==================================================

  console.log(
    `[PrinterManager] Conectando: ${key}`
  )

  const connection =
    await adapter.connect(
      printer,
      options
    )

  // ==================================================
  // VALIDAR RESPOSTA DO ADAPTER
  // ==================================================

  if (
    !connection ||
    connection.connected !==
      true
  ) {
    /*
     * Nao criamos nenhuma entrada no Map
     * caso a conexao tenha falhado.
     */
    throw new Error(
      'O adapter nao confirmou a conexao com a impressora.'
    )
  }

  // ==================================================
  // REGISTRAR CONEXAO
  // ==================================================
  //
  // IMPORTANTE:
  //
  // NAO fazemos mais:
  //
  // options: {
  //   ...options
  // }
  //
  // Portanto accessCode nao fica duplicado
  // dentro do PrinterManager.
  // ==================================================

  activeConnections.set(
    key,
    {
      key,

      printer: {
        ...printer,

        /*
         * Garante protocolo
         * normalizado no registro.
         */
        protocol:
          normalizeProtocol(
            printer.protocol
          )
      },

      adapter,

      connection,

      connectedAt:
        new Date(),

      lastStatus:
        null,

      lastStatusAt:
        null,

      statusFailureCount:
        0
    }
  )

  recordPrinterConnectionState({
    key,
    status: 'connected'
  })

  console.log(
    `[PrinterManager] Conexao registrada: ${key}`
  )

  return {
    connected:
      true,

    protocol:
      normalizeProtocol(
        printer.protocol
      ),

    reused:
      false,

    key,

    capabilities:
      adapter.capabilities ||
      {}
  }
}

// ======================================================
// DESCONECTAR IMPRESSORA
// ======================================================

export const disconnectPrinter =
  async (
    printer
  ) => {
    const key =
      getPrinterKey(
        printer
      )

    if (!key) {
      throw new Error(
        'Impressora invalida.'
      )
    }

    const entry =
      activeConnections.get(
        key
      )

    // ==================================================
    // JA ESTAVA DESCONECTADA
    // ==================================================

    if (!entry) {
      return {
        disconnected:
          true,

        alreadyDisconnected:
          true
      }
    }

    try {
      if (
        typeof entry.adapter
          ?.disconnect ===
        'function'
      ) {
        await entry
          .adapter
          .disconnect(
            entry.connection
          )
      }
    } finally {
      /*
       * Mesmo se o adapter gerar erro
       * durante disconnect, removemos
       * a referencia local.
       */
      activeConnections.delete(
        key
      )
      recordPrinterConnectionState({
        key,
        status: 'disconnected'
      })
    }

    console.log(
      `[PrinterManager] Conexao removida: ${key}`
    )

    return {
      disconnected:
        true,

      alreadyDisconnected:
        false
    }
  }

// ======================================================
// OBTER STATUS
// ======================================================

export const getPrinterStatus =
  async (
    printer
  ) => {
    const key =
      getPrinterKey(
        printer
      )

    if (!key) {
      throw new Error(
        'Impressora invalida.'
      )
    }

    const entry =
      getActiveConnection(
        printer
      )

    if (!entry) {
      throw new Error(
        'A impressora nao possui conexao ativa.'
      )
    }

    try {
      const status =
        await entry
          .adapter
          .getStatus(
            entry.connection
          )

      entry.lastStatus =
        status

      entry.lastStatusAt =
        new Date()

      recordPrinterConnectionState({
        key,
        status: 'connected',
        lastStatus: status
      })

      return status
    } catch (
      error
    ) {
      // ================================================
      // SE O ADAPTER MARCOU A CONEXAO COMO MORTA
      // ================================================

      if (
        entry.connection
          ?.connected !==
        true
      ) {
        removeStaleConnection(
          key
        )
      }

      throw error
    }
  }

// ======================================================
// INICIAR IMPRESSAO
// ======================================================

export const startPrinterJob =
  async (
    printer,
    job
  ) => {
    const entry =
      getActiveConnection(
        printer
      )

    if (!entry) {
      throw new Error(
        'A impressora nao possui conexao ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.startPrint !==
      'function'
    ) {
      throw new Error(
        'Este adapter ainda nao suporta inicio de impressao.'
      )
    }

    try {
      return await entry
        .adapter
        .startPrint(
          entry.connection,
          job
        )
    } catch (
      error
    ) {
      const key =
        getPrinterKey(
          printer
        )

      if (
        entry.connection
          ?.connected !==
        true
      ) {
        removeStaleConnection(
          key
        )
      }

      throw error
    }
  }

// ======================================================
// PAUSAR
// ======================================================

export const pausePrinter =
  async (
    printer
  ) => {
    const entry =
      getActiveConnection(
        printer
      )

    if (!entry) {
      throw new Error(
        'A impressora nao possui conexao ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.pause !==
      'function'
    ) {
      throw new Error(
        'Este adapter nao suporta pausa.'
      )
    }

    try {
      return await entry
        .adapter
        .pause(
          entry.connection
        )
    } catch (
      error
    ) {
      const key =
        getPrinterKey(
          printer
        )

      if (
        entry.connection
          ?.connected !==
        true
      ) {
        removeStaleConnection(
          key
        )
      }

      throw error
    }
  }

// ======================================================
// RETOMAR
// ======================================================

export const resumePrinter =
  async (
    printer
  ) => {
    const entry =
      getActiveConnection(
        printer
      )

    if (!entry) {
      throw new Error(
        'A impressora nao possui conexao ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.resume !==
      'function'
    ) {
      throw new Error(
        'Este adapter nao suporta retomada.'
      )
    }

    try {
      return await entry
        .adapter
        .resume(
          entry.connection
        )
    } catch (
      error
    ) {
      const key =
        getPrinterKey(
          printer
        )

      if (
        entry.connection
          ?.connected !==
        true
      ) {
        removeStaleConnection(
          key
        )
      }

      throw error
    }
  }

// ======================================================
// CANCELAR
// ======================================================

export const cancelPrinter =
  async (
    printer
  ) => {
    const entry =
      getActiveConnection(
        printer
      )

    if (!entry) {
      throw new Error(
        'A impressora nao possui conexao ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.cancel !==
      'function'
    ) {
      throw new Error(
        'Este adapter nao suporta cancelamento.'
      )
    }

    try {
      return await entry
        .adapter
        .cancel(
          entry.connection
        )
    } catch (
      error
    ) {
      const key =
        getPrinterKey(
          printer
        )

      if (
        entry.connection
          ?.connected !==
        true
      ) {
        removeStaleConnection(
          key
        )
      }

      throw error
    }
  }
