import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

export const pool = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl,
      ssl: { rejectUnauthorized: false }
    })
  : null

export const hasDatabase = Boolean(pool)

export const query = async (text, params = []) => {
  if (!pool) {
    throw new Error('DATABASE_URL nao configurada')
  }

  return pool.query(text, params)
}

export const withTenant = async (tenantId, callback) => {
  if (!pool) {
    throw new Error('DATABASE_URL nao configurada')
  }

  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId])
    const result = await callback(client)
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
