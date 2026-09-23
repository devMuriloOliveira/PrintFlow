import { hasDatabase, query, withTenant } from '../db/pool.js'
import { decryptField } from '../security/crypto.js'
import {
  findIntegrationById,
  markMarketplaceIntegrationSync,
  recordTrackedSales
} from '../repositories/integrationsRepository.js'
import { enqueueMarketplaceSaleForPrinting } from '../services/marketplaceQueue.js'
import { fetchMarketplaceOrderDetails } from '../services/marketplaceOfficial.js'
import { env } from '../config/env.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'

const reconcileOne = async (tenantId, candidate) => {
  const integration = await findIntegrationById(tenantId, candidate.integration_id)
  if (!integration) return { skipped: true }
  const externalOrderId = decryptField(candidate.external_order_id)
  if (!externalOrderId) return { skipped: true }
  const sale = await fetchMarketplaceOrderDetails(integration, externalOrderId)
  const trackedSales = await recordTrackedSales(integration, { ...sale, externalOrderId })
  const items = Array.isArray(sale.items) && sale.items.length ? sale.items : [sale]
  for (const [index, trackedSale] of trackedSales.entries()) {
    await enqueueMarketplaceSaleForPrinting(integration, {
      ...sale,
      ...(items[index] || {}),
      id: trackedSale.id,
      externalOrderId,
      requiresReview: Boolean(items[index]?.requiresReview || sale.requiresReview),
      reviewReason: items[index]?.reviewReason || sale.reviewReason || ''
    })
  }
  await markMarketplaceIntegrationSync(tenantId, integration.id)
  return { reconciled: true, lines: trackedSales.length }
}

export const runMarketplaceReconciliation = async ({ limit = 40 } = {}) => {
  if (!hasDatabase) return { skipped: true, reason: 'database_unavailable' }
  const tenants = await query(`
    select distinct tenant_id
      from marketplace_integrations
     where status = 'connected'
  `)
  const result = { checked: 0, reconciled: 0, failed: 0 }
  for (const tenant of tenants.rows) {
    const candidates = await withTenant(tenant.tenant_id, (client) => client.query(`
      select distinct on (s.integration_id, s.external_order_hash)
             s.integration_id, s.external_order_id, s.platform
        from tracked_sales s
        join marketplace_integrations i on i.id = s.integration_id and i.tenant_id = s.tenant_id
       where s.tenant_id = $1
         and i.status = 'connected'
         and s.status not in ('cancelled', 'canceled', 'refunded', 'delivered')
         and (s.last_synced_at is null or s.last_synced_at < now() - interval '15 minutes')
       order by s.integration_id, s.external_order_hash, s.last_synced_at nulls first
       limit $2
    `, [tenant.tenant_id, Math.min(100, Math.max(1, Number(limit) || 40))]))
    for (const candidate of candidates.rows) {
      result.checked += 1
      try {
        const outcome = await reconcileOne(tenant.tenant_id, candidate)
        if (outcome.reconciled) result.reconciled += 1
      } catch (error) {
        result.failed += 1
        const message = String(error?.message || 'Falha na reconciliacao do marketplace').slice(0, 500)
        await markMarketplaceIntegrationSync(tenant.tenant_id, candidate.integration_id, {
          status: 'error',
          lastError: message
        })
        const period = Math.floor(Date.now() / (6 * 60 * 60 * 1000))
        await writeOperationalNotification(tenant.tenant_id, {
          type: 'marketplace.sync_failed', severity: 'error', title: 'Falha na sincronizacao do marketplace',
          message: 'Nao foi possivel atualizar uma venda do marketplace. Confira a conexao antes de processar novos pedidos.',
          entityType: 'marketplace_integration', entityId: String(candidate.integration_id),
          dedupeKey: `marketplace-sync-failed:${candidate.integration_id}:${period}`
        })
        await writeAuditEvent(tenant.tenant_id, {
          action: 'marketplace.sync_failed', actorType: 'system', entityType: 'marketplace_integration', entityId: String(candidate.integration_id),
          details: { error: message }
        })
      }
    }
  }
  return result
}

export const startMarketplaceReconciliation = () => {
  if (!hasDatabase) return null
  const timer = setInterval(() => void runMarketplaceReconciliation().catch((error) => {
    console.error('[Marketplace] Falha na reconciliacao:', error?.message || error)
  }), env.marketplaceReconciliationIntervalMs)
  timer.unref?.()
  return timer
}
