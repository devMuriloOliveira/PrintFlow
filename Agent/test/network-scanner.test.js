import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  discoverBambuSsdp,
  parseSsdpHeaders,
  getNetworkHostRange
} from '../src/discovery/networkScanner.js'

test('SSDP extrai serial Bambu e normaliza headers', () => {
  const headers = parseSsdpHeaders([
    'HTTP/1.1 200 OK',
    'Server: Bambu Lab X1C',
    'Serial: ABC123',
    'Model: X1 Carbon',
    ''
  ].join('\r\n'))

  assert.equal(headers.server, 'Bambu Lab X1C')
  assert.equal(headers.serial, 'ABC123')
})

test('SSDP retorna candidato Bambu sem varredura de portas', async () => {
  const socket = new EventEmitter()
  socket.bind = callback => callback()
  socket.send = () => {
    socket.emit(
      'message',
      Buffer.from([
        'HTTP/1.1 200 OK',
        'SERVER: Bambu Lab P1S',
        'SERIAL: 01P00A123456789',
        'MODEL: P1S',
        ''
      ].join('\r\n')),
      { address: '192.168.1.50' }
    )
  }
  socket.close = () => {}

  const printers = await discoverBambuSsdp({
    socketFactory: () => socket,
    timeoutMs: 100
  })

  assert.deepEqual(printers, [
    {
      connectionType: 'network',
      protocol: 'bambu',
      software: 'Bambu Lab',
      manufacturer: 'Bambu Lab',
      ip: '192.168.1.50',
      port: 8883,
      name: 'Bambu Lab',
      serial: '01P00A123456789',
      model: 'P1S',
      requiresCredentials: true,
      requiredCredentials: ['serial', 'accessCode'],
      mock: false
    }
  ])
})

test('descoberta calcula faixa pela netmask e exclui rede/broadcast', () => {
  assert.deepEqual(
    getNetworkHostRange(
      '192.168.2.19',
      '255.255.255.0'
    ),
    {
      start: '192.168.2.1',
      end: '192.168.2.254',
      truncated: false,
      totalHosts: 254
    }
  )
})

test('descoberta limita redes maiores sem escanear hosts indefinidamente', () => {
  const range =
    getNetworkHostRange(
      '10.0.4.8',
      '255.255.0.0',
      4
    )

  assert.deepEqual(
    range,
    {
      start: '10.0.0.1',
      end: '10.0.0.4',
      truncated: true,
      totalHosts: 65534
    }
  )
})
