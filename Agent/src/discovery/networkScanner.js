import os from 'node:os'
import net from 'node:net'
import axios from 'axios'

// ======================================================
// DESCOBRIR INTERFACES DE REDE DO COMPUTADOR
// ======================================================

export const getLocalNetworks = () => {
  const interfaces = os.networkInterfaces()
  const networks = []

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) {
      continue
    }

    for (const address of addresses) {
      if (
        address.family !== 'IPv4' ||
        address.internal
      ) {
        continue
      }

      networks.push({
        interface: name,
        address: address.address,
        netmask: address.netmask
      })
    }
  }

  return networks
}

// ======================================================
// TESTAR SE UMA PORTA ESTÁ ABERTA
// ======================================================

const checkPort = (
  host,
  port,
  timeout = 350
) => {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    let finished = false

    const finish = (result) => {
      if (finished) {
        return
      }

      finished = true

      socket.destroy()

      resolve(result)
    }

    socket.setTimeout(timeout)

    socket.once('connect', () => {
      finish(true)
    })

    socket.once('timeout', () => {
      finish(false)
    })

    socket.once('error', () => {
      finish(false)
    })

    socket.connect(
      port,
      host
    )
  })
}

// ======================================================
// TENTAR IDENTIFICAR MOONRAKER / KLIPPER
// ======================================================

const detectMoonraker = async (
  ip,
  port
) => {
  try {
    const response = await axios.get(
      `http://${ip}:${port}/server/info`,
      {
        timeout: 1000
      }
    )

    if (
      response.data &&
      typeof response.data === 'object'
    ) {
      return {
        connectionType: 'network',
        protocol: 'moonraker',
        software: 'Moonraker / Klipper',
        ip,
        port,
        name:
          response.data?.result?.hostname ||
          'Klipper'
      }
    }
  } catch {
    // não é Moonraker
  }

  return null
}

// ======================================================
// TENTAR IDENTIFICAR OCTOPRINT
// ======================================================

const detectOctoPrint = async (
  ip,
  port
) => {
  try {
    const response = await axios.get(
      `http://${ip}:${port}/api/version`,
      {
        timeout: 1000,

        validateStatus:
          status =>
            status >= 200 &&
            status < 500
      }
    )

    const serverHeader =
      String(
        response.headers?.server ||
        ''
      ).toLowerCase()

    const dataText =
      JSON.stringify(
        response.data || {}
      ).toLowerCase()

    if (
      serverHeader.includes('octoprint') ||
      dataText.includes('octoprint')
    ) {
      return {
        connectionType: 'network',
        protocol: 'octoprint',
        software: 'OctoPrint',
        ip,
        port,
        name: 'OctoPrint'
      }
    }
  } catch {
    // não é OctoPrint
  }

  return null
}

// ======================================================
// TENTAR IDENTIFICAR PRUSALINK
// ======================================================

const detectPrusaLink = async (
  ip,
  port
) => {
  try {
    const response = await axios.get(
      `http://${ip}:${port}/api/version`,
      {
        timeout: 1000,

        validateStatus:
          status =>
            status >= 200 &&
            status < 500
      }
    )

    const headers =
      JSON.stringify(
        response.headers || {}
      ).toLowerCase()

    const data =
      JSON.stringify(
        response.data || {}
      ).toLowerCase()

    if (
      headers.includes('prusa') ||
      data.includes('prusalink') ||
      data.includes('prusa')
    ) {
      return {
        connectionType: 'network',
        protocol: 'prusalink',
        software: 'PrusaLink',
        ip,
        port,
        name: 'Prusa'
      }
    }
  } catch {
    // não é PrusaLink
  }

  return null
}

// ======================================================
// IDENTIFICAR SERVIÇO EM UM IP
// ======================================================

const identifyPrinter = async (
  ip
) => {
  const commonPorts = [
    80,
    7125,
    5000,
    8883
  ]

  for (const port of commonPorts) {
    const open =
      await checkPort(
        ip,
        port
      )

    if (!open) {
      continue
    }

    console.log(
      `[Discovery] Porta aberta: ${ip}:${port}`
    )

    if (port === 8883) {
  console.log(
    `[Discovery] Possível Bambu Lab encontrada em ${ip}:8883`
  )

  return {
    connectionType:
      'network',

    protocol:
      'bambu',

    software:
      'Bambu Lab',

    manufacturer:
      'Bambu Lab',

    ip,

    port:
      8883,

    name:
      'Bambu Lab',

    requiresCredentials:
      true,

    requiredCredentials: [
      'serial',
      'accessCode'
    ]
  }
}

    const moonraker =
      await detectMoonraker(
        ip,
        port
      )

    if (moonraker) {
      return moonraker
    }

    const octoprint =
      await detectOctoPrint(
        ip,
        port
      )

    if (octoprint) {
      return octoprint
    }

    const prusaLink =
      await detectPrusaLink(
        ip,
        port
      )

    if (prusaLink) {
      return prusaLink
    }
  }

  return null
}

// ======================================================
// PEGAR PREFIXO DA REDE
//
// exemplo:
// 192.168.2.179
//
// vira:
// 192.168.2
// ======================================================

const getNetworkPrefix = (
  address
) => {
  const parts =
    address.split('.')

  if (parts.length !== 4) {
    return null
  }

  return `${parts[0]}.${parts[1]}.${parts[2]}`
}

// ======================================================
// ESCANEAR UMA REDE
// ======================================================

const scanNetworkRange = async (
  network
) => {
  const prefix =
    getNetworkPrefix(
      network.address
    )

  if (!prefix) {
    return []
  }

  console.log('')
  console.log(
    `[Discovery] Escaneando rede ${prefix}.1 - ${prefix}.254`
  )

  const printers = []

  // Fazemos em pequenos grupos para não abrir
  // 254 conexões ao mesmo tempo.

  const batchSize = 20

  for (
    let start = 1;
    start <= 254;
    start += batchSize
  ) {
    const end =
      Math.min(
        start +
        batchSize -
        1,
        254
      )

    const tasks = []

    for (
      let host = start;
      host <= end;
      host++
    ) {
      const ip =
        `${prefix}.${host}`

      if (
        ip === network.address
      ) {
        continue
      }

      tasks.push(
        identifyPrinter(ip)
      )
    }

    const results =
      await Promise.all(
        tasks
      )

    for (const result of results) {
      if (result) {
        const alreadyExists =
          printers.some(
            printer =>
              printer.ip === result.ip &&
              printer.protocol ===
                result.protocol
          )

        if (!alreadyExists) {
          printers.push(
            result
          )

          console.log('')
          console.log(
            '[Discovery] Impressora encontrada!'
          )

          console.log(
            `- IP: ${result.ip}`
          )

          console.log(
            `- Tipo: ${result.software}`
          )
        }
      }
    }
  }

  return printers
}

// ======================================================
// SCANNER PRINCIPAL DE REDE
// ======================================================

export const scanNetwork = async () => {
  const networks =
    getLocalNetworks()

  console.log('')
  console.log(
    '[Discovery] Interfaces de rede encontradas:'
  )

  for (const network of networks) {
    console.log(
      `- ${network.interface}: ${network.address}`
    )
  }

  const printers = []

  for (const network of networks) {
    const found =
      await scanNetworkRange(
        network
      )

    printers.push(
      ...found
    )
  }

  return printers
}