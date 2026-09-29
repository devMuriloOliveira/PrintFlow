import { env } from '../config/env.js'
import { pool, query } from './pool.js'

const TENANT_ID = 'demo'

const assertDemoCleanAllowed = () => {
  if (!pool) throw new Error('DATABASE_URL nao configurada. Nenhuma limpeza executada.')
  if (env.isProduction || process.env.NODE_ENV === 'production') throw new Error('Limpeza demo bloqueada em NODE_ENV=production.')
  const url = String(env.databaseUrl || '').toLowerCase()
  const localHints = ['localhost', '127.0.0.1', 'host.docker.internal', 'printflow', 'demo', 'dev']
  const explicitlyAllowed = process.env.ALLOW_DEMO_SEED === 'true'
  if (!explicitlyAllowed && !localHints.some((hint) => url.includes(hint))) {
    throw new Error('Limpeza demo bloqueada: DATABASE_URL nao parece local/dev. Use ALLOW_DEMO_SEED=true somente se tiver certeza.')
  }
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
