import { env } from '../config/env.js'
import { pool, query } from './pool.js'

const TENANT_ID = 'demo'

const assertDemoCleanAllowed = () => {
  if (!pool) throw new Error('DATABASE_URL nao configurada. Nenhuma limpeza executada.')
  if (env.isProduction || process.env.NODE_ENV === 'production') throw new Error('Limpeza demo bloqueada em NODE_ENV=production.')
  let hostname = ''
  try { hostname = new URL(env.databaseUrl).hostname.toLowerCase() } catch { throw new Error('Limpeza demo bloqueada: DATABASE_URL invalida.') }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) throw new Error('Limpeza demo bloqueada: o banco precisa estar em localhost, 127.0.0.1 ou ::1.')
}

try {
  assertDemoCleanAllowed()
  const result = await query('delete from tenants where id = $1', [TENANT_ID])
  console.log(result.rowCount ? 'Dados demo removidos do tenant demo.' : 'Nenhum tenant demo encontrado para remover.')
} catch (error) {
  console.error('Falha ao limpar dados de demonstracao.', error)
  process.exitCode = 1
} finally {
  await pool?.end()
}
