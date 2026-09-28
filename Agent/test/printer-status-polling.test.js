import assert from 'node:assert/strict'
import test from 'node:test'

process.env.PRINTFLOW_DEV_MOCK_BAMBU = 'true'

const {
  connectPrinter,
  disconnectPrinter,
  getActiveConnection,
  getCachedActivePrintCount,
  getCachedPrinterPrintActivity,
  getDisconnectedActivePrintCount,
  listPrinterConnectionStates,
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

  assert.equal(getCachedPrinterPrintActivity(printer), true)

  // Simula o caso observado em producao: o monitor local ainda existe, mas
  // a impressora conectada ja voltou para o estado ocioso.
  getActiveConnection(printer).connection.printState = 'IDLE'
  await refreshActivePrinterStatuses()
  assert.equal(getCachedPrinterPrintActivity(printer), false)
  assert.equal(getCachedActivePrintCount(), 0)

  await disconnectPrinter(printer)
  assert.equal(getCachedPrinterPrintActivity(printer), null)
  assert.equal(
    listPrinterConnectionStates().find(item => item.connectionKey === 'bambu:PFMOCKPOLL001')?.status,
    'disconnected'
  )
})

test('polling tolera falha transitoria e remove conexao apos limite consecutivo', async t => {
  const failingPrinter = {
    ...printer,
    serial: 'PFMOCKPOLLFAIL001'
  }

  await connectPrinter(failingPrinter, { accessCode: 'mock-access-code' })
  const entry = getActiveConnection(failingPrinter)
  const originalGetStatus = entry.adapter.getStatus
  t.after(() => {
    entry.adapter.getStatus = originalGetStatus
  })
  entry.adapter.getStatus = async () => {
    throw new Error('impressora fora da rede')
  }

  const firstResult = await refreshActivePrinterStatuses({ failureThreshold: 3 })

  assert.equal(firstResult.failed, 1)
  assert.ok(getActiveConnection(failingPrinter))

  const secondResult = await refreshActivePrinterStatuses({ failureThreshold: 3 })
  assert.equal(secondResult.failed, 1)
  assert.ok(getActiveConnection(failingPrinter))

  const thirdResult = await refreshActivePrinterStatuses({ failureThreshold: 3 })
  assert.equal(thirdResult.failed, 1)
  assert.equal(getActiveConnection(failingPrinter), null)
  assert.equal(getCachedPrinterPrintActivity(failingPrinter), null)
  const heartbeatState = listPrinterConnectionStates()
    .find(item => item.connectionKey === 'bambu:PFMOCKPOLLFAIL001')
  assert.equal(heartbeatState?.status, 'disconnected')
  assert.equal(
    heartbeatState?.lastError,
    'Impressora indisponivel ou fora da rede.'
  )
})

test('queda persistente durante impressao preserva bloqueio de atualizacao', async t => {
  const activePrinter = {
    ...printer,
    serial: 'PFMOCKPOLLACTIVE001'
  }

  await connectPrinter(activePrinter, { accessCode: 'mock-access-code' })
  await refreshActivePrinterStatuses({ failureThreshold: 2 })
  assert.equal(getCachedPrinterPrintActivity(activePrinter), true)

  const entry = getActiveConnection(activePrinter)
  const originalGetStatus = entry.adapter.getStatus
  t.after(() => {
    entry.adapter.getStatus = originalGetStatus
  })
  entry.adapter.getStatus = async () => {
    throw new Error('conexao perdida durante impressao')
  }

  await refreshActivePrinterStatuses({ failureThreshold: 2 })
  assert.ok(getActiveConnection(activePrinter))

  await refreshActivePrinterStatuses({ failureThreshold: 2 })
  assert.equal(getActiveConnection(activePrinter), null)
  assert.equal(getCachedPrinterPrintActivity(activePrinter), true)
  assert.ok(getDisconnectedActivePrintCount() >= 1)

  const heartbeatState = listPrinterConnectionStates()
    .find(item => item.connectionKey === 'bambu:PFMOCKPOLLACTIVE001')
  assert.equal(heartbeatState?.status, 'disconnected')
  assert.equal(heartbeatState?.lastStatus?.state, 'RUNNING')
})
