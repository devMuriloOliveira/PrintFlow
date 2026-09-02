import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

process.env.ALLOW_DEMO_TENANT = 'true'
process.env.DATABASE_URL = ''

const { getTenantData } = await import('../src/data.js')
const { handleRequest } = await import('../src/routes/index.js')

class MockRequest extends Readable {
  constructor({ method, path, body }) {
    super()
    this.method = method
    this.url = path
    this.headers = { host: 'localhost:3333' }
    this.socket = { remoteAddress: '127.0.0.1' }
    this.body = body === undefined ? null : JSON.stringify(body)
  }

  _read() {
    if (this.body !== null) {
      this.push(this.body)
      this.body = null
    }
    this.push(null)
  }
}

class MockResponse extends EventEmitter {
  writeHead(status, headers) {
    this.statusCode = status
    this.headers = headers
  }

  end(chunk) {
    this.body = chunk ? JSON.parse(String(chunk)) : null
    this.emit('finish')
  }
}

const request = ({ method = 'POST', path, body = {} }) => new Promise((resolve) => {
  const req = new MockRequest({ method, path, body })
  const res = new MockResponse()
  res.once('finish', () => resolve({ status: res.statusCode, body: res.body }))
  handleRequest(req, res)
})

test('pedido de marketplace precisa ser confirmado antes de iniciar impressao', async () => {
  const data = getTenantData('demo')
  data.printJobs = [
    {
      id: 'job-marketplace-confirmation',
      productId: 'product-marketplace-confirmation',
      productName: 'Produto mock',
      printerId: 'printer-marketplace-confirmation',
      printerName: 'Impressora mock',
      agentPrinterId: '',
      source: 'marketplace',
      title: 'Produto mock',
      quantity: 1,
      priority: 0,
      status: 'awaiting_confirmation',
      notes: 'Pedido mock recebido via marketplace.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]

  const blockedStart = await request({
    path: '/api/print-jobs/job-marketplace-confirmation/start-manual'
  })

  assert.equal(blockedStart.status, 400)
  assert.equal(data.printJobs[0].status, 'awaiting_confirmation')

  const approved = await request({
    path: '/api/print-jobs/job-marketplace-confirmation/approve'
  })

  assert.equal(approved.status, 200)
  assert.equal(data.printJobs[0].status, 'queued')

  const started = await request({
    path: '/api/print-jobs/job-marketplace-confirmation/start-manual'
  })

  assert.equal(started.status, 200)
  assert.equal(data.printJobs[0].status, 'printing')
})
