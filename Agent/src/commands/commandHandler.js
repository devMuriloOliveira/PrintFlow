import {
  discoverPrinters
} from '../discovery/scanner.js'

import {
  connectPrinter,
  disconnectPrinter,
  getPrinterStatus,
  hasActiveConnection,
  startPrinterJob,
  pausePrinter,
  resumePrinter,
  cancelPrinter
} from '../printers/printerManager.js'

import {
  ensurePrintFileCached
} from '../files/printFileCache.js'

import {
  loadPrinterCredentials,
  savePrinterCredentials
} from '../storage/printerCredentials.js'

const allowedPrintFormatsByProtocol = {
  bambu:
    new Set(['3mf', 'gcode', 'bgcode']),
  marlin:
    new Set(['gcode']),
  octoprint:
    new Set(['gcode']),
  moonraker:
    new Set(['gcode']),
  prusalink:
    new Set(['gcode', 'bgcode'])
}

const normalizeText = (
  value
) =>
  String(value || '')
    .trim()
    .toLowerCase()

const assertPrintFileFormat = (
  printer,
  job
) => {
  const protocol =
    normalizeText(
      printer?.protocol
    )

  const format =
    normalizeText(
      job?.printFile
        ?.format
    )

  const allowed =
    allowedPrintFormatsByProtocol[
      protocol
    ]

  if (
    allowed &&
    !allowed.has(
      format
    )
  ) {
    throw new Error(
      `Formato ${format.toUpperCase()} nao suportado para ${protocol}.`
    )
  }
}

const getOptionsWithStoredCredentials =
  async (
    printer,
    options = {}
  ) => {
    const stored =
      await loadPrinterCredentials(
        printer
      )

    return {
      ...stored,
      ...options
    }
  }

const ensurePrinterConnection =
  async (
    printer
  ) => {
    if (
      hasActiveConnection(
        printer
      )
    ) {
      return {
        reconnected:
          false
      }
    }

    const options =
      await loadPrinterCredentials(
        printer
      )

    const connection =
      await connectPrinter(
        printer,
        options
      )

    return {
      reconnected:
        true,
      connection
    }
  }

// ======================================================
// HANDLER PRINCIPAL
// ======================================================

