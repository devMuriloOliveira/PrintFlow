import { discoverPrinters } from '../discovery/scanner.js'

import {
  connectPrinter
} from '../printers/printerManager.js'

export const handleCommand = async (command) => {
  console.log('')
  console.log('=================================')
  console.log('        COMANDO RECEBIDO')
  console.log('=================================')

  console.log('ID:', command.id)
  console.log('Tipo:', command.type)

  // ======================================================
  // DESCOBRIR IMPRESSORAS
  // ======================================================

  if (command.type === 'discover_printers') {
    console.log('')
    console.log('Iniciando busca de impressoras...')

    const printers =
      await discoverPrinters()

    return {
      success: true,
      printers
    }
  }

  // ======================================================
  // CONECTAR IMPRESSORA
  // ======================================================

  if (command.type === 'connect_printer') {
    console.log('')
    console.log(
      'Iniciando conexão com impressora...'
    )

    const printer =
      command.payload?.printer

    const options =
      command.payload?.options || {}

    if (!printer) {
      return {
        success: false,
        error:
          'Dados da impressora não foram enviados.'
      }
    }

    if (!printer.protocol) {
      return {
        success: false,
        error:
          'Protocolo da impressora não informado.'
      }
    }

    try {
      console.log(
        '[Printer] Protocolo:',
        printer.protocol
      )

      if (printer.ip) {
        console.log(
          '[Printer] IP:',
          printer.ip
        )
      }

      if (
        printer.connectionType === 'usb' &&
        printer.port
      ) {
        console.log(
          '[Printer] Porta:',
          printer.port
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

      /*
       * Muito importante:
       *
       * Não retornamos o objeto "connection"
       * completo para o BackEnd.
       *
       * Ele pode conter socket MQTT,
       * eventos, referências internas etc.
       *
       * Retornamos apenas dados seguros.
       */

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
            connection?.connected === true,

          protocol:
            connection?.protocol ||
            printer.protocol
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

  // ======================================================
  // COMANDO DESCONHECIDO
  // ======================================================

  console.log('')
  console.log(
    'Comando desconhecido:',
    command.type
  )

  return {
    success: false,
    error: 'Comando desconhecido'
  }
}