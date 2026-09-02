import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizePrinterConfig
} from '../src/printers/printerProfiles.js'

test('normaliza Bambu com porta padrao e credencial LAN', () => {
  const result =
    normalizePrinterConfig(
      {
        protocol:
          'bambu',
        ip:
          '192.168.1.30',
        serial:
          'ABC123'
      },
      {
        accessCode:
          '12345678'
      }
    )

  assert.equal(
    result.printer.port,
    8883
  )

  assert.equal(
    result.options.accessCode,
    '12345678'
  )
})

test('normaliza Marlin USB com baud rate padrao', () => {
  const result =
    normalizePrinterConfig({
      protocol:
        'marlin',
      connectionType:
        'usb',
      port:
        'COM3'
    })

  assert.equal(
    result.printer.port,
    'COM3'
  )

  assert.equal(
    result.printer.baudRate,
    115200
  )

  assert.equal(
    result.profile.capabilities.startPrint,
    true
  )
})

test('exige API Key para OctoPrint', () => {
  assert.throws(
    () =>
      normalizePrinterConfig({
        protocol:
          'octoprint',
        ip:
          '192.168.1.40'
      }),
    /apiKey/
  )
})

test('normaliza Moonraker sem token obrigatorio', () => {
  const result =
    normalizePrinterConfig({
      protocol:
        'moonraker',
      ip:
        '192.168.1.50'
    })

  assert.equal(
    result.printer.port,
    7125
  )
})

test('exige usuario e senha para PrusaLink', () => {
  assert.throws(
    () =>
      normalizePrinterConfig({
        protocol:
          'prusalink',
        ip:
          '192.168.1.60'
      }),
    /password/
  )
})
