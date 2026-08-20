import os from 'node:os'
import net from 'node:net'
import axios from 'axios'

// ======================================================
// CONFIGURAÇÃO DE DESENVOLVIMENTO
// ======================================================

const isMockBambuEnabled = () => {
  return (
    String(
      process.env.PRINTFLOW_DEV_MOCK_BAMBU || ''
    ).toLowerCase() === 'true'
  )
}

// ======================================================
// DESCOBRIR INTERFACES DE REDE DO COMPUTADOR
// ======================================================

export const getLocalNetworks = () => {
  const interfaces =
    os.networkInterfaces()

  const networks = []

  for (
    const [name, addresses]
    of Object.entries(interfaces)
  ) {
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
    const socket =
      new net.Socket()

    let finished = false

    const finish = (result) => {
      if (finished) {
        return
      }

      finished = true

      socket.destroy()

      resolve(result)
    }

    socket.setTimeout(
      timeout
    )

    socket.once(
      'connect',
      () => {
        finish(true)
      }
    )

    socket.once(
      'timeout',
      () => {
        finish(false)
      }
    )

    socket.once(
      'error',
      () => {
        finish(false)
      }
    )

    socket.connect(
      port,
      host
    )
  })
}

// ======================================================
// MOONRAKER / KLIPPER
// ======================================================

const detectMoonraker = async (
  ip,
  port
) => {
  try {
    const response =
      await axios.get(
        `http://${ip}:${port}/server/info`,
        {
          timeout: 1000
        }
      )

    if (
      response.data &&
      typeof response.data ===
        'object'
    ) {
      return {
        connectionType:
          'network',

        protocol:
          'moonraker',

        software:
          'Moonraker / Klipper',

        manufacturer:
          null,

        ip,

        port,

        name:
          response.data
            ?.result
            ?.hostname ||
          'Klipper',

        requiresCredentials:
          false
      }
    }
  } catch {
    // Não é Moonraker.
  }

  return null
}

// ======================================================
// OCTOPRINT
// ======================================================

const detectOctoPrint = async (
  ip,
  port
) => {
  try {
    const response =
      await axios.get(
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
        response.headers
          ?.server ||
        ''
      ).toLowerCase()

    const dataText =
      JSON.stringify(
        response.data || {}
      ).toLowerCase()

    if (
      serverHeader.includes(
        'octoprint'
      ) ||
      dataText.includes(
        'octoprint'
      )
    ) {
      return {
        connectionType:
          'network',

        protocol:
          'octoprint',

        software:
          'OctoPrint',

        manufacturer:
          null,

        ip,

        port,

        name:
          'OctoPrint',

        requiresCredentials:
          false
      }
    }
  } catch {
    // Não é OctoPrint.
  }

  return null
}

// ======================================================
// PRUSALINK
// ======================================================

const detectPrusaLink = async (
  ip,
  port
) => {
  try {
    const response =
      await axios.get(
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
      headers.includes(
        'prusa'
      ) ||
      data.includes(
        'prusalink'
      ) ||
      data.includes(
        'prusa'
      )
    ) {
      return {
        connectionType:
          'network',

        protocol:
          'prusalink',

        software:
          'PrusaLink',

        manufacturer:
          'Prusa',

        ip,

        port,

        name:
          'Prusa',

        requiresCredentials:
          false
      }
    }
  } catch {
    // Não é PrusaLink.
  }

  return null
}

// ======================================================
// CANDIDATO BAMBU
// ======================================================

