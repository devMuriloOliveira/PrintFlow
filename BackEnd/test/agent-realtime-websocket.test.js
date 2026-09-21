import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { publishAgentCommandAvailable, subscribeAgentWebSocket } from '../src/services/agentRealtime.js'

class FakeSocket extends EventEmitter {
  constructor () {
    super()
    this.readyState = 1
    this.messages = []
  }

  send (message) {
    this.messages.push(JSON.parse(message))
  }
}

test('evento WebSocket entrega somente sinal de comando ao Agent inscrito', () => {
  const socket = new FakeSocket()
  subscribeAgentWebSocket({ id: 'agent-ws-1' }, socket)
  publishAgentCommandAvailable({ agentId: 'agent-ws-1' })

  assert.deepEqual(socket.messages, [
    { type: 'ready' },
    { type: 'command_available' }
  ])
  socket.emit('close')
})
