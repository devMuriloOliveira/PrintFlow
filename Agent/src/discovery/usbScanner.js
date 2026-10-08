import { SerialPort } from 'serialport'

import {
  getPrinterProfile
} from '../printers/printerProfiles.js'

// ======================================================
// CONSULTAR PORTAS SERIAIS NO WINDOWS
// ======================================================

const getWindowsSerialPorts = async () => {
  try {
    const ports = await SerialPort.list()
    return ports.map(port => ({
      DeviceID: port.path,
      Name: port.friendlyName || port.manufacturer || port.path,
      Description: port.friendlyName || '',
      Manufacturer: port.manufacturer || '',
      PNPDeviceID: port.pnpId || ''
    }))
  } catch (error) {
    console.log(
      '[USB] Nao foi possivel consultar as portas seriais:',
      error.message
    )

    return []
  }
}

// ======================================================
// NORMALIZAR PORTA
// ======================================================

const normalizeWindowsPort = (device) => {
  return {
    connectionType: 'usb',
    protocol: 'serial',

    port:
      device.DeviceID ||
      null,

    name:
      device.Name ||
      device.Description ||
      'Dispositivo serial',

    manufacturer:
      device.Manufacturer ||
      null,

    description:
      device.Description ||
      null,

    pnpDeviceId:
      device.PNPDeviceID ||
      null,

    identified: false
  }
}

// ======================================================
// TESTAR MARLIN
// ======================================================

const testMarlin = async (
  device,
  baudRate,
  signal
) => {
  return new Promise((resolve) => {
    let finished = false
    let received = ''

    const serial = new SerialPort({
      path: device.port,
      baudRate,
      autoOpen: false
    })

    const finish = (result) => {
      if (finished) {
        return
      }

      finished = true
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timeout)

      try {
        if (serial.isOpen) {
          serial.close()
        }
      } catch {
        // ignora erro ao fechar
      }

      resolve(result)
    }

    const timeout = setTimeout(() => {
      finish(null)
    }, 3000)
    const onAbort = () => finish(null)
    if (signal?.aborted) {
      finish(null)
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    serial.on('data', (data) => {
      received += data.toString()

      const text =
        received.toLowerCase()

      if (
        text.includes('firmware_name') ||
        text.includes('marlin')
      ) {
        clearTimeout(timeout)

        finish({
          ...device,

          protocol: 'marlin',

          firmware: received.trim(),

          baudRate,

          identified: true,

          requiresCredentials:
            false,

          requiredCredentials:
            getPrinterProfile(
              'marlin'
            ).requiredOptionFields
        })
      }
    })

    serial.on('error', () => {
      clearTimeout(timeout)
      finish(null)
    })

    serial.open((error) => {
      if (error) {
        clearTimeout(timeout)
        finish(null)
        return
      }

      setTimeout(() => {
        try {
          serial.write(
            'M115\n'
          )
        } catch {
          clearTimeout(timeout)
          finish(null)
        }
      }, 500)
    })
  })
}

// ======================================================
// IDENTIFICAR IMPRESSORA SERIAL
// ======================================================

const identifySerialPrinter = async (
  device,
  signal
) => {
  const baudRates = [
    115200,
    250000
  ]

  for (const baudRate of baudRates) {
    if (signal?.aborted) throw signal.reason || new Error('Descoberta cancelada.')
    console.log(
      `[USB] Testando ${device.port} em ${baudRate} baud...`
    )

    const result =
      await testMarlin(
        device,
        baudRate,
        signal
      )

    if (result) {
      console.log('')
      console.log(
        '[USB] Impressora Marlin identificada!'
      )

      console.log(
        `- Porta: ${result.port}`
      )

      console.log(
        `- Baud rate: ${result.baudRate}`
      )

      return result
    }
  }

  return null
}

// ======================================================
// SCANNER USB
// ======================================================

export const scanUsb = async ({ signal, onPrinterDiscovered } = {}) => {
  console.log('')
  console.log(
    '[Discovery] Procurando dispositivos USB / Serial...'
  )

  if (
    process.platform !== 'win32'
  ) {
    console.log(
      '[USB] Scanner serial desta versao disponivel apenas para Windows.'
    )

    return []
  }

  const devices =
    await getWindowsSerialPorts()

  if (!devices.length) {
    console.log(
      '[USB] Nenhuma porta serial encontrada.'
    )

    return []
  }

  const serialDevices =
    devices
      .filter(
        device =>
          device.DeviceID
      )
      .map(
        normalizeWindowsPort
      )

  const printers = []

  for (const device of serialDevices) {
    if (signal?.aborted) throw signal.reason || new Error('Descoberta cancelada.')
    console.log('')
    console.log(
      '[USB] Dispositivo serial encontrado'
    )

    console.log(
      `- Porta: ${device.port}`
    )

    console.log(
      `- Nome: ${device.name}`
    )

    if (device.manufacturer) {
      console.log(
        `- Fabricante: ${device.manufacturer}`
      )
    }

    const printer =
      await identifySerialPrinter(
        device,
        signal
      )

    if (printer) {
      printers.push(
        printer
      )
      onPrinterDiscovered?.(printer)
    } else {
      console.log(
        `[USB] ${device.port} nao foi identificada como impressora Marlin.`
      )
    }
  }

  return printers
}
