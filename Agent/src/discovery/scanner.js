import {
  scanNetworkWithDiagnostics
} from './networkScanner.js'
import { scanUsb } from './usbScanner.js'

export const discoverPrintersWithDiagnostics = async () => {
  console.log('')
  console.log('=================================')
  console.log('     DESCOBERTA DE IMPRESSORAS')
  console.log('=================================')

  const networkDiscovery =
    await scanNetworkWithDiagnostics()
  const usbPrinters = await scanUsb()

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
