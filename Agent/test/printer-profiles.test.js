import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPrinterConnectionPreset,
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

test('preset da Ender-3 V3 SE seleciona Marlin USB', () => {
  const result = normalizePrinterConfig({
    manufacturer: 'Creality',
    model: 'Ender-3 V3 SE',
    port: 'COM4'
  })

  assert.equal(result.profile.protocol, 'marlin')
  assert.equal(result.printer.connectionType, 'usb')
  assert.equal(result.printer.baudRate, 115200)
  assert.equal(
    getPrinterConnectionPreset(result.printer)?.id,
    'creality-ender-3-v3-se'
  )
})

test('preset da Ender-3 V3 KE seleciona Moonraker em rede', () => {
  const result = normalizePrinterConfig({
    manufacturer: 'Creality',
    model: 'Ender-3 V3 KE',
    ip: '192.168.1.61'
  })

  assert.equal(result.profile.protocol, 'moonraker')
  assert.equal(result.printer.connectionType, 'network')
  assert.equal(result.printer.port, 7125)
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
