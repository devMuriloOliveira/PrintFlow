import { tenantMemberRoles } from '../auth/authorization.js'
import { hasDatabase, tenantQuery, withTenant } from '../db/pool.js'
import { decryptField } from '../security/crypto.js'
import { writeAuditEvent } from '../services/operationalEvents.js'

const allowedStatuses = new Set(['active', 'suspended'])

const normalizeRole = (value) => String(value || '').trim().toLowerCase()
const normalizeStatus = (value) => String(value || '').trim().toLowerCase()

const publicMember = (row) => ({
  userId: String(row.user_id || row.id),
  name: decryptField(row.name),
  email: decryptField(row.email),
  role: row.role,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export const listTenantMembers = async (tenantId) => {
  if (!hasDatabase) return []

  const result = await tenantQuery(tenantId, `
    select tm.user_id, tm.role, tm.status, tm.created_at, tm.updated_at, u.name, u.email
      from tenant_memberships tm
      join users u on u.id = tm.user_id
     where tm.tenant_id = $1
     order by case tm.role when 'owner' then 0 when 'admin' then 1 else 2 end, tm.created_at asc
  `, [tenantId])

  return result.rows.map(publicMember)
}

export const updateTenantMember = async ({ actor, userId, role, status }) => {
  const targetUserId = String(userId || '').trim()
  const nextRole = normalizeRole(role)
  const nextStatus = normalizeStatus(status)

  if (!targetUserId) throw new Error('Membro nao encontrado')
  if (!tenantMemberRoles.includes(nextRole)) throw new Error('Perfil de acesso invalido.')
  if (!allowedStatuses.has(nextStatus)) throw new Error('Status de acesso invalido.')

  if (!hasDatabase) throw new Error('Gestao de membros requer DATABASE_URL.')

  return withTenant(actor.tenantId, async (client) => {
    const targetResult = await client.query(`
      select tm.user_id::text, tm.role, tm.status, tm.created_at, tm.updated_at, u.name, u.email
        from tenant_memberships tm
        join users u on u.id = tm.user_id
       where tm.tenant_id = $1 and tm.user_id::text = $2
       for update
    `, [actor.tenantId, targetUserId])
    const target = targetResult.rows[0]
    if (!target) throw new Error('Membro nao encontrado')

    const actorRole = normalizeRole(actor.role)
    const changesOwner = target.role === 'owner' || nextRole === 'owner'
    if (actorRole !== 'owner' && changesOwner) {
      throw new Error('Apenas um Owner pode alterar o acesso de outro Owner.')
    }

    const removesActiveOwner = target.role === 'owner' && target.status === 'active' &&
      (nextRole !== 'owner' || nextStatus !== 'active')
    if (removesActiveOwner) {
      const ownersResult = await client.query(`
        select user_id
          from tenant_memberships
         where tenant_id = $1 and role = 'owner' and status = 'active'
         for update
      `, [actor.tenantId])
      if (ownersResult.rowCount <= 1) throw new Error('O ultimo Owner ativo nao pode ser removido ou suspenso.')
    }

    const changed = target.role !== nextRole || target.status !== nextStatus
    if (changed) {
      await client.query(`
        update tenant_memberships
           set role = $3, status = $4, updated_at = now()
         where tenant_id = $1 and user_id::text = $2
      `, [actor.tenantId, targetUserId, nextRole, nextStatus])

      // A permission change must take effect before the member can reuse any existing session.
      await client.query(`
        update refresh_tokens
           set revoked_at = coalesce(revoked_at, now())
         where tenant_id = $1 and user_id = $2
      `, [actor.tenantId, targetUserId])
      await client.query(`
        update users set token_version = token_version + 1, updated_at = now()
         where id::text = $1
      `, [targetUserId])

      await writeAuditEvent(actor.tenantId, {
        action: 'membership.updated', actorType: 'user', actorId: actor.id,
        entityType: 'membership', entityId: targetUserId,
        details: {
          fromRole: target.role, toRole: nextRole,
          fromStatus: target.status, toStatus: nextStatus
        }
      }, client)
    }

    const updatedResult = await client.query(`
      select tm.user_id, tm.role, tm.status, tm.created_at, tm.updated_at, u.name, u.email
        from tenant_memberships tm
        join users u on u.id = tm.user_id
       where tm.tenant_id = $1 and tm.user_id::text = $2
    `, [actor.tenantId, targetUserId])
    return publicMember(updatedResult.rows[0])
  })
}
