import WebSocket from 'ws'

const wait = delay => new Promise(resolve => setTimeout(resolve, delay))

export const webSocketUrlFor = apiUrl => {
  const url = new URL('/api/agents/ws', apiUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export const startAgentWebSocket = ({ apiUrl, credentials, onCommandAvailable, onError = () => {}, WebSocketImpl = WebSocket, waitImpl = wait, randomImpl = Math.random }) => {
  let stopped = false
  let socket = null
  let reconnectDelay = 1_000
  const run = async () => {
    while (!stopped) {
      try {
        await new Promise((resolve, reject) => {
          let opened = false
          socket = new WebSocketImpl(webSocketUrlFor(apiUrl), { headers: { 'x-agent-id': credentials.agentId, 'x-agent-secret': credentials.agentSecret }, perMessageDeflate: false })
          socket.once('open', () => { opened = true; reconnectDelay = 1_000 })
          socket.once('error', error => { if (!opened) reject(error); else onError(error) })
          socket.on('message', async raw => {
            try {
              const event = JSON.parse(String(raw))
              if (event?.type === 'command_available') await onCommandAvailable()
            } catch {}
          })
          socket.once('close', () => resolve())
        })
      } catch (error) {
        if (!stopped) onError(error)
      } finally {
        socket = null
      }
      if (!stopped) {
        await waitImpl(reconnectDelay + Math.round(randomImpl() * 250))
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
      }
    }
  }
  void run()
  return () => { stopped = true; socket?.close() }
}
