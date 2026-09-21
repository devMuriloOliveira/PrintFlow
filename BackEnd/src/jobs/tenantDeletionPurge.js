import { env } from '../config/env.js'
import { purgeDueTenantDeletions } from '../services/tenantDeletion.js'

export const startTenantDeletionPurge = () => {
  const intervalMs = Math.max(60_000, Number(env.tenantDeletionPurgeIntervalMs) || 60 * 60 * 1000)
  const run = async () => {
    const result = await purgeDueTenantDeletions()
    if (result.deleted) console.log(`[TenantDeletion] ${result.deleted} conta(s) excluida(s).`)
  }
  void run().catch((error) => console.error('[TenantDeletion] Falha na limpeza:', error))
  const timer = setInterval(() => void run().catch((error) => console.error('[TenantDeletion] Falha na limpeza:', error)), intervalMs)
  timer.unref?.()
  return timer
}
