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
