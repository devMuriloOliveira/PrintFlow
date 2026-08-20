import {
  discoverPrinters
} from '../discovery/scanner.js'

import {
  connectPrinter,
  getPrinterStatus,
  pausePrinter,
  resumePrinter,
  cancelPrinter
} from '../printers/printerManager.js'

// ======================================================
// HANDLER PRINCIPAL
// ======================================================

export const handleCommand = async (
  command
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

    const options =
      command.payload?.options ||
      {}

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora não foram enviados.'
      }
    }

    if (
      !printer.protocol
    ) {
      return {
        success: false,
        error:
          'Protocolo da impressora não informado.'
      }
    }

    try {
      console.log('')
      console.log(
        'Iniciando conexão com impressora...'
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

      const connection =
        await connectPrinter(
          printer,
          options
        )

      console.log('')
      console.log(
        '✅ Impressora conectada pelo adapter.'
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

          ip:
            printer.ip ||
            null,

          port:
            printer.port ||
            null,

          serial:
            printer.serial ||
            null
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
            null
        }
      }
    } catch (error) {
      console.log('')
      console.log(
        '❌ Não foi possível conectar à impressora.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao conectar à impressora.'
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
          'Dados da impressora não foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Consultando status da impressora...'
      )

      const status =
        await getPrinterStatus(
          printer
        )

      console.log('')
      console.log(
        '✅ Status recebido.'
      )

      return {
        success: true,
        status
      }
    } catch (error) {
      console.log('')
      console.log(
        '❌ Não foi possível consultar o status.'
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
  // PAUSAR IMPRESSÃO
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
          'Dados da impressora não foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Pausando impressão...'
      )

      const result =
        await pausePrinter(
          printer
        )

      console.log(
        '✅ Comando de pausa enviado.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        '❌ Não foi possível pausar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao pausar impressão.'
      }
    }
  }

  // ====================================================
  // RETOMAR IMPRESSÃO
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
          'Dados da impressora não foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Retomando impressão...'
      )

      const result =
        await resumePrinter(
          printer
        )

      console.log(
        '✅ Comando de retomada enviado.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        '❌ Não foi possível retomar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao retomar impressão.'
      }
    }
  }

  // ====================================================
  // CANCELAR IMPRESSÃO
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
          'Dados da impressora não foram enviados.'
      }
    }

    try {
      console.log('')
      console.log(
        'Cancelando impressão...'
      )

      const result =
        await cancelPrinter(
          printer
        )

      console.log(
        '✅ Comando de cancelamento enviado.'
      )

      return {
        success: true,
        result
      }
    } catch (error) {
      console.log(
        '❌ Não foi possível cancelar.'
      )

      console.log(
        'Erro:',
        error.message
      )

      return {
        success: false,

        error:
          error.message ||
          'Falha ao cancelar impressão.'
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