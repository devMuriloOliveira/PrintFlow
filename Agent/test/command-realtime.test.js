import assert from 'node:assert/strict'
import test from 'node:test'
import { startCommandRealtime } from '../src/cloud/commandRealtime.js'

test('SSE inicia somente quando o WebSocket fica indisponivel e encerra ao reconectar', () => {
  let webSocketCallbacks
  let sseStarts = 0
  let sseStops = 0
  const stop = startCommandRealtime({
    startWebSocket: callbacks => { webSocketCallbacks = callbacks; return () => {} },
    startSse: () => { sseStarts += 1; return () => { sseStops += 1 } }
  })

  assert.equal(sseStarts, 0)
  webSocketCallbacks.onError(new Error('offline'))
  webSocketCallbacks.onClose()
  assert.equal(sseStarts, 1)
  webSocketCallbacks.onOpen()
  assert.equal(sseStops, 1)
  stop()
})

test('modo realtime transita por WebSocket, SSE, offline e retorna ao WebSocket', () => {
  let webSocketCallbacks
  let sseCallbacks
  const modes = []
  const stop = startCommandRealtime({
    startWebSocket: callbacks => { webSocketCallbacks = callbacks; return () => {} },
    startSse: callbacks => { sseCallbacks = callbacks; return () => {} },
    onModeChange: mode => modes.push(mode)
  })
  webSocketCallbacks.onOpen()
  webSocketCallbacks.onClose()
  sseCallbacks.onOpen()
  sseCallbacks.onError(new Error('SSE indisponivel'))
  webSocketCallbacks.onOpen()
  stop()
  assert.deepEqual(modes, ['websocket', 'sse', 'sse', 'offline', 'websocket', 'offline'])
})
