import os from 'node:os'
import net from 'node:net'
import dgram from 'node:dgram'
import axios from 'axios'

import {
  getPrinterProfile
} from '../printers/printerProfiles.js'

// ======================================================
// CONFIGURACAO DE DESENVOLVIMENTO
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
// TESTAR SE UMA PORTA ESTA ABERTA
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
          false,

        requiredCredentials:
          getPrinterProfile(
            'moonraker'
          ).requiredOptionFields
      }
    }
  } catch {
    // Nao e Moonraker.
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
          true,

        requiredCredentials:
          getPrinterProfile(
            'octoprint'
          ).requiredOptionFields
      }
    }
  } catch {
    // Nao e OctoPrint.
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
          true,

        requiredCredentials:
          getPrinterProfile(
            'prusalink'
          ).requiredOptionFields
      }
    }
  } catch {
    // Nao e PrusaLink.
  }

  return null
}

// ======================================================
// CANDIDATO BAMBU
// ======================================================

const createBambuCandidate = (
  ip,
  details = {}
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

    serial:
      details.serial ||
      undefined,

    model:
      details.model ||
      undefined,

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

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1990

export const parseSsdpHeaders = (
  message
) => {
  const lines = String(message || '').split(/\r?\n/)
  const headers = {}

  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue

    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key && value) headers[key] = value
  }

  return headers
}

const firstHeader = (
  headers,
  names
) => names
  .map(name => headers[name])
  .find(value => String(value || '').trim()) || ''

const parseSsdpBambuResponse = (
  message,
  remoteAddress
) => {
  const text = String(message || '')
  const headers = parseSsdpHeaders(text)
  const fingerprint = [
    text,
    headers.server,
    headers.location,
    headers.st,
    headers.usn,
    headers['device-type']
  ].join(' ').toLowerCase()

  if (!fingerprint.includes('bambu')) return null

  const serialHeader = firstHeader(headers, [
    'serial',
    'serial-number',
    'device-serial',
    'x-serial',
    'x-device-serial'
  ])

  const serial = serialHeader ||
    text.match(
      /<(?:serialNumber|serial|deviceSerial)>\s*([^<\s]+)\s*<\//i
    )?.[1] ||
    text.match(
      /(?:serial(?:[-_ ]?number)?|device[-_ ]?serial)\s*[:=]\s*([A-Za-z0-9._-]+)/i
    )?.[1] ||
    ''

  const modelHeader = firstHeader(headers, [
    'model',
    'device-model',
    'x-model'
  ])

  const model = modelHeader ||
    text.match(
      /<(?:model|deviceModel)>\s*([^<\s]+)\s*<\//i
    )?.[1] ||
    ''

  return createBambuCandidate(
    remoteAddress,
    {
      serial,
      model
    }
  )
}

export const discoverBambuSsdp = ({
  socketFactory = () => dgram.createSocket('udp4'),
  timeoutMs = Number(process.env.PRINTFLOW_BAMBU_SSDP_TIMEOUT_MS || 1200)
} = {}) => new Promise((resolve) => {
  const socket = socketFactory()
  const found = new Map()
  let settled = false

  const finish = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try { socket.close() } catch { /* socket already closed */ }
    resolve([...found.values()])
  }

  const timer = setTimeout(finish, Math.max(100, timeoutMs))
  const request = Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    'MX: 1',
    'ST: ssdp:all',
    '',
    ''
  ].join('\r\n'))

  socket.on('message', (message, remote) => {
    const candidate = parseSsdpBambuResponse(
      message.toString('utf8'),
      remote?.address
    )
    if (!candidate?.ip) return

    const existing = found.get(candidate.ip)
    found.set(candidate.ip, {
      ...(existing || {}),
      ...candidate,
      serial: candidate.serial || existing?.serial,
      model: candidate.model || existing?.model
    })
  })

  socket.once('error', finish)
  socket.bind(() => {
    socket.send(request, 0, request.length, SSDP_PORT, SSDP_ADDRESS)
  })
})

// ======================================================
// IDENTIFICAR SERVICO EM UM IP
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
        `[Discovery] Possivel Bambu Lab encontrada em ${ip}:8883`
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
// CALCULAR FAIXA IPv4 DA INTERFACE
// ======================================================

