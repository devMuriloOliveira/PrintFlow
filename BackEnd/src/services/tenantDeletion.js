import { createHash, createHmac, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { hasDatabase, query, withTenant } from '../db/pool.js'
import { decryptField } from '../security/crypto.js'
import { verifyPassword } from '../auth/password.js'
import { writeAuditEvent } from './operationalEvents.js'
import { removeTenantPrintFiles } from './printFileStorage.js'

const deletionId = () => `deletion_${randomBytes(16).toString('hex')}`
const normalizedDocument = (value) => String(value || '').replace(/\D/g, '')
const fingerprint = (purpose, value) => createHmac('sha256', env.authSecret)
  .update(`${purpose}:${String(value || '')}`).digest('base64url')
const requestIpHash = (req) => createHash('sha256')
  .update(`${env.authSecret}:${String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '')}`).digest('hex')
const requestAgent = (req) => String(req?.headers?.['user-agent'] || '').trim().slice(0, 500)

const countTenantData = async (client, tenantId) => {
  const result = await client.query(`
    select
      (select count(*) from users where tenant_id = $1) as users,
      (select count(*) from products where tenant_id = $1) as products,
      (select count(*) from orders where tenant_id = $1) as orders,
      (select count(*) from print_jobs where tenant_id = $1) as print_jobs,
      (select count(*) from expenses where tenant_id = $1) as expenses,
      (select count(*) from clients where tenant_id = $1) as clients,
      (select count(*) from agents where tenant_id = $1) as agents,
      (select count(*) from operational_audit_events where tenant_id = $1) as audit_events,
      (select count(*) from products where tenant_id = $1 and print_file_storage_key <> '') as print_files
  `, [tenantId])
  return Object.fromEntries(Object.entries(result.rows[0] || {}).map(([key, value]) => [key, Number(value || 0)]))
}

const appendDeletionAudit = async (client, event) => client.query(`
  insert into platform_tenant_deletion_audit (deletion_request_id, event_type, evidence, ip_hash, user_agent)
  values ($1, $2, $3::jsonb, $4, $5)
`, [event.requestId, event.type, JSON.stringify(event.evidence || {}), event.ipHash || '', event.userAgent || ''])

const safeEvidence = (tenant, user, counts, scheduledFor) => ({
  schemaVersion: 1,
  tenantFingerprint: fingerprint('tenant', tenant.id),
  cnpjFingerprint: fingerprint('cnpj', normalizedDocument(decryptField(tenant.document))),
  requesterFingerprint: fingerprint('requester', user.id),
  requesterRole: 'owner',
  confirmation: 'current_password_verified',
  cancellationNoticeAcknowledged: true,
  scheduledFor: scheduledFor.toISOString(),
  recordsAtRequest: counts
})

export const requestTenantDeletion = async (user, payload, req) => {
  if (!hasDatabase) throw new Error('Exclusao de conta requer DATABASE_URL.')
  if (user.role !== 'owner') throw new Error('Somente o Owner pode solicitar a exclusao da empresa.')
  if (user.platformRole === 'platform_super_admin') throw new Error('A conta de Superadmin da plataforma nao pode ser excluida por esta tela.')
  if (String(payload?.confirmation || '').trim().toUpperCase() !== 'EXCLUIR') throw new Error('Digite EXCLUIR para confirmar a exclusao da empresa.')
  if (payload?.acknowledgedCancellation !== true) throw new Error('Confirme que leu a regra de cancelamento por login.')

  return withTenant(user.tenantId, async (client) => {
    const account = await client.query(`
      select u.password_hash, t.id, t.document
        from users u join tenants t on t.id = u.tenant_id
       where u.id::text = $1 and u.tenant_id = $2 and u.status = 'active'
       limit 1
    `, [String(user.id), String(user.tenantId)])
    const row = account.rows[0]
    if (!row || !verifyPassword(String(payload?.currentPassword || ''), row.password_hash)) throw new Error('Senha atual invalida.')

    const existing = await client.query(`select id, scheduled_for from tenant_deletion_requests where tenant_id = $1 and status = 'pending' limit 1`, [user.tenantId])
    if (existing.rowCount) return { id: existing.rows[0].id, scheduledFor: existing.rows[0].scheduled_for, alreadyPending: true }

    const scheduledFor = new Date(Date.now() + Math.max(1, env.tenantDeletionGraceDays) * 24 * 60 * 60 * 1000)
    const counts = await countTenantData(client, user.tenantId)
    const id = deletionId()
    const evidence = safeEvidence(row, user, counts, scheduledFor)
    await client.query(`
      insert into tenant_deletion_requests (id, tenant_id, requested_by, scheduled_for, evidence)
      values ($1, $2, $3, $4, $5::jsonb)
    `, [id, user.tenantId, String(user.id), scheduledFor, JSON.stringify(evidence)])
    await client.query(`update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where tenant_id = $1 and revoked_at is null`, [user.tenantId])
    await client.query(`update users set token_version = token_version + 1, updated_at = now() where tenant_id = $1`, [user.tenantId])
    await writeAuditEvent(user.tenantId, { action: 'tenant.deletion.requested', actorType: 'user', actorId: user.id, entityType: 'tenant', entityId: user.tenantId, details: { scheduledFor: scheduledFor.toISOString() } }, client)
    await appendDeletionAudit(client, { requestId: id, type: 'requested', evidence, ipHash: requestIpHash(req), userAgent: requestAgent(req) })
    return { id, scheduledFor: scheduledFor.toISOString(), alreadyPending: false }
  })
}

export const cancelTenantDeletionOnLogin = async (user, req) => {
  if (!hasDatabase) return false
  return withTenant(user.tenantId, async (client) => {
    const result = await client.query(`
      update tenant_deletion_requests set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'owner_login'
       where tenant_id = $1 and status = 'pending'
       returning id, scheduled_for, evidence
    `, [user.tenantId])
    const request = result.rows[0]
    if (!request) return false
    const evidence = { ...(request.evidence || {}), cancellation: 'owner_login', cancelledBeforeDeadline: new Date() < new Date(request.scheduled_for) }
    await appendDeletionAudit(client, { requestId: request.id, type: 'cancelled', evidence, ipHash: requestIpHash(req), userAgent: requestAgent(req) })
    await writeAuditEvent(user.tenantId, { action: 'tenant.deletion.cancelled', actorType: 'user', actorId: user.id, entityType: 'tenant', entityId: user.tenantId }, client)
    return true
  })
}

export const listTenantDeletionAudit = async (limit = 100) => {
  const result = await query(`
    select id, deletion_request_id, event_type, evidence, created_at
      from platform_tenant_deletion_audit
     order by created_at desc limit $1
  `, [Math.min(200, Math.max(1, Number(limit) || 100))])
  const labels = {
    requested: 'Exclusao solicitada e confirmada pelo Owner',
    cancelled: 'Exclusao cancelada por novo login do Owner',
    execution_started: 'Exclusao definitiva iniciada',
    completed: 'Exclusao definitiva concluida',
    file_cleanup_failed: 'Limpeza de arquivos pendente'
  }
  return result.rows.map((row) => {
    const evidence = row.evidence || {}
    const counts = evidence.recordsAtDeletion || evidence.recordsAtRequest || {}
    const context = []
    if (evidence.scheduledFor) context.push(`Prazo: ${new Date(evidence.scheduledFor).toLocaleString('pt-BR')}.`)
    if (evidence.confirmation === 'current_password_verified') context.push('Senha atual confirmada e aviso de cancelamento aceito.')
    if (Object.keys(counts).length) context.push(`Registros envolvidos: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}.`)
    if (evidence.storageCleanup) context.push(`Arquivos: ${evidence.storageCleanup}.`)
    return { id: String(row.id), requestId: row.deletion_request_id, eventType: row.event_type, summary: labels[row.event_type] || 'Evento de exclusao registrado', context: context.join(' '), evidence, createdAt: row.created_at }
  })
}

export const purgeDueTenantDeletions = async ({ now = new Date() } = {}) => {
  if (!hasDatabase) return { deleted: 0 }
  const due = await query(`select id, tenant_id from tenant_deletion_requests where status = 'pending' and scheduled_for <= $1 order by scheduled_for asc`, [now])
  let deleted = 0
  for (const request of due.rows) {
    const result = await withTenant(request.tenant_id, async (client) => {
      const locked = await client.query(`select id, evidence from tenant_deletion_requests where id = $1 and tenant_id = $2 and status = 'pending' and scheduled_for <= $3 for update`, [request.id, request.tenant_id, now])
      if (!locked.rowCount) return null
      const counts = await countTenantData(client, request.tenant_id)
      const evidence = { ...(locked.rows[0].evidence || {}), recordsAtDeletion: counts }
      await appendDeletionAudit(client, { requestId: request.id, type: 'execution_started', evidence })
      await client.query(`delete from tenants where id = $1`, [request.tenant_id])
      return evidence
    })
    if (result) {
      let storageCleanup = 'completed'
      try {
        await removeTenantPrintFiles(request.tenant_id)
      } catch (error) {
        storageCleanup = 'failed_pending_retention_cleanup'
        await query(`insert into platform_tenant_deletion_audit (deletion_request_id, event_type, evidence) values ($1, 'file_cleanup_failed', $2::jsonb)`, [request.id, JSON.stringify({ errorCode: String(error?.code || 'unknown').slice(0, 80) })])
      }
      await query(`insert into platform_tenant_deletion_audit (deletion_request_id, event_type, evidence) values ($1, 'completed', $2::jsonb)`, [request.id, JSON.stringify({ ...result, storageCleanup })])
      deleted += 1
    }
  }
  return { deleted }
}
