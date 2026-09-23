import { env } from '../config/env.js'
import { hasDatabase, query } from '../db/pool.js'
import { writePlatformAdminNotification } from '../services/platformAdminNotifications.js'

const latestBackup = async (runQuery) => {
  const result = await runQuery(`
    select id, status, completed_at, error_message
      from backup_runs
     order by started_at desc, id desc
     limit 1
  `)
  return result.rows[0] || null
}

export const runBackupHealthWatchdog = async ({
  now = new Date(),
  maxAgeMs = env.backupMaxAgeMs,
  databaseAvailable = hasDatabase,
  runQuery = query,
  notify = writePlatformAdminNotification
} = {}) => {
  if (!databaseAvailable) return { skipped: true, notified: 0 }

  const backup = await latestBackup(runQuery)
  const completedAt = backup?.completed_at ? new Date(backup.completed_at) : null
  const stale = !completedAt || Number.isNaN(completedAt.getTime()) || now.getTime() - completedAt.getTime() > maxAgeMs
  const failed = backup?.status === 'failed'
  if (!stale && !failed) return { healthy: true, notified: 0 }

  const recipients = await runQuery(`
    select sa.user_id
      from platform_super_admins sa
      join users u on u.id = sa.user_id
     where sa.status = 'active' and u.status = 'active'
  `)
  const reason = failed ? 'A ultima execucao de backup falhou.' : 'Nao ha backup concluido dentro do prazo configurado.'
  let notified = 0
  for (const recipient of recipients.rows) {
    const saved = await notify(String(recipient.user_id), {
      type: 'backup.health', severity: 'error', title: 'Backup exige atencao',
      message: `${reason} Verifique a rotina de backup e restaure somente em ambiente controlado.`,
      entityType: 'backup_run', entityId: backup?.id ? String(backup.id) : 'missing',
      dedupeKey: `backup-health:${backup?.id || 'missing'}`
    })
    if (saved) notified += 1
  }
  return { healthy: false, stale, failed, notified }
}

export const startBackupHealthWatchdog = () => {
  if (!hasDatabase || env.backupHealthWatchdogIntervalMs <= 0) return null
  const run = () => runBackupHealthWatchdog().catch((error) => console.error('[BackupHealthWatchdog] Falha:', error))
  void run()
  const timer = setInterval(run, env.backupHealthWatchdogIntervalMs)
  timer.unref?.()
  return timer
}
