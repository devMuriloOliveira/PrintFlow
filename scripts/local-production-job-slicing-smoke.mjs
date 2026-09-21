import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { handleRequest } from '../BackEnd/src/routes/index.js'
import { pool, query } from '../BackEnd/src/db/pool.js'
import { removeTenantPrintFiles } from '../BackEnd/src/services/printFileStorage.js'

if (!pool) throw new Error('DATABASE_URL obrigatoria para o smoke test local.')
if (process.env.OBJECT_STORAGE_PROVIDER !== 'local') {
  throw new Error('O smoke de slicing exige OBJECT_STORAGE_PROVIDER=local.')
}

const tenantA = `slicing-smoke-a-${randomUUID()}`
const tenantB = `slicing-smoke-b-${randomUUID()}`
const agentSecretA = `slicing-smoke-secret-a-${randomUUID()}`
const agentSecretB = `slicing-smoke-secret-b-${randomUUID()}`
const hashSecret = (value) => createHash('sha256').update(value).digest('hex')
const gcode = Buffer.from('; PrintFlow slicing smoke\nG28\nG1 X1 Y1\n')
const gcodeHash = createHash('sha256').update(gcode).digest('hex')

const server = createServer(handleRequest)
const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const close = () => new Promise((resolve, reject) => {
  server.closeAllConnections?.()
  server.close((error) => error ? reject(error) : resolve())
})

const createFixture = async (tenantId, secret) => {
  await query('insert into tenants (id, name) values ($1, $2)', [tenantId, `Slicing smoke ${tenantId}`])
  const agent = await query(
    `insert into agents (tenant_id, name, machine_name, secret_hash, status)
     values ($1, 'Slicing smoke Agent', $2, $3, 'online') returning id`,
    [tenantId, `machine-${randomUUID()}`, hashSecret(secret)]
  )
  const printer = await query(
    `insert into agent_printers (tenant_id, agent_id, connection_key, protocol)
     values ($1, $2, $3, 'bambu') returning id`,
    [tenantId, agent.rows[0].id, `slicing-smoke-${randomUUID()}`]
  )
  const job = await query(
    `insert into print_jobs (tenant_id, agent_printer_id, title, status)
     values ($1, $2, 'Slicing smoke job', 'queued') returning id`,
    [tenantId, printer.rows[0].id]
  )
  return { agentId: String(agent.rows[0].id), printJobId: String(job.rows[0].id) }
}

const upload = async (baseUrl, agentId, secret, printJobId, idempotencyKey, body = gcode) => {
  const response = await fetch(`${baseUrl}/api/agents/print-jobs/${printJobId}/slicing-artifact`, {
    method: 'POST',
    headers: {
      'x-agent-id': agentId,
      'x-agent-secret': secret,
      'x-printflow-file-name': 'slicing-smoke.gcode',
      'x-printflow-file-format': 'gcode',
      'x-printflow-slicer-profile-id': 'bambu-p1s-0.4',
      'x-printflow-slicer-profile-version': '1',
      'x-printflow-idempotency-key': idempotencyKey,
      'x-printflow-estimated-print-seconds': '120',
      'x-printflow-estimated-filament-grams': '2.5'
    },
    body
  })
  return { status: response.status, body: await response.json() }
}

try {
  await listen()
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`
  const fixtureA = await createFixture(tenantA, agentSecretA)
  const fixtureB = await createFixture(tenantB, agentSecretB)

  const first = await upload(baseUrl, fixtureA.agentId, agentSecretA, fixtureA.printJobId, 'slicing-smoke-attempt-1')
  assert.equal(first.status, 200)
  assert.equal(first.body.idempotent, false)
  assert.equal(first.body.artifact.hash, gcodeHash)

  const retry = await upload(baseUrl, fixtureA.agentId, agentSecretA, fixtureA.printJobId, 'slicing-smoke-attempt-1')
  assert.equal(retry.status, 200)
  assert.equal(retry.body.idempotent, true)

  const crossTenant = await upload(baseUrl, fixtureB.agentId, agentSecretB, fixtureA.printJobId, 'slicing-smoke-cross-tenant')
  assert.equal(crossTenant.status, 404)

  const persisted = await query(
    `select slicing_artifact_storage_key, slicing_artifact_sha256,
            estimated_print_seconds, estimated_filament_grams
       from print_jobs where tenant_id = $1 and id = $2`,
    [tenantA, fixtureA.printJobId]
  )
  assert.equal(persisted.rowCount, 1)
  assert.equal(persisted.rows[0].slicing_artifact_sha256, gcodeHash)
  assert.equal(Number(persisted.rows[0].estimated_print_seconds), 120)
  assert.equal(Number(persisted.rows[0].estimated_filament_grams), 2.5)
  console.log('Production Job slicing smoke passou: upload, retry idempotente, persistencia e isolamento tenant.')
} finally {
  await close().catch(() => {})
  await removeTenantPrintFiles(tenantA).catch(() => {})
  await removeTenantPrintFiles(tenantB).catch(() => {})
  await query('delete from tenants where id = any($1::text[])', [[tenantA, tenantB]]).catch(() => {})
  await pool.end()
}
