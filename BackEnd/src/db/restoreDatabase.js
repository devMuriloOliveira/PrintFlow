import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { env } from '../config/env.js'

const backupPath = resolve(process.argv[2] || '')
const confirmed = process.argv.includes('--confirm')

if (!confirmed || !process.argv[2]) {
  console.error('Uso: npm run restore -- caminho\\backup.dump --confirm')
  process.exit(1)
}
if (!env.databaseUrl) throw new Error('DATABASE_URL obrigatoria para restauracao.')
if (!existsSync(backupPath)) throw new Error('Arquivo de backup nao encontrado.')

const process = spawn(process.env.PG_RESTORE_BIN || 'pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', env.databaseUrl, backupPath], { stdio: 'inherit' })
process.once('error', (error) => { console.error(`Falha na restauracao: ${error.message}`); process.exit(1) })
process.once('exit', (code) => process.exitCode = code || 0)
