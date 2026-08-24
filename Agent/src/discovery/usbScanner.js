import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SerialPort } from 'serialport'

import {
  getPrinterProfile
} from '../printers/printerProfiles.js'

const execFileAsync = promisify(execFile)

// ======================================================
// CONSULTAR PORTAS SERIAIS NO WINDOWS
// ======================================================

const getWindowsSerialPorts = async () => {
  const script = `
    $ports = Get-CimInstance Win32_SerialPort |
      Select-Object DeviceID, Name, Description, Manufacturer, PNPDeviceID

    $ports | ConvertTo-Json -Compress
  `

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script
      ],
      {
        windowsHide: true,
        timeout: 10_000
      }
    )

    const output = stdout.trim()

    if (!output) {
      return []
    }

    const parsed = JSON.parse(output)

    return Array.isArray(parsed)
      ? parsed
      : [parsed]
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
  baudRate
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
  device
) => {
  const baudRates = [
    115200,
    250000
  ]

  for (const baudRate of baudRates) {
    console.log(
      `[USB] Testando ${device.port} em ${baudRate} baud...`
    )

    const result =
      await testMarlin(
        device,
        baudRate
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

export const scanUsb = async () => {
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
        device
      )

    if (printer) {
      printers.push(
        printer
      )
    } else {
      console.log(
        `[USB] ${device.port} nao foi identificada como impressora Marlin.`
      )
    }
  }

  return printers
}
