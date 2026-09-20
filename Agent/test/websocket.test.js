import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { startAgentWebSocket, webSocketUrlFor } from '../src/cloud/websocket.js'

test('deriva WSS da URL HTTPS da API sem endpoint hardcoded', () => {
  assert.equal(
    webSocketUrlFor('https://api.printflow.example'),
    'wss://api.printflow.example/api/agents/ws'
  )
  assert.equal(
    webSocketUrlFor('http://localhost:3333'),
    'ws://localhost:3333/api/agents/ws'
  )
})

test('WebSocket consome sinal e encerra sem bloquear o fallback', async () => {
  const sockets = []
  class FakeWebSocket extends EventEmitter {
    constructor (url, options) {
      super()
      this.url = url
      this.options = options
      sockets.push(this)
      queueMicrotask(() => this.emit('open'))
    }

    close () {
      this.emit('close')
    }
  }

  let commands = 0
  const stop = startAgentWebSocket({
    apiUrl: 'https://api.printflow.example',
    credentials: { agentId: 'agent-test', agentSecret: 'secret-test' },
    WebSocketImpl: FakeWebSocket,
    onCommandAvailable: async () => { commands += 1 }
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].url, 'wss://api.printflow.example/api/agents/ws')
  assert.equal(sockets[0].options.headers['x-agent-id'], 'agent-test')
  sockets[0].emit('message', JSON.stringify({ type: 'command_available' }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(commands, 1)
  stop()
})

test('WebSocket reconecta depois de uma queda usando backoff', async () => {
  const sockets = []
  const waits = []
  class FakeWebSocket extends EventEmitter {
    constructor () {
      super()
      sockets.push(this)
      queueMicrotask(() => this.emit('open'))
    }

    close () {
      this.emit('close')
    }
  }

  let releaseWait
  const waitImpl = delay => {
    waits.push(delay)
    return new Promise(resolve => { releaseWait = resolve })
  }
  const stop = startAgentWebSocket({
    apiUrl: 'https://api.printflow.example',
    credentials: { agentId: 'agent-test', agentSecret: 'secret-test' },
    WebSocketImpl: FakeWebSocket,
    waitImpl,
    randomImpl: () => 0
  })

  await new Promise(resolve => setImmediate(resolve))
  sockets[0].emit('close')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(waits, [1000])
  releaseWait()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sockets.length, 2)
  stop()
})