const ipv4ToInt = (
  value
) => {
  const parts =
    String(value || '').split('.')

  if (
    parts.length !== 4 ||
    parts.some(
      part =>
        !/^\d+$/.test(part) ||
        Number(part) > 255
    )
  ) {
    return null
  }

  return parts.reduce(
    (valuePart, part) =>
      ((valuePart << 8) |
        Number(part)) >>> 0,
    0
  )
}

const intToIpv4 = (
  value
) => [
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255
].join('.')

export const getNetworkHostRange = (
  address,
  netmask,
  maxHosts = Number(
    process.env.PRINTFLOW_DISCOVERY_MAX_HOSTS ||
    1024
  )
) => {
  const addressInt =
    ipv4ToInt(address)
  const maskInt =
    ipv4ToInt(netmask)

  if (
    addressInt === null ||
    maskInt === null
  ) {
    return null
  }

  const networkInt =
    (addressInt & maskInt) >>> 0
  const broadcastInt =
    (networkInt | (~maskInt >>> 0)) >>> 0
  const firstHost =
    networkInt + 1
  const lastHost =
    broadcastInt - 1

  if (
    firstHost > lastHost
  ) {
    return null
  }

  const boundedMax =
    Math.max(
      1,
      Math.min(
        4096,
        Number(maxHosts) || 1024
      )
    )
  const end =
    Math.min(
      lastHost,
      firstHost + boundedMax - 1
    )

  return {
    start:
      intToIpv4(firstHost),
    end:
      intToIpv4(end),
    truncated:
      end < lastHost,
    totalHosts:
      broadcastInt - networkInt - 1
  }
}

// ======================================================
// ESCANEAR UMA REDE
// ======================================================

const scanNetworkRange = async (
  network
) => {
  const range =
    getNetworkHostRange(
      network.address,
      network.netmask
    )

  if (!range) {
    return []
  }

  const startInt =
    ipv4ToInt(range.start)
  const endInt =
    ipv4ToInt(range.end)

  console.log('')

  console.log(
    `[Discovery] Escaneando rede ${range.start} - ${range.end}`
  )

  if (range.truncated) {
    console.log(
      `[Discovery] Faixa limitada a ${range.totalHosts > 1024 ? 1024 : range.totalHosts} hosts por segurança.`
    )
  }

  const printers = []

  /*
   * Fazemos em pequenos grupos para evitar
   * abrir 254 conexoes simultaneamente.
   */

  const batchSize = 20

  for (
    let start = startInt;
    start <= endInt;
    start += batchSize
  ) {
    const end =
      Math.min(
        start +
          batchSize -
          1,
        endInt
      )

    const tasks = []

    for (
      let host = start;
      host <= end;
      host++
    ) {
      const ip =
        intToIpv4(host)

      // Nao precisamos testar o proprio PC.

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

    serial:
      'PFMOCKBAMBU001',

    ip:
      mockIp,

    port:
      8883,

    requiresCredentials:
      false,

    requiredCredentials: [
      'serial'
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
    '[DEV] Bambu simulada adicionada a descoberta.'
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
  if (
    isMockBambuEnabled()
  ) {
    const printers = []

    addMockBambu(
      printers
    )

    return printers
  }

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
      '[Discovery] Nenhuma interface IPv4 disponivel.'
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
  // DESCOBERTA REAL POR SSDP (BAMBU)
  // ====================================================

  try {
    const ssdpPrinters = await discoverBambuSsdp()
    printers.push(...ssdpPrinters)

    for (const result of ssdpPrinters) {
      console.log('')
      console.log('[Discovery] Bambu encontrada por SSDP.')
      console.log(`- IP: ${result.ip}`)
      console.log(`- Serial: ${result.serial || 'nao informado'}`)
    }
  } catch (error) {
    console.warn(
      `[Discovery] SSDP indisponivel; usando varredura de portas. ${error.message}`
    )
  }

  // ====================================================
  // DESCOBERTA REAL POR VARREDURA DE PORTAS (FALLBACK)
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
