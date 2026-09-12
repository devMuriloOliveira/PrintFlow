import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

export const pool = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 60_000,
      statement_timeout: 30_000,
    })
  : null

if (pool) {
  pool.on('error', (error) => {
    console.error('Erro inesperado no pool PostgreSQL', { code: error?.code || 'unknown', message: error?.message || 'connection error' })
  })
}

export const hasDatabase = Boolean(pool)
const slowQueryThresholdMs = Math.max(100, Number(process.env.DB_SLOW_QUERY_MS) || 500)
const queryLabel = (text) => String(text || '').trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase()
const timedQuery = async (executor, text, params = []) => {
  const startedAt = Date.now()
  try { return await executor(text, params) }
  finally {
    const durationMs = Date.now() - startedAt
    if (durationMs >= slowQueryThresholdMs) console.warn('Consulta PostgreSQL lenta', { statement: queryLabel(text), durationMs })
  }
}
const instrumentClient = (client) => new Proxy(client, {
  get(target, property, receiver) {
    if (property === 'query') return (text, params = []) => timedQuery((sql, values) => target.query(sql, values), text, params)
    return Reflect.get(target, property, receiver)
  }
})

export const query = async (text, params = []) => {
  if (!pool) {
    throw new Error('DATABASE_URL nao configurada')
  }

  return timedQuery((sql, values) => pool.query(sql, values), text, params)
}

export const withTenant = async (tenantId, callback) => {
  if (!pool) {
    throw new Error('DATABASE_URL nao configurada')
  }

  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId])
    const result = await callback(instrumentClient(client))
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export const withPlatformAdmin = async (callback) => {
  if (!pool) {
    throw new Error('DATABASE_URL nao configurada')
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query("select set_config('app.platform_admin', 'true', true)")
    const result = await callback(instrumentClient(client))
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export const tenantQuery = (tenantId, text, params = []) =>
  withTenant(tenantId, (client) => client.query(text, params))
