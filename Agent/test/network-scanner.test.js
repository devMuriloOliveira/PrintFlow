import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getNetworkHostRange
} from '../src/discovery/networkScanner.js'

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
