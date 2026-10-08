import {
  scanNetworkWithDiagnostics
} from './networkScanner.js'
import { scanUsb } from './usbScanner.js'

export const discoverPrintersWithDiagnostics = async ({ signal, onPrinterDiscovered } = {}) => {
  console.log('')
  console.log('=================================')
  console.log('     DESCOBERTA DE IMPRESSORAS')
  console.log('=================================')

  const networkDiscovery =
    await scanNetworkWithDiagnostics({ signal, onPrinterDiscovered })
  const usbPrinters = await scanUsb({ signal, onPrinterDiscovered })

  if (signal?.aborted) throw signal.reason || new Error('Descoberta cancelada.')

  const printers = [
    ...networkDiscovery.printers,
    ...usbPrinters
  ]

  console.log('')
  console.log(
    `[Discovery] ${printers.length} impressora(s) encontrada(s).`
  )

  return {
    printers,
    diagnostics: {
      warnings:
        networkDiscovery.warnings || []
    }
  }
}

export const discoverPrinters = async () =>
  (await discoverPrintersWithDiagnostics()).printers
