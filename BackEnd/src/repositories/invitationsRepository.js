import { createHash, randomBytes } from 'node:crypto'
import { createOpaqueId } from '../auth/token.js'
import { hashPassword, validatePasswordPolicy } from '../auth/password.js'
import { hasDatabase, query, tenantQuery, withTenant } from '../db/pool.js'
import { blindIndex, decryptField, encryptField } from '../security/crypto.js'
import { writeAuditEvent } from '../services/operationalEvents.js'
import { sendInvitationEmail } from '../services/email.js'

const inviteRoles = new Set(['admin', 'financeiro', 'producao', 'usuario'])
const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex')
const emailValue = (value) => String(value || '').trim().toLowerCase()
const publicInvite = (row) => ({ id: row.id, email: decryptField(row.email), role: row.role, expiresAt: row.expires_at })

export const createInvitation = async ({ actor, email, role }) => {
  const normalizedEmail = emailValue(email)
  const memberRole = String(role || '').toLowerCase()
  if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail valido.')
  if (!inviteRoles.has(memberRole)) throw new Error('Perfil de convite invalido.')
  if (!hasDatabase) throw new Error('Convites requerem DATABASE_URL.')

  const existing = await query('select id from users where email_hash = $1 limit 1', [blindIndex(normalizedEmail)])
  if (existing.rowCount) throw new Error('Este e-mail ja possui uma conta.')

  const token = `invite_${randomBytes(32).toString('base64url')}`
  const invitation = await withTenant(actor.tenantId, async (client) => {
    const result = await client.query(`
      insert into tenant_invitations (id, tenant_id, email, email_hash, role, token_hash, invited_by, expires_at)
      values ($1, $2, $3, $4, $5, $6, $7, now() + interval '7 days')
      returning id, email, role, expires_at
    `, [createOpaqueId('invite'), actor.tenantId, encryptField(normalizedEmail), blindIndex(normalizedEmail), memberRole, tokenHash(token), actor.id])
    await writeAuditEvent(actor.tenantId, { action: 'invitation.created', actorType: 'user', actorId: actor.id, entityType: 'invitation', entityId: result.rows[0].id, details: { role: memberRole } }, client)
    return publicInvite(result.rows[0])
  })

  const invitationUrl = `${String(process.env.APP_PUBLIC_URL || '').replace(/\/$/, '')}/aceitar-convite?token=${encodeURIComponent(token)}`
  try {
    await sendInvitationEmail({ email: normalizedEmail, invitationUrl, role: memberRole })
  } catch (error) {
    await tenantQuery(actor.tenantId, 'update tenant_invitations set revoked_at = now(), updated_at = now() where id = $1', [invitation.id])
    throw error
  }
  return invitation
}

export const acceptInvitation = async ({ token, name, password }) => {
  const passwordError = validatePasswordPolicy(password)
  if (!String(name || '').trim()) throw new Error('Informe o nome.')
  if (passwordError) throw new Error(passwordError)
  const lookup = await query(`select id, tenant_id from tenant_invitations where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() limit 1`, [tokenHash(token)])
  const found = lookup.rows[0]
  if (!found) throw new Error('Convite invalido ou expirado.')

  return withTenant(found.tenant_id, async (client) => {
    const inviteResult = await client.query(`select id, tenant_id, email, email_hash, role from tenant_invitations where id = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`, [found.id])
    const invite = inviteResult.rows[0]
    if (!invite) throw new Error('Convite invalido ou expirado.')
    const exists = await client.query('select id from users where email_hash = $1 limit 1', [invite.email_hash])
    if (exists.rowCount) throw new Error('Convite invalido ou expirado.')
    const userResult = await client.query(`insert into users (tenant_id, name, email, email_hash, password_hash, role, status, token_version) values ($1, $2, $3, $4, $5, 'admin', 'active', 0) returning id, tenant_id, name, email, status, token_version`, [invite.tenant_id, encryptField(String(name).trim()), invite.email, invite.email_hash, hashPassword(password)])
    const user = userResult.rows[0]
    await client.query(`insert into tenant_memberships (tenant_id, user_id, role, status) values ($1, $2, $3, 'active')`, [invite.tenant_id, user.id, invite.role])
    await client.query('update tenant_invitations set accepted_at = now(), updated_at = now() where id = $1', [invite.id])
    await writeAuditEvent(invite.tenant_id, { action: 'invitation.accepted', actorType: 'user', actorId: user.id, entityType: 'invitation', entityId: invite.id, details: { role: invite.role } }, client)
    return { id: String(user.id), tenantId: user.tenant_id, name: decryptField(user.name), email: decryptField(user.email), role: invite.role, platformRole: '', status: user.status, tokenVersion: Number(user.token_version || 0) }
  })
}
