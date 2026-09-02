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
  key
) => {
  if (!key) {
    return
  }

  if (
    activeConnections.has(
      key
    )
  ) {
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
        null
    }
  )

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
