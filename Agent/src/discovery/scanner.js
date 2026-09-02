import { scanNetwork } from './networkScanner.js'
import { scanUsb } from './usbScanner.js'

export const discoverPrinters = async () => {
  console.log('')
  console.log('=================================')
  console.log('     DESCOBERTA DE IMPRESSORAS')
  console.log('=================================')

  const networkPrinters = await scanNetwork()
  const usbPrinters = await scanUsb()

  const printers = [
    ...networkPrinters,
    ...usbPrinters
  ]

  console.log('')
  console.log(
    `[Discovery] ${printers.length} impressora(s) encontrada(s).`
  )

  return printers
}