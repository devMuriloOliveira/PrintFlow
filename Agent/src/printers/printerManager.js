import { bambuAdapter } from './adapters/bambuAdapter.js'
import { moonrakerAdapter } from './adapters/moonrakerAdapter.js'
import { octoprintAdapter } from './adapters/octoprintAdapter.js'
import { prusaLinkAdapter } from './adapters/prusaLinkAdapter.js'
import { marlinSerialAdapter } from './adapters/marlinSerialAdapter.js'

const adapters = {
  bambu: bambuAdapter,
  moonraker: moonrakerAdapter,
  octoprint: octoprintAdapter,
  prusalink: prusaLinkAdapter,
  marlin: marlinSerialAdapter
}

export const getPrinterAdapter = (printer) => {
  const protocol = String(
    printer?.protocol || ''
  ).toLowerCase()

  const adapter = adapters[protocol]

  if (!adapter) {
    throw new Error(
      `Protocolo de impressora não suportado: ${protocol || 'desconhecido'}`
    )
  }

  return adapter
}

export const connectPrinter = async (
  printer,
  options = {}
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.connect(
    printer,
    options
  )
}

export const disconnectPrinter = async (
  printer,
  connection
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.disconnect(
    printer,
    connection
  )
}

export const getPrinterStatus = async (
  printer,
  connection
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.getStatus(
    printer,
    connection
  )
}

export const startPrinterJob = async (
  printer,
  connection,
  job
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.startPrint(
    printer,
    connection,
    job
  )
}

export const pausePrinter = async (
  printer,
  connection
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.pausePrint(
    printer,
    connection
  )
}

export const resumePrinter = async (
  printer,
  connection
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.resumePrint(
    printer,
    connection
  )
}

export const cancelPrinter = async (
  printer,
  connection
) => {
  const adapter = getPrinterAdapter(printer)

  return await adapter.cancelPrint(
    printer,
    connection
  )
}