export const handleCommand = async (
  command,
  context = {}
) => {
  console.log('')
  console.log(
    '================================='
  )
  console.log(
    '        COMANDO RECEBIDO'
  )
  console.log(
    '================================='
  )

  console.log(
    `ID: ${command.id}`
  )

  console.log(
    `Tipo: ${command.type}`
  )

  // ====================================================
  // DESCOBRIR IMPRESSORAS
  // ====================================================

  if (
    command.type ===
    'discover_printers'
  ) {
    const printers =
      await discoverPrinters()

    return {
      success: true,
      printers
    }
  }

  // ====================================================
  // CONECTAR IMPRESSORA
  // ====================================================

  if (
    command.type ===
    'connect_printer'
  ) {
    const printer =
      command.payload?.printer

    const commandOptions =
      command.payload?.options ||
      {}

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    if (
      !printer.protocol
    ) {
      return {
        success: false,
        error:
          'Protocolo da impressora nao informado.'
      }
    }

    try {
      console.log('')
      console.log(
        'Iniciando conexao com impressora...'
      )

      console.log(
        `[Printer] Protocolo: ${printer.protocol}`
      )

      if (
        printer.ip
      ) {
        console.log(
          `[Printer] IP: ${printer.ip}`
        )
      }

      if (
        printer.port &&
        printer.connectionType ===
          'usb'
      ) {
        console.log(
          `[Printer] Porta USB: ${printer.port}`
        )
      }

      const options =
        await getOptionsWithStoredCredentials(
          printer,
          commandOptions
        )

      const connection =
        await connectPrinter(
          printer,
          options
        )

      await savePrinterCredentials(
        printer,
        options
      )

      console.log('')
      console.log(
        'Impressora conectada pelo adapter.'
      )

      return {
        success: true,

        printer: {
          protocol:
            printer.protocol,

          connectionType:
            printer.connectionType ||
            null,

          name:
            printer.name ||
            null,

          manufacturer:
            printer.manufacturer ||
            null,

          model:
            printer.model ||
            null,

          software:
            printer.software ||
            null,

          ip:
            printer.ip ||
            null,

          port:
            printer.port ||
            null,

          baudRate:
            printer.baudRate ||
            connection?.baudRate ||
            null,

          serial:
            printer.serial ||
            null,

          firmware:
            printer.firmware ||
            connection?.firmware ||
            null,

          mock:
            printer.mock ===
            true
        },

        connection: {
          connected:
            connection?.connected ===
            true,

          protocol:
            connection?.protocol ||
            printer.protocol,

          reused:
            connection?.reused ===
            true,

          key:
            connection?.key ||
            null,

          capabilities:
            connection?.capabilities ||
            {}
        }
      }
    } catch (error) {
      console.log('')
      console.log(
        'Nao foi possivel conectar a impressora.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao conectar a impressora.'
      }
    }
  }

  // ====================================================
  // DESCONECTAR IMPRESSORA
  // ====================================================

  if (
    command.type ===
    'disconnect_printer'
  ) {
    const printer =
      command.payload?.printer

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Desconectando impressora...'
      )

      const result =
        await disconnectPrinter(
          printer
        )

      console.log(
        'Impressora desconectada.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        'Nao foi possivel desconectar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao desconectar impressora.'
      }
    }
  }

  // ====================================================
  // INICIAR IMPRESSAO
  // ====================================================

  if (
    command.type ===
    'start_print'
  ) {
    const printer =
      command.payload?.printer

    let job =
      command.payload?.job ||
      {}

    if (
      printer &&
      (
        job.validationStatus !==
          'validated' ||
        !job.printFile
          ?.name ||
        !job.printFile
          ?.format
      )
    ) {
      return {
        success: false,
        error:
          'Receita de impressao nao validada para envio ao Agent.'
      }
    }

    if (
      printer &&
      !printer.mock &&
      !job.printFile
        ?.storageKey
    ) {
      return {
        success: false,
        error:
          'Arquivo de impressao nao foi disponibilizado para download.'
      }
    }

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Iniciando impressao...'
      )

      assertPrintFileFormat(
        printer,
        job
      )

      await ensurePrinterConnection(
        printer
      )

      if (
        job.printFile
          ?.storageKey
      ) {
        if (
          !context.apiUrl ||
          !context.credentials
        ) {
          throw new Error(
            'Contexto do Agent ausente para baixar o arquivo.'
          )
        }

        const cachedFile =
          await ensurePrintFileCached(
            context.apiUrl,
            context.credentials,
            job.printFile
          )

        job = {
          ...job,
          printFile:
            cachedFile
        }

        console.log(
          `[PrintFile] Arquivo pronto: ${cachedFile.localPath}`
        )
      }

      const result =
        await startPrinterJob(
          printer,
          job
        )

      console.log(
        'Impressao iniciada.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        'Nao foi possivel iniciar a impressao.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao iniciar impressao.'
      }
    }
  }

  // ====================================================
  // STATUS
  // ====================================================

  if (
    command.type ===
    'printer_status'
  ) {
    const printer =
      command.payload?.printer

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Consultando status da impressora...'
      )

      await ensurePrinterConnection(
        printer
      )

      const status =
        await getPrinterStatus(
          printer
        )

      console.log('')
      console.log(
        'Status recebido.'
      )

      return {
        success: true,
        status
      }
    } catch (error) {
      console.log('')
      console.log(
        'Nao foi possivel consultar o status.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao consultar status da impressora.'
      }
    }
  }


  // ====================================================
  // PAUSAR IMPRESSAO
  // ====================================================

  if (
    command.type ===
    'printer_pause'
  ) {
    const printer =
      command.payload?.printer

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Pausando impressao...'
      )

      await ensurePrinterConnection(
        printer
      )

      const result =
        await pausePrinter(
          printer
        )

      console.log(
        'Comando de pausa enviado.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        'Nao foi possivel pausar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao pausar impressao.'
      }
    }
  }

  // ====================================================
  // RETOMAR IMPRESSAO
  // ====================================================

  if (
    command.type ===
    'printer_resume'
  ) {
    const printer =
      command.payload?.printer

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Retomando impressao...'
      )

      await ensurePrinterConnection(
        printer
      )

      const result =
        await resumePrinter(
          printer
        )

      console.log(
        'Comando de retomada enviado.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        'Nao foi possivel retomar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao retomar impressao.'
      }
    }
  }

  // ====================================================
  // CANCELAR IMPRESSAO
  // ====================================================

  if (
    command.type ===
    'printer_cancel'
  ) {
    const printer =
      command.payload?.printer

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora nao foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Cancelando impressao...'
      )

      await ensurePrinterConnection(
        printer
      )

      const result =
        await cancelPrinter(
          printer
        )

      console.log(
        'Comando de cancelamento enviado.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        'Nao foi possivel cancelar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao cancelar impressao.'
      }
    }
  }

  // ====================================================
  // COMANDO DESCONHECIDO
  // ====================================================

  return {
    success: false,
    error:
      'Comando desconhecido'
  }
}
