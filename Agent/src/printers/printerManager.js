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

// ======================================================
// ADAPTERS DISPONÍVEIS
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
// REGISTRO DE CONEXÕES ATIVAS
// ======================================================
//
// IMPORTANTE:
//
// Este Map existe apenas na memória do Agent.
//
// Não devemos armazenar:
// - LAN Access Code
// - senha
// - token
// - options com credenciais
//
// A conexão do adapter pode internamente precisar das
// informações necessárias para funcionar, mas o
// PrinterManager não mantém uma cópia das credenciais.
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
// GERAR CHAVE ÚNICA DA IMPRESSORA
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
  // O serial é mais confiável que o IP porque
  // o endereço IP pode mudar via DHCP.
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
      'Protocolo da impressora não informado.'
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
      `Protocolo não suportado: ${protocol}`
    )
  }

  return adapter
}

// ======================================================
// VERIFICAR SE ENTRY AINDA ESTÁ CONECTADA
// ======================================================
//
// O problema antigo era:
//
// activeConnections.has(key)
//
// retornar true mesmo se o MQTT já tivesse caído.
//
// Agora validamos também:
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
      `[PrinterManager] Conexão inativa removida: ${key}`
    )
  }
}

// ======================================================
// VERIFICAR SE EXISTE CONEXÃO ATIVA
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
// PEGAR CONEXÃO ATIVA
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
  // ENTRY EXISTE, MAS CONEXÃO MORREU
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
// LISTAR CONEXÕES ATIVAS
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
      // NÃO DEVOLVER CONEXÕES MORTAS
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
      'Não foi possível gerar a identificação da impressora.'
    )
  }

  // ==================================================
  // VERIFICAR CONEXÃO EXISTENTE
  // ==================================================

  const existing =
    activeConnections.get(
      key
    )

  if (existing) {
    // ================================================
    // CONEXÃO REALMENTE ESTÁ ATIVA
    // ================================================

    if (
      isConnectionEntryActive(
        existing
      )
    ) {
      console.log(
        `[PrinterManager] Conexão já ativa: ${key}`
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

        key
      }
    }

    // ================================================
    // ENTRY EXISTE, MAS ESTÁ MORTA
    // ================================================

    console.log(
      `[PrinterManager] Conexão antiga está inativa: ${key}`
    )

    /*
     * Tentamos fechar recursos antigos antes
     * de iniciar uma nova conexão.
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
        `[PrinterManager] Aviso ao limpar conexão antiga: ${error.message}`
      )
    }

    activeConnections.delete(
      key
    )
  }

  // ==================================================
  // NOVA CONEXÃO
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
     * Não criamos nenhuma entrada no Map
     * caso a conexão tenha falhado.
     */
    throw new Error(
      'O adapter não confirmou a conexão com a impressora.'
    )
  }

  // ==================================================
  // REGISTRAR CONEXÃO
  // ==================================================
  //
  // IMPORTANTE:
  //
  // NÃO fazemos mais:
  //
  // options: {
  //   ...options
  // }
  //
  // Portanto accessCode não fica duplicado
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
    `[PrinterManager] ✅ Conexão registrada: ${key}`
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

    key
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
        'Impressora inválida.'
      )
    }

    const entry =
      activeConnections.get(
        key
      )

    // ==================================================
    // JÁ ESTAVA DESCONECTADA
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
       * a referência local.
       */
      activeConnections.delete(
        key
      )
    }

    console.log(
      `[PrinterManager] Conexão removida: ${key}`
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
        'Impressora inválida.'
      )
    }

    const entry =
      getActiveConnection(
        printer
      )

    if (!entry) {
      throw new Error(
        'A impressora não possui conexão ativa.'
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
      // SE O ADAPTER MARCOU A CONEXÃO COMO MORTA
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
// INICIAR IMPRESSÃO
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
        'A impressora não possui conexão ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.startPrint !==
      'function'
    ) {
      throw new Error(
        'Este adapter ainda não suporta início de impressão.'
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
        'A impressora não possui conexão ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.pause !==
      'function'
    ) {
      throw new Error(
        'Este adapter não suporta pausa.'
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
        'A impressora não possui conexão ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.resume !==
      'function'
    ) {
      throw new Error(
        'Este adapter não suporta retomada.'
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
        'A impressora não possui conexão ativa.'
      )
    }

    if (
      typeof entry.adapter
        ?.cancel !==
      'function'
    ) {
      throw new Error(
        'Este adapter não suporta cancelamento.'
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