const createBambuCandidate = (
  ip
) => {
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
    ],

    mock:
      false
  }
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

  for (
    const port
    of commonPorts
  ) {
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

    // ==================================================
    // BAMBU
    // ==================================================

    if (
      port === 8883
    ) {
      console.log(
        `[Discovery] Possível Bambu Lab encontrada em ${ip}:8883`
      )

      return createBambuCandidate(
        ip
      )
    }

    // ==================================================
    // MOONRAKER
    // ==================================================

    const moonraker =
      await detectMoonraker(
        ip,
        port
      )

    if (moonraker) {
      return moonraker
    }

    // ==================================================
    // OCTOPRINT
    // ==================================================

    const octoprint =
      await detectOctoPrint(
        ip,
        port
      )

    if (octoprint) {
      return octoprint
    }

    // ==================================================
    // PRUSALINK
    // ==================================================

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
// 192.168.2.179
//
// vira:
//
// 192.168.2
//
// ATENÇÃO:
// Esta versão ainda assume rede /24.
// Depois vamos calcular pela netmask.
// ======================================================

const getNetworkPrefix = (
  address
) => {
  const parts =
    address.split('.')

  if (
    parts.length !== 4
  ) {
    return null
  }

  return (
    `${parts[0]}.` +
    `${parts[1]}.` +
    `${parts[2]}`
  )
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

  /*
   * Fazemos em pequenos grupos para evitar
   * abrir 254 conexões simultaneamente.
   */

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

      // Não precisamos testar o próprio PC.

      if (
        ip ===
        network.address
      ) {
        continue
      }

      tasks.push(
        identifyPrinter(
          ip
        )
      )
    }

    const results =
      await Promise.all(
        tasks
      )

    for (
      const result
      of results
    ) {
      if (!result) {
        continue
      }

      const alreadyExists =
        printers.some(
          printer =>
            printer.ip ===
              result.ip &&
            printer.protocol ===
              result.protocol
        )

      if (
        alreadyExists
      ) {
        continue
      }

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

      console.log(
        `- Protocolo: ${result.protocol}`
      )
    }
  }

  return printers
}

// ======================================================
// BAMBU SIMULADA PARA DESENVOLVIMENTO
// ======================================================

const addMockBambu = (
  printers
) => {
  if (
    !isMockBambuEnabled()
  ) {
    return
  }

  const mockIp =
    '192.168.2.250'

  const alreadyExists =
    printers.some(
      printer =>
        printer.protocol ===
          'bambu' &&
        printer.ip ===
          mockIp
    )

  if (
    alreadyExists
  ) {
    return
  }

  const mockPrinter = {
    connectionType:
      'network',

    protocol:
      'bambu',

    software:
      'Bambu Lab',

    manufacturer:
      'Bambu Lab',

    name:
      'Bambu Lab - Ambiente de Teste',

    ip:
      mockIp,

    port:
      8883,

    requiresCredentials:
      true,

    requiredCredentials: [
      'serial',
      'accessCode'
    ],

    mock:
      true
  }

  printers.push(
    mockPrinter
  )

  console.log('')

  console.log(
    '================================='
  )

  console.log(
    '       BAMBU MOCK - DEV'
  )

  console.log(
    '================================='
  )

  console.log(
    '[DEV] Bambu simulada adicionada à descoberta.'
  )

  console.log(
    `[DEV] IP: ${mockPrinter.ip}`
  )

  console.log(
    `[DEV] Porta: ${mockPrinter.port}`
  )

  console.log('')
}

// ======================================================
// SCANNER PRINCIPAL
// ======================================================

export const scanNetwork = async () => {
  const networks =
    getLocalNetworks()

  console.log('')

  console.log(
    '[Discovery] Interfaces de rede encontradas:'
  )

  if (
    networks.length === 0
  ) {
    console.log(
      '[Discovery] Nenhuma interface IPv4 disponível.'
    )
  }

  for (
    const network
    of networks
  ) {
    console.log(
      `- ${network.interface}: ${network.address}`
    )
  }

  const printers = []

  // ====================================================
  // DESCOBERTA REAL
  // ====================================================

  for (
    const network
    of networks
  ) {
    const found =
      await scanNetworkRange(
        network
      )

    printers.push(
      ...found
    )
  }

  // ====================================================
  // MOCK SOMENTE SE HABILITADO
  // ====================================================

  addMockBambu(
    printers
  )

  return printers
}