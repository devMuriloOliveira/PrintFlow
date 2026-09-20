import { readFile } from 'node:fs/promises'

const files = new Map([
  ['migration', 'BackEnd/src/db/migrate.js'],
  ['agent routes', 'BackEnd/src/routes/agents.js'],
  ['websocket server', 'BackEnd/src/services/agentWebSocket.js'],
  ['agent websocket', 'Agent/src/cloud/websocket.js'],
  ['credentials', 'Agent/src/storage/credentials.js']
])

const contents = new Map()
for (const [name, path] of files) contents.set(name, await readFile(path, 'utf8'))

const checks = [
  ['migration', /lease_expires_at[\s\S]*attempt/],
  ['migration', /pending_secret_hash[\s\S]*pending_secret_expires_at/],
  ['agent routes', /handleAgentCredentialRotateConfirm/],
  ['agent routes', /coalesce\(lease_expires_at/],
  ['agent routes', /x-agent-id[\s\S]*x-agent-secret/],
  ['websocket server', /authenticateAgentRequest/],
  ['websocket server', /maxPayload: 1024/],
  ['agent websocket', /reconnectDelay[\s\S]*30_000/],
  ['credentials', /windows-dpapi/]
]

const failures = checks.filter(([name, pattern]) => !pattern.test(contents.get(name))).map(([name, pattern]) => `${name}: ${pattern}`)
if (failures.length) {
  console.error('P0 contract invalid:', failures.join('; '))
  process.exit(1)
}

console.log(`P0 contract valid (${checks.length} checks; static, sem PostgreSQL real).`)
