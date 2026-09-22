import assert from 'node:assert/strict'
import test from 'node:test'

process.env.PRINTFLOW_DEV_MOCK_BAMBU = 'true'

const {
  connectPrinter,
  disconnectPrinter,
  getCachedActivePrintCount,
  refreshActivePrinterStatuses
} = await import('../src/printers/printerManager.js')

const printer = {
  protocol: 'bambu',
  connectionType: 'network',
  manufacturer: 'Bambu Lab',
  model: 'P1S',
  ip: '192.168.2.250',
  port: 8883,
  serial: 'PFMOCKPOLL001',
  mock: true
}

test('polling atualiza status e detecta impressao iniciada fora do Agent', async () => {
  await connectPrinter(printer, { accessCode: 'mock-access-code' })
  assert.equal(getCachedActivePrintCount(), 0)

  const result = await refreshActivePrinterStatuses()

  assert.equal(result.refreshed, 1)
  assert.equal(getCachedActivePrintCount(), 1)

  await disconnectPrinter(printer)
})
