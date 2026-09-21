import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../BackEnd/package.json', import.meta.url))
const WebSocket = require('ws')

import { pool, query } from '../BackEnd/src/db/pool.js'
import { attachAgentWebSocket } from '../BackEnd/src/services/agentWebSocket.js'
import { publishAgentCommandAvailable } from '../BackEnd/src/services/agentRealtime.js'

if (!pool) throw new Error('DATABASE_URL obrigatoria para o smoke test local.')

const tenantId = `ws-smoke-${randomUUID()}`
const agentSecret = `ws-smoke-secret-${randomUUID()}`
const secretHash = createHash('sha256').update(agentSecret).digest('hex')
const server = createServer((_req, res) => { res.writeHead(404); res.end() })
attachAgentWebSocket(server)

try {
  await query('insert into tenants (id, name) values ($1, $2)', [tenantId, 'WebSocket smoke'])
  const agent = await query(
    `insert into agents (tenant_id, name, machine_name, secret_hash, status)
     values ($1, $2, $3, $4, 'online') returning id`,
    [tenantId, 'WebSocket smoke', `machine-${randomUUID()}`, secretHash]
  )
  const agentId = String(agent.rows[0].id)

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  const port = server.address().port
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/agents/ws`, {
    headers: { 'x-agent-id': agentId, 'x-agent-secret': agentSecret }
  })
  const messages = []
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout aguardando WebSocket smoke')), 5_000)
    socket.on('message', raw => {
      messages.push(JSON.parse(String(raw)))
      if (messages.some(message => message.type === 'command_available')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    socket.once('error', reject)
    socket.once('open', () => publishAgentCommandAvailable({ agentId }))
  })
  if (!messages.some(message => message.type === 'ready')) throw new Error('WebSocket nao enviou ready.')
  console.log('WebSocket smoke passou: autenticacao, ready e command_available.')
  socket.close()
} finally {
  await new Promise(resolve => server.close(() => resolve()))
  await query('delete from tenants where id = $1', [tenantId])
  await pool.end()
}
