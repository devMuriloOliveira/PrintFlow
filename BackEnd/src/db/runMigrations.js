import { migrate } from './migrate.js'
import { pool } from './pool.js'

try {
  await migrate()
  console.log('Migracoes executadas com sucesso.')
} catch (error) {
  console.error('Falha ao executar migrations.', error)
  process.exitCode = 1
} finally {
  await pool?.end()
}
