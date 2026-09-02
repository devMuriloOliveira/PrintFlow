import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { query, withTenant } from '../db/pool.js'
import { blindIndexesForLookup, decryptField } from '../security/crypto.js'

const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const configuredEmails = () => env.platformSuperAdminEmails

export const syncConfiguredPlatformSuperAdmins = async () => {
  const emails = configuredEmails()
  if (!emails.length) return { granted: 0 }

  const hashes = emails.flatMap((email) => blindIndexesForLookup(email))
  const result = await query(`select id, email_hash from users where email_hash = any($1::text[])`, [hashes])

  for (const user of result.rows) {
    await query(`update users set role = 'platform_super_admin', token_version = token_version + 1, updated_at = now() where id = $1`, [user.id])
    await query(`insert into platform_super_admins (user_id, email_hash) values ($1, $2) on conflict (user_id) do update set email_hash = excluded.email_hash, status = 'active', updated_at = now()`, [user.id, user.email_hash])
  }

  return { granted: result.rowCount }
}

export const isPlatformSuperAdmin = async (user) => {
  if (!user || user.role !== 'platform_super_admin') return false
  if (!configuredEmails().includes(String(user.email || '').toLowerCase())) return false
  const result = await query(`select 1 from platform_super_admins where user_id = $1 and status = 'active' limit 1`, [user.id])
  return Boolean(result.rowCount)
}

const requestIpHash = (req) => createHash('sha256')
  .update(`${env.authSecret}:${String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')}`)
  .digest('hex')

export const writePlatformAudit = async (req, user, event = {}) => {
  await query(`
    insert into platform_admin_audit_events (
      actor_user_id, action, target_tenant_id, target_resource, target_resource_id, reason, ip_hash, user_agent, details
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
  `, [
    user.id, text(event.action, 120), text(event.targetTenantId, 120) || null,
    text(event.targetResource, 80), text(event.targetResourceId, 120), text(event.reason, 500),
    requestIpHash(req), text(req.headers['user-agent'], 500), JSON.stringify(event.details && typeof event.details === 'object' ? event.details : {})
  ])
}

const tenantRow = (row) => ({
  id: row.id,
  name: decryptField(row.name),
  email: decryptField(row.email),
  accountStatus: row.account_status,
  billingStatus: row.billing_status,
  billingDueAt: row.billing_due_at,
  createdAt: row.created_at,
  users: Number(row.users || 0),
  activeUsers: Number(row.active_users || 0),
  agents: Number(row.agents || 0),
  onlineAgents: Number(row.online_agents || 0),
  printers: Number(row.printers || 0)
})

export const getPlatformOverview = async () => {
  const result = await query(`
    select
      count(*) as tenants,
      count(*) filter (where account_status = 'active') as active_tenants,
      count(*) filter (where account_status in ('suspended', 'blocked')) as suspended_tenants,
      count(*) filter (where billing_status in ('pending', 'overdue')) as payment_attention
    from tenants
  `)
  const agents = await query(`select count(*) as total, count(*) filter (where status = 'online') as online from agents`)
  const printers = await query(`select count(*) as total, count(*) filter (where status in ('connected', 'printing', 'paused')) as connected from agent_printers`)
  return {
    tenants: Number(result.rows[0]?.tenants || 0), activeTenants: Number(result.rows[0]?.active_tenants || 0),
    suspendedTenants: Number(result.rows[0]?.suspended_tenants || 0), paymentAttention: Number(result.rows[0]?.payment_attention || 0),
    agents: Number(agents.rows[0]?.total || 0), onlineAgents: Number(agents.rows[0]?.online || 0),
    printers: Number(printers.rows[0]?.total || 0), connectedPrinters: Number(printers.rows[0]?.connected || 0)
  }
}

export const listPlatformTenants = async () => {
  const result = await query(`
    select t.id, t.name, t.email, t.account_status, t.billing_status, t.billing_due_at, t.created_at,
      count(distinct u.id) as users,
      count(distinct u.id) filter (where u.status = 'active') as active_users,
      count(distinct a.id) as agents,
      count(distinct a.id) filter (where a.status = 'online') as online_agents,
      count(distinct p.id) as printers
    from tenants t
    left join users u on u.tenant_id = t.id
    left join agents a on a.tenant_id = t.id
    left join agent_printers p on p.tenant_id = t.id
    group by t.id, t.name, t.email, t.account_status, t.billing_status, t.billing_due_at, t.created_at
    order by t.created_at desc
  `)
  return result.rows.map(tenantRow)
}

export const listTenantOperationalAudit = async (tenantId, limit = 100) => withTenant(tenantId, async (client) => {
  const result = await client.query(`
    select id, action, actor_type, actor_id, entity_type, entity_id, details, created_at
      from operational_audit_events
     where tenant_id = $1
     order by created_at desc
     limit $2
  `, [tenantId, Math.min(200, Math.max(1, Number(limit) || 100))])
  return result.rows.map((row) => ({
    id: String(row.id), action: row.action, actorType: row.actor_type, actorId: row.actor_id,
    entityType: row.entity_type, entityId: row.entity_id, details: row.details || {}, createdAt: row.created_at
  }))
})

export const updatePlatformTenantStatus = async (tenantId, payload = {}) => {
  const accountStatus = ['active', 'suspended', 'blocked'].includes(payload.accountStatus) ? payload.accountStatus : ''
  const billingStatus = ['not_configured', 'active', 'pending', 'overdue', 'cancelled'].includes(payload.billingStatus) ? payload.billingStatus : ''
  if (!accountStatus && !billingStatus) throw new Error('Informe um status valido para a conta ou cobranca.')

  const result = await query(`
    update tenants
       set account_status = case when $2 <> '' then $2 else account_status end,
           billing_status = case when $3 <> '' then $3 else billing_status end,
           billing_due_at = case when $4::timestamptz is not null then $4::timestamptz else billing_due_at end
     where id = $1
     returning id, name, email, account_status, billing_status, billing_due_at, created_at,
       0::int as users, 0::int as active_users, 0::int as agents, 0::int as online_agents, 0::int as printers
  `, [tenantId, accountStatus, billingStatus, payload.billingDueAt || null])
  if (!result.rowCount) throw new Error('Empresa nao encontrada.')
  return tenantRow(result.rows[0])
}
