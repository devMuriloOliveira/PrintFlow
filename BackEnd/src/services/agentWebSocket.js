import { WebSocketServer } from 'ws'
import { authenticateAgentRequest } from '../routes/agents.js'
import { subscribeAgentWebSocket } from './agentRealtime.js'

const closeUnauthorized = socket => {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
  socket.destroy()
}

export const attachAgentWebSocket = server => {
  const websocketServer = new WebSocketServer({ noServer: true, clientTracking: false, perMessageDeflate: false, maxPayload: 1024 })
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname !== '/api/agents/ws') {
      socket.destroy()
      return
    }
    try {
      const agent = await authenticateAgentRequest(req)
      if (!agent) return closeUnauthorized(socket)
      websocketServer.handleUpgrade(req, socket, head, websocket => {
        websocket.on('error', () => {})
        websocket.on('message', () => websocket.close(1008, 'Somente eventos do servidor.'))
        subscribeAgentWebSocket(agent, websocket)
      })
    } catch {
      closeUnauthorized(socket)
    }
  })
  return websocketServer
}
