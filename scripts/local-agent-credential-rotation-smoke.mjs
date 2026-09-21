import { createHash, randomUUID } from 'node:crypto'

import { pool, query } from '../BackEnd/src/db/pool.js'
import {
  handleAgentCredentialRotate,
  handleAgentCredentialRotateConfirm
} from '../BackEnd/src/routes/agents.js'

if (!pool) throw new Error('DATABASE_URL obrigatoria para o smoke test local.')

const tenantId = `rotation-smoke-${randomUUID()}`
const oldSecret = `rotation-old-${randomUUID()}`
const oldHash = createHash('sha256').update(oldSecret).digest('hex')

const response = async handler => {
  let body = null
  let status = 0
  const req = {
    headers: {},
    on () { return this }
  }
  const res = {
    corsHeaders: {},
    writeHead (value) { status = value },
    end (value) { body = value ? JSON.parse(Buffer.from(value).toString('utf8')) : null }
  }
  await handler(req, res)
  return { status, body }
}

try {
  await query('insert into tenants (id, name) values ($1, $2)', [tenantId, 'Credential rotation smoke'])
  const inserted = await query(
    `insert into agents (tenant_id, name, machine_name, secret_hash, secret_rotated_at, status)
     values ($1, $2, $3, $4, now() - interval '31 days', 'online') returning id`,
    [tenantId, 'Rotation smoke', `machine-${randomUUID()}`, oldHash]
  )
  const agentId = String(inserted.rows[0].id)
  const request = secret => ({ headers: { 'x-agent-id': agentId, 'x-agent-secret': secret } })

  const rotateRes = await response(async (_req, res) => handleAgentCredentialRotate(request(oldSecret), res))
  if (rotateRes.status !== 200 || !rotateRes.body?.agentSecret) throw new Error('rotacao nao retornou nova credencial.')
  const newSecret = rotateRes.body.agentSecret

  const confirmRes = await response(async (_req, res) => handleAgentCredentialRotateConfirm(request(newSecret), res))
  const repeatRes = await response(async (_req, res) => handleAgentCredentialRotateConfirm(request(newSecret), res))
  if (confirmRes.status !== 200 || repeatRes.status !== 200 || confirmRes.body.credentialVersion !== repeatRes.body.credentialVersion) {
    throw new Error('confirmacao repetida nao foi idempotente.')
  }

  const state = await query(
    `select secret_hash = $2 as new_secret_active,
            pending_secret_hash is null as pending_cleared,
            credential_version
       from agents
      where id = $1 and tenant_id = $3`,
    [agentId, createHash('sha256').update(newSecret).digest('hex'), tenantId]
  )
  if (!state.rows[0]?.new_secret_active || !state.rows[0]?.pending_cleared) throw new Error('estado final da rotacao invalido.')
  console.log('Credential rotation smoke passou: rotacao, confirmacao e retry idempotente.')
} finally {
  await query('delete from tenants where id = $1', [tenantId])
  await pool.end()
}
