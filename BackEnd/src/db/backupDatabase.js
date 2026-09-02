import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const process = spawn(command, args, { stdio: 'inherit', ...options })
  process.once('error', reject)
  process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} terminou com codigo ${code}`)))
})

const main = async () => {
  if (!env.databaseUrl) throw new Error('DATABASE_URL obrigatoria para backup.')
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.resolve('backups'))
  await mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const target = path.join(backupDir, `printflow_${stamp}.dump`)
  await run(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-owner', '--file', target, env.databaseUrl])
  const info = await stat(target)
  if (!info.size) throw new Error('Backup gerado esta vazio.')
  console.log(`Backup concluido: ${target} (${info.size} bytes)`)

  const keep = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT || 14))
  const files = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^printflow_.*\.dump$/.test(entry.name))
    .map((entry) => entry.name).sort().reverse()
  await Promise.all(files.slice(keep).map((name) => rm(path.join(backupDir, name), { force: true })))
}

main().catch((error) => { console.error(`Falha no backup: ${error.message}`); process.exit(1) })
