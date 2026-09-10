import { rm } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import { hasDatabase, query } from '../db/pool.js'

export const cleanupExpiredSupportAttachments = async ({ runQuery = query, remove = rm, databaseAvailable = hasDatabase } = {}) => {
  if (!databaseAvailable) return { removed: 0 }
  const result = await runQuery(`select id, storage_key from tenant_audit_request_attachments where expires_at <= now() and deleted_at is null limit 100`)
  let removed = 0
  for (const row of result.rows) {
    const root = path.resolve(env.supportAttachmentStorageDir)
    const filePath = path.resolve(root, row.storage_key)
    if (filePath.startsWith(`${root}${path.sep}`)) await remove(filePath, { force: true })
    await runQuery(`update tenant_audit_request_attachments set deleted_at = now() where id = $1`, [row.id])
    removed += 1
  }
  return { removed }
}

export const startSupportAttachmentCleanup = () => {
  const intervalMs = Math.max(60_000, Number(env.supportAttachmentCleanupIntervalMs) || 6 * 60 * 60 * 1000)
  const run = async () => { const result = await cleanupExpiredSupportAttachments(); if (result.removed) console.log(`[SupportAttachments] ${result.removed} anexo(s) expirado(s) removido(s).`) }
  void run().catch((error) => console.error('[SupportAttachments] Falha na limpeza:', error))
  const timer = setInterval(() => void run().catch((error) => console.error('[SupportAttachments] Falha na limpeza:', error)), intervalMs)
  timer.unref?.()
  return timer
}
