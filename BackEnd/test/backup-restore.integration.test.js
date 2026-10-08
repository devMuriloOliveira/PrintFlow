import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg
const adminUrl = process.env.PRINTFLOW_RESTORE_TEST_DATABASE_URL || ''
const explicitConfirmation = process.env.PRINTFLOW_RESTORE_TEST_CONFIRM || ''
const configured = Boolean(adminUrl || explicitConfirmation)
const safeDatabaseName = (name) => /^printflow_restore_test_[a-f0-9]{16}_(source|target)$/.test(name)
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const parseIsolatedAdminUrl = (value) => {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('O teste de restauracao aceita somente PostgreSQL em loopback.')
  if (database !== 'postgres') throw new Error('Use somente o banco administrativo postgres da instancia isolada.')
  if (!url.username) throw new Error('Informe um usuario PostgreSQL para a instancia isolada.')
  return { url, host, database }
}

test('guarda da restauração aceita somente PostgreSQL administrativo local', () => {
  const accepted = parseIsolatedAdminUrl('postgresql://restore_user:local-only@127.0.0.1:5432/postgres')
  assert.equal(accepted.host, '127.0.0.1')
  assert.equal(accepted.database, 'postgres')
  assert.throws(() => parseIsolatedAdminUrl('postgresql://restore_user:secret@db.example.com:5432/postgres'), /somente PostgreSQL em loopback/)
  assert.throws(() => parseIsolatedAdminUrl('postgresql://restore_user:secret@127.0.0.1:5432/production'), /banco administrativo postgres/)
  assert.throws(() => parseIsolatedAdminUrl('postgresql://127.0.0.1:5432/postgres'), /usuario PostgreSQL/)
})

const toolEnvironment = ({ url, host, database }) => {
  const environment = { ...process.env, PGHOST: host, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGDATABASE: database }
  if (url.password) environment.PGPASSWORD = decodeURIComponent(url.password)
  else delete environment.PGPASSWORD
  const sslMode = url.searchParams.get('sslmode')
  if (sslMode) environment.PGSSLMODE = sslMode
  else delete environment.PGSSLMODE
  return environment
}

const run = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000) })
  child.once('error', reject)
  child.once('close', (code) => code === 0
    ? resolve()
    : reject(new Error(`${path.basename(command)} terminou com codigo ${code}${stderr ? `: ${stderr.trim()}` : ''}`)))
})

const readFixtureRows = async (client, schema) => {
  const result = await client.query(`select id, payload, payload_sha256 from "${schema}".restore_fixture order by id`)
  return result.rows.map((row) => ({ id: row.id, payload: row.payload, payloadSha256: row.payload_sha256 }))
}

test('backup custom pode ser restaurado em banco PostgreSQL descartavel e preserva integridade', {
  skip: configured ? false : 'Defina PRINTFLOW_RESTORE_TEST_DATABASE_URL e PRINTFLOW_RESTORE_TEST_CONFIRM=isolated-only para usar uma instancia local descartavel.'
}, async (t) => {
  if (explicitConfirmation !== 'isolated-only') throw new Error('Confirme que a instancia PostgreSQL e isolada com PRINTFLOW_RESTORE_TEST_CONFIRM=isolated-only.')
  if (!adminUrl) throw new Error('PRINTFLOW_RESTORE_TEST_DATABASE_URL e obrigatoria para o teste isolado.')

  const adminConfig = parseIsolatedAdminUrl(adminUrl)
  const suffix = randomBytes(8).toString('hex')
  const sourceDatabase = `printflow_restore_test_${suffix}_source`
  const targetDatabase = `printflow_restore_test_${suffix}_target`
  assert.equal(safeDatabaseName(sourceDatabase), true)
  assert.equal(safeDatabaseName(targetDatabase), true)

  const adminClient = new Client({ connectionString: adminUrl })
  const clients = []
  const createdDatabases = []
  let temporaryDirectory = ''
  let sourceSchema = ''

  t.after(async () => {
    await Promise.all(clients.map((client) => client.end().catch(() => {})))
    for (const database of createdDatabases.reverse()) {
      await adminClient.query(`drop database if exists "${database}"`).catch(() => {})
    }
    await adminClient.end().catch(() => {})
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
  })

  await adminClient.connect()
  const collision = await adminClient.query('select datname from pg_database where datname = any($1::text[])', [[sourceDatabase, targetDatabase]])
  if (collision.rowCount) throw new Error('O nome temporario do banco ja existe; nenhum banco existente sera removido.')

  await adminClient.query(`create database "${sourceDatabase}"`)
  createdDatabases.push(sourceDatabase)
  await adminClient.query(`create database "${targetDatabase}"`)
  createdDatabases.push(targetDatabase)

  const connectionForDatabase = (database) => {
    const url = new URL(adminUrl)
    url.pathname = `/${database}`
    return url.toString()
  }
  const source = new Client({ connectionString: connectionForDatabase(sourceDatabase) })
  const target = new Client({ connectionString: connectionForDatabase(targetDatabase) })
  clients.push(source, target)
  await Promise.all([source.connect(), target.connect()])

  sourceSchema = `pf_restore_fixture_${suffix}`
  await source.query(`create schema "${sourceSchema}"`)
  await source.query(`create table "${sourceSchema}".restore_fixture (
    id text primary key,
    payload jsonb not null,
    payload_sha256 text not null
  )`)

  const fixtures = [
    { id: 'pedido-01', payload: { description: 'Peça de teste', quantity: 2, cents: 1590 } },
    { id: 'pedido-02', payload: { description: 'Impressão concluída', quantity: 1, cents: 7250 } }
  ]
  for (const fixture of fixtures) {
    await source.query(
      `insert into "${sourceSchema}".restore_fixture (id, payload, payload_sha256) values ($1, $2::jsonb, $3)`,
      [fixture.id, JSON.stringify(fixture.payload), sha256(stableJson(fixture.payload))]
    )
  }
  const expectedRows = await readFixtureRows(source, sourceSchema)
  assert.equal(expectedRows.length, fixtures.length)
  assert.ok(expectedRows.every((row) => row.payloadSha256 === sha256(stableJson(row.payload))))

  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'printflow-restore-test-'))
  const dumpPath = path.join(temporaryDirectory, 'printflow-restore-test.dump')
  const dumpTool = process.env.PG_DUMP_BIN || 'pg_dump'
  const restoreTool = process.env.PG_RESTORE_BIN || 'pg_restore'
  await run(dumpTool, [
    '--format=custom', '--no-owner', '--no-password', '--file', dumpPath,
    '--host', adminConfig.host, '--port', adminConfig.url.port || '5432',
    '--username', decodeURIComponent(adminConfig.url.username), '--dbname', sourceDatabase
  ], toolEnvironment({ ...adminConfig, database: sourceDatabase }))
  assert.ok((await stat(dumpPath)).size > 0, 'o arquivo de backup nao pode estar vazio')

  await run(restoreTool, [
    '--clean', '--if-exists', '--no-owner', '--no-password', '--exit-on-error',
    '--host', adminConfig.host, '--port', adminConfig.url.port || '5432',
    '--username', decodeURIComponent(adminConfig.url.username), '--dbname', targetDatabase,
    dumpPath
  ], toolEnvironment({ ...adminConfig, database: targetDatabase }))
  const restoredRows = await readFixtureRows(target, sourceSchema)
  assert.deepEqual(restoredRows, expectedRows)
  assert.ok(restoredRows.every((row) => row.payloadSha256 === sha256(stableJson(row.payload))))
})
