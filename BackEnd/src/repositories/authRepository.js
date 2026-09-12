import { createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { createOpaqueId } from '../auth/token.js'
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../auth/password.js'
import { hasDatabase, query, tenantQuery, withTenant } from '../db/pool.js'
import { blindIndex, blindIndexesForLookup, decryptField, encryptField } from '../security/crypto.js'
import { writeAuditEvent } from '../services/operationalEvents.js'
import { generateMfaSecret, verifyTotpCode } from '../services/mfa.js'

const memoryUsers = new Map()
const memoryUsersById = new Map()
const memoryRefreshTokens = new Map()
const memoryAuthTokens = new Map()
const memoryMfa = new Map()

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
const isConfiguredPlatformSuperAdmin = (email) => env.platformSuperAdminEmails.includes(normalizeEmail(email))
const refreshTokenHash = (token) => createHash('sha256').update(String(token || '')).digest('hex')
const createRefreshTokenValue = () => `refresh_${randomBytes(32).toString('base64url')}`
const refreshExpiresAt = () => new Date(Date.now() + env.refreshTokenTtlSeconds * 1000)
const authTokenHash = (token) => createHash('sha256').update(String(token || '')).digest('hex')
const authTokenExpiresAt = () => new Date(Date.now() + 15 * 60 * 1000)

const sessionMetadata = (metadata = {}) => ({
  ipMasked: String(metadata.ipMasked || '').slice(0, 80),
  deviceLabel: String(metadata.deviceLabel || '').slice(0, 120),
  userAgent: String(metadata.userAgent || '').slice(0, 300)
})

const publicUser = (row) => ({
  id: String(row.id),
  tenantId: row.tenant_id,
  name: decryptField(row.name),
  email: decryptField(row.email),
  role: row.role,
  platformRole: row.platform_role || '',
  status: row.status,
  tokenVersion: Number(row.token_version || 0)
})

const publicUserFromPayload = (payload, user = {}) => ({
  id: String(payload.sub),
  tenantId: payload.tenantId,
  name: user.name || '',
  email: user.email || '',
  role: payload.role,
  platformRole: payload.platformRole || '',
  status: 'active',
  tokenVersion: Number(payload.tokenVersion || 0)
})

const createMemorySession = (user, sessionId = createOpaqueId('session'), metadata) => {
  const refreshToken = createRefreshTokenValue()
  const tokenHash = refreshTokenHash(refreshToken)
  memoryRefreshTokens.set(tokenHash, {
    tokenHash,
    sessionId,
    userId: String(user.id),
    tenantId: user.tenantId,
    expiresAt: refreshExpiresAt(),
    revokedAt: null,
    replacedByHash: null,
    ...sessionMetadata(metadata),
    createdAt: new Date(),
    lastSeenAt: new Date()
  })
  return { refreshToken, sessionId }
}

const revokeMemorySession = (sessionId) => {
  for (const entry of memoryRefreshTokens.values()) {
    if (entry.sessionId === sessionId && !entry.revokedAt) entry.revokedAt = new Date()
  }
}

const revokeAllMemoryUserSessions = (userId) => {
  for (const entry of memoryRefreshTokens.values()) {
    if (entry.userId === String(userId) && !entry.revokedAt) entry.revokedAt = new Date()
  }
}

const incrementMemoryTokenVersion = (userId) => {
  const user = memoryUsersById.get(String(userId))
  if (!user) return
  user.token_version = Number(user.token_version || 0) + 1
}

const createDatabaseSession = async (user, sessionId = createOpaqueId('session'), metadata) => {
  const refreshToken = createRefreshTokenValue()
  const tokenHash = refreshTokenHash(refreshToken)
  const context = sessionMetadata(metadata)
  await query(
    `insert into refresh_tokens (tenant_id, user_id, session_id, token_hash, expires_at, ip_masked, device_label, user_agent, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [user.tenantId, String(user.id), sessionId, tokenHash, refreshExpiresAt(), context.ipMasked, context.deviceLabel, context.userAgent]
  )
  return { refreshToken, sessionId }
}

export const createSession = async (user, sessionId, metadata) =>
  hasDatabase ? createDatabaseSession(user, sessionId, metadata) : createMemorySession(user, sessionId, metadata)

export const validateAccessPayload = async (payload) => {
  if (!payload?.sub || !payload?.tenantId || !payload?.sid) return null

  if (!hasDatabase) {
    const user = memoryUsersById.get(String(payload.sub))
    if (!user || user.status !== 'active') return null
    if (Number(user.token_version || 0) !== Number(payload.tokenVersion || 0)) return null

    const activeSession = [...memoryRefreshTokens.values()].some((entry) =>
      entry.sessionId === payload.sid &&
      entry.userId === String(payload.sub) &&
      !entry.revokedAt &&
      entry.expiresAt > new Date()
    )
    return activeSession ? publicUserFromPayload(payload, user) : null
  }

  const result = await tenantQuery(
    payload.tenantId,
    `select u.id, u.tenant_id, u.name, u.email, tm.role,
      case when u.role = 'platform_super_admin' then u.role else '' end as platform_role,
      u.status, u.token_version
     from users u
     join tenant_memberships tm on tm.tenant_id = u.tenant_id and tm.user_id = u.id
     where u.id = $1 and u.tenant_id = $2 and u.status = 'active'
       and tm.status = 'active'
       and u.token_version = $3
       and exists (
         select 1 from refresh_tokens rt
         where rt.user_id = u.id::text and rt.session_id = $4
           and rt.revoked_at is null and rt.expires_at > now()
       )
     limit 1`,
    [payload.sub, payload.tenantId, Number(payload.tokenVersion || 0), payload.sid]
  )

  return result.rows[0] ? publicUser(result.rows[0]) : null
}

export const rotateRefreshToken = async (refreshToken, metadata) => {
  const tokenHash = refreshTokenHash(refreshToken)

  if (!hasDatabase) {
    const current = memoryRefreshTokens.get(tokenHash)
    if (!current || current.expiresAt <= new Date()) throw new Error('Refresh token invalido.')

    if (current.revokedAt) {
      revokeMemorySession(current.sessionId)
      incrementMemoryTokenVersion(current.userId)
      throw new Error('Refresh token reutilizado.')
    }

    const user = memoryUsersById.get(String(current.userId))
    if (!user || user.status !== 'active') throw new Error('Refresh token invalido.')
    const session = createMemorySession(publicUser(user), current.sessionId, metadata)
    current.revokedAt = new Date()
    current.replacedByHash = refreshTokenHash(session.refreshToken)
    return { user: publicUser(user), ...session }
  }

  const result = await query(
    `select rt.id, rt.tenant_id, rt.user_id, rt.session_id, rt.expires_at, rt.revoked_at,
      u.name, u.email, case when u.role = 'platform_super_admin' then u.role else '' end as platform_role, u.status, u.token_version
     from refresh_tokens rt
     join users u on u.id::text = rt.user_id and u.tenant_id = rt.tenant_id
     where rt.token_hash = $1
     limit 1`,
    [tokenHash]
  )
  const current = result.rows[0]
  if (!current || current.expires_at <= new Date() || current.status !== 'active') throw new Error('Refresh token invalido.')

  if (current.revoked_at) {
    await query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where session_id = $1', [current.session_id])
    await query('update users set token_version = token_version + 1, updated_at = now() where id = $1', [current.user_id])
    throw new Error('Refresh token reutilizado.')
  }

  const membershipResult = await tenantQuery(
    current.tenant_id,
    `select role, status from tenant_memberships where tenant_id = $1 and user_id::text = $2 limit 1`,
    [current.tenant_id, current.user_id]
  )
  const membership = membershipResult.rows[0]
  if (!membership || membership.status !== 'active') throw new Error('Refresh token invalido.')

  const user = publicUser({
    id: current.user_id,
    tenant_id: current.tenant_id,
    name: current.name,
    email: current.email,
    role: membership.role,
    platform_role: current.platform_role,
    status: current.status,
    token_version: current.token_version
  })
  const session = await createDatabaseSession(user, current.session_id, metadata)
  await query(
    `update refresh_tokens set revoked_at = now(), replaced_by_hash = $1 where id = $2`,
    [refreshTokenHash(session.refreshToken), current.id]
  )
  return { user, ...session }
}

export const revokeRefreshSession = async (refreshToken) => {
  const tokenHash = refreshTokenHash(refreshToken)

  if (!hasDatabase) {
    const current = memoryRefreshTokens.get(tokenHash)
    if (!current) return
    revokeMemorySession(current.sessionId)
    incrementMemoryTokenVersion(current.userId)
    return
  }

  const result = await query('select session_id, user_id from refresh_tokens where token_hash = $1 limit 1', [tokenHash])
  const current = result.rows[0]
  if (!current) return
  await query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where session_id = $1', [current.session_id])
  await query('update users set token_version = token_version + 1, updated_at = now() where id = $1', [current.user_id])
}

export const registerUser = async ({ name, email, password, company }) => {
  const normalizedEmail = normalizeEmail(email)
  const cleanName = String(name || '').trim()
  const companyName = String(company || cleanName || 'PrintFlow 3D').trim()

  if (!cleanName) throw new Error('Informe o nome.')
  if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail valido.')
  const passwordPolicyError = validatePasswordPolicy(password)
  if (passwordPolicyError) throw new Error(passwordPolicyError)

  const tenantId = createOpaqueId('tenant')
  const passwordHash = hashPassword(password)
  const emailHash = blindIndex(normalizedEmail)

  if (!hasDatabase) {
    if (memoryUsers.has(normalizedEmail)) throw new Error('Este e-mail ja esta cadastrado.')
    const user = { id: createOpaqueId('user'), tenant_id: tenantId, name: cleanName, email: normalizedEmail, password_hash: passwordHash, role: 'owner', platform_role: isConfiguredPlatformSuperAdmin(normalizedEmail) ? 'platform_super_admin' : '', status: 'active', token_version: 0, email_verified_at: env.authRequireEmailVerification ? null : new Date() }
    memoryUsers.set(normalizedEmail, user)
    memoryUsersById.set(String(user.id), user)
    return publicUser(user)
  }

  const existing = await query('select id from users where email_hash = any($1::text[]) or email = $2 limit 1', [blindIndexesForLookup(normalizedEmail), normalizedEmail])
  if (existing.rowCount) throw new Error('Este e-mail ja esta cadastrado.')

  await query(
    `insert into tenants (id, name, email, is_initialized, billing_enforcement_exempt)
     values ($1, $2, $3, false, false)
     on conflict (id) do nothing`,
    [tenantId, encryptField(companyName), encryptField(normalizedEmail)]
  )

  let result
  try {
    result = await query(
      `insert into users (tenant_id, name, email, email_hash, password_hash, role, status, token_version)
       values ($1, $2, $3, $4, $5, $6, 'active', 0)
       returning id, tenant_id, name, email, role, status, token_version`,
      [tenantId, encryptField(cleanName), encryptField(normalizedEmail), emailHash, passwordHash, isConfiguredPlatformSuperAdmin(normalizedEmail) ? 'platform_super_admin' : 'admin']
    )
  } catch (error) {
    if (error?.code === '23505') throw new Error('Este e-mail ja esta cadastrado.')
    throw error
  }

  await tenantQuery(
    tenantId,
    `insert into tenant_memberships (tenant_id, user_id, role, status)
     values ($1, $2, 'owner', 'active')
     on conflict (tenant_id, user_id) do nothing`,
    [tenantId, result.rows[0].id]
  )

  if (isConfiguredPlatformSuperAdmin(normalizedEmail)) {
    await query(`insert into platform_super_admins (user_id, email_hash) values ($1, $2) on conflict (user_id) do update set email_hash = excluded.email_hash, status = 'active', updated_at = now()`, [result.rows[0].id, emailHash])
  }

  await writeAuditEvent(tenantId, {
    action: 'membership.owner.granted', actorType: 'user', actorId: result.rows[0].id,
    entityType: 'membership', entityId: result.rows[0].id, details: { role: 'owner' }
  })

  return publicUser({
    ...result.rows[0],
    role: 'owner',
    platform_role: result.rows[0].role === 'platform_super_admin' ? 'platform_super_admin' : ''
  })
}

export const loginUser = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password) throw new Error('Informe e-mail e senha.')
  const emailHash = blindIndex(normalizedEmail)

  if (!hasDatabase) {
    const user = memoryUsers.get(normalizedEmail)
    if (!user || !verifyPassword(password, user.password_hash)) throw new Error('E-mail ou senha invalidos.')
    if (env.authRequireEmailVerification && !user.email_verified_at) throw new Error('Confirme seu e-mail antes de entrar.')
    return publicUser(user)
  }

  const result = await query(
    `select id, tenant_id, name, email, email_hash, password_hash, email_verified_at,
      case when role = 'platform_super_admin' then role else '' end as platform_role,
      status, token_version
     from users where (email_hash = any($1::text[]) or email = $2) and status = 'active' limit 1`,
    [blindIndexesForLookup(normalizedEmail), normalizedEmail]
  )
  const user = result.rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('E-mail ou senha invalidos.')
  if (env.authRequireEmailVerification && !user.email_verified_at) throw new Error('Confirme seu e-mail antes de entrar.')

  const membershipResult = await tenantQuery(
    user.tenant_id,
    `select role, status from tenant_memberships where tenant_id = $1 and user_id = $2 limit 1`,
    [user.tenant_id, user.id]
  )
  const membership = membershipResult.rows[0]
  if (!membership || membership.status !== 'active') throw new Error('E-mail ou senha invalidos.')

  if (!user.email_hash || user.email_hash !== emailHash || user.email === normalizedEmail) {
    await query(
      `update users set name = $1, email = $2, email_hash = $3, updated_at = now()
       where id = $4`,
      [encryptField(decryptField(user.name)), encryptField(normalizedEmail), emailHash, user.id]
    )
  }

  return publicUser({ ...user, role: membership.role })
}

export const createAuthEmailToken = async (userId, purpose) => {
  const token = `auth_${randomBytes(32).toString('base64url')}`
  const tokenHash = authTokenHash(token)
  const expiresAt = authTokenExpiresAt()
  if (!hasDatabase) {
    for (const [hash, entry] of memoryAuthTokens) if (entry.userId === String(userId) && entry.purpose === purpose && !entry.consumedAt) entry.consumedAt = new Date()
    memoryAuthTokens.set(tokenHash, { userId: String(userId), purpose, expiresAt, consumedAt: null })
    return { token, expiresAt }
  }
  await query('update auth_email_tokens set consumed_at = now() where user_id = $1 and purpose = $2 and consumed_at is null', [String(userId), purpose])
  await query('insert into auth_email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, $3, $4)', [tokenHash, String(userId), purpose, expiresAt])
  return { token, expiresAt }
}

export const consumeAuthEmailToken = async (token, purpose) => {
  const tokenHash = authTokenHash(token)
  if (!hasDatabase) {
    const entry = memoryAuthTokens.get(tokenHash)
    if (!entry || entry.purpose !== purpose || entry.consumedAt || entry.expiresAt <= new Date()) throw new Error('Token invalido ou expirado.')
    entry.consumedAt = new Date()
    return entry.userId
  }
  const result = await query(`update auth_email_tokens set consumed_at = now() where token_hash = $1 and purpose = $2 and consumed_at is null and expires_at > now() returning user_id`, [tokenHash, purpose])
  if (!result.rows[0]) throw new Error('Token invalido ou expirado.')
  return String(result.rows[0].user_id)
}

export const markEmailVerified = async (userId) => {
  if (!hasDatabase) {
    const user = memoryUsersById.get(String(userId))
    if (!user) throw new Error('Usuario nao encontrado.')
    user.email_verified_at = user.email_verified_at || new Date()
    return
  }
  await query('update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id::text = $1', [String(userId)])
}

export const resetUserPassword = async (userId, newPassword) => {
  const passwordError = validatePasswordPolicy(newPassword)
  if (passwordError) throw new Error(passwordError)
  if (!hasDatabase) {
    const stored = memoryUsersById.get(String(userId))
    if (!stored) throw new Error('Usuario nao encontrado.')
    stored.password_hash = hashPassword(newPassword)
    revokeAllMemoryUserSessions(userId)
    incrementMemoryTokenVersion(userId)
    return publicUser(stored)
  }
  const tokenVersion = await query(`update users set password_hash = $1, token_version = token_version + 1, updated_at = now() where id::text = $2 and status = 'active' returning id, tenant_id, name, email, role, platform_role, status, token_version`, [hashPassword(newPassword), String(userId)])
  if (!tokenVersion.rows[0]) throw new Error('Usuario nao encontrado.')
  await query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and revoked_at is null', [String(userId)])
  return publicUser(tokenVersion.rows[0])
}

export const findActiveUserByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null
  if (!hasDatabase) {
    const stored = memoryUsers.get(normalizedEmail)
    return stored ? publicUser(stored) : null
  }
  const result = await query(`select id, tenant_id, name, email, role, platform_role, status, token_version from users where (email_hash = any($1::text[]) or email = $2) and status = 'active' limit 1`, [blindIndexesForLookup(normalizedEmail), normalizedEmail])
  return result.rows[0] ? publicUser(result.rows[0]) : null
}

export const findActiveUserById = async (userId) => {
  if (!hasDatabase) {
    const stored = memoryUsersById.get(String(userId))
    return stored ? publicUser(stored) : null
  }
  const result = await query(`select id, tenant_id, name, email, role, platform_role, status, token_version from users where id::text = $1 and status = 'active' limit 1`, [String(userId)])
  return result.rows[0] ? publicUser(result.rows[0]) : null
}

export const createMfaSetup = (email) => {
  const secret = generateMfaSecret()
  return { secret, email: String(email || '') }
}

export const enableUserMfa = async (userId, secret, code) => {
  if (!verifyTotpCode(secret, code)) throw new Error('Codigo MFA invalido.')
  if (!hasDatabase) { memoryMfa.set(String(userId), { secret }); return }
  await query(`insert into user_mfa (user_id, secret, enabled) values ($1, $2, true) on conflict (user_id) do update set secret = excluded.secret, enabled = true, updated_at = now()`, [String(userId), encryptField(secret)])
}

export const disableUserMfa = async (userId) => {
  if (!hasDatabase) { memoryMfa.delete(String(userId)); return }
  await query('delete from user_mfa where user_id = $1', [String(userId)])
}

export const verifyUserCurrentPassword = async (userId, password) => {
  const candidate = String(password || '')
  if (!candidate) return false
  if (!hasDatabase) {
    const stored = memoryUsersById.get(String(userId))
    return Boolean(stored && verifyPassword(candidate, stored.password_hash))
  }
  const result = await query('select password_hash from users where id::text = $1 and status = \'active\' limit 1', [String(userId)])
  return Boolean(result.rows[0] && verifyPassword(candidate, result.rows[0].password_hash))
}

export const isUserMfaEnabled = async (userId) => {
  if (!hasDatabase) return memoryMfa.has(String(userId))
  const result = await query('select 1 from user_mfa where user_id = $1 and enabled = true limit 1', [String(userId)])
  return Boolean(result.rowCount)
}

export const createMfaChallenge = async (userId) => createAuthEmailToken(userId, 'mfa_login')

export const consumeMfaChallenge = async (token) => consumeAuthEmailToken(token, 'mfa_login')

export const verifyUserMfa = async (userId, code) => {
  let secret = memoryMfa.get(String(userId))?.secret || ''
  if (hasDatabase) {
    const result = await query('select secret from user_mfa where user_id = $1 and enabled = true limit 1', [String(userId)])
    secret = result.rows[0] ? decryptField(result.rows[0].secret) : ''
  }
  return Boolean(secret && verifyTotpCode(secret, code))
}

export const changeUserPassword = async (user, { currentPassword, newPassword }) => {
  const current = String(currentPassword || '')
  const passwordError = validatePasswordPolicy(newPassword)

  if (!current) throw new Error('Informe a senha atual.')
  if (passwordError) throw new Error(passwordError)
  if (current === String(newPassword || '')) throw new Error('A nova senha deve ser diferente da senha atual.')

  if (!hasDatabase) {
    const stored = memoryUsersById.get(String(user.id))
    if (!stored || !verifyPassword(current, stored.password_hash)) throw new Error('Senha atual invalida.')

    stored.password_hash = hashPassword(newPassword)
    revokeAllMemoryUserSessions(stored.id)
    incrementMemoryTokenVersion(stored.id)
    return { ...publicUser(stored), tokenVersion: stored.token_version }
  }

  return withTenant(user.tenantId, async (client) => {
    const result = await client.query(
      `select password_hash, token_version
         from users
        where id::text = $1 and tenant_id = $2 and status = 'active'
        limit 1`,
      [String(user.id), String(user.tenantId)]
    )
    const stored = result.rows[0]
    if (!stored || !verifyPassword(current, stored.password_hash)) throw new Error('Senha atual invalida.')

    const tokenVersion = Number(stored.token_version || 0) + 1
    await client.query(
      `update users
          set password_hash = $1, token_version = $2, updated_at = now()
        where id::text = $3 and tenant_id = $4`,
      [hashPassword(newPassword), tokenVersion, String(user.id), String(user.tenantId)]
    )
    await client.query(
      `update refresh_tokens
          set revoked_at = coalesce(revoked_at, now())
        where tenant_id = $1 and user_id = $2 and revoked_at is null`,
      [String(user.tenantId), String(user.id)]
    )
    await writeAuditEvent(user.tenantId, {
      action: 'password.changed', actorType: 'user', actorId: user.id,
      entityType: 'user', entityId: String(user.id), details: { sessionsRevoked: true }
    }, client)

    return { ...user, tokenVersion }
  })
}

export const listUserSessions = async (user) => {
  if (!hasDatabase) {
    return [...memoryRefreshTokens.values()]
      .filter((entry) => entry.userId === String(user.id) && !entry.revokedAt && entry.expiresAt > new Date())
      .map((entry) => ({ sessionId: entry.sessionId, createdAt: entry.createdAt, expiresAt: entry.expiresAt, lastSeenAt: entry.lastSeenAt, deviceLabel: entry.deviceLabel, ipMasked: entry.ipMasked }))
  }
  const result = await tenantQuery(user.tenantId, `
    select distinct on (session_id) session_id, created_at, expires_at, last_seen_at, device_label, ip_masked
      from refresh_tokens
     where tenant_id = $1 and user_id = $2 and revoked_at is null and expires_at > now()
     order by session_id, created_at desc
  `, [user.tenantId, String(user.id)])
  return result.rows
    .sort((left, right) => new Date(right.last_seen_at) - new Date(left.last_seen_at))
    .map((row) => ({ sessionId: row.session_id, createdAt: row.created_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, deviceLabel: row.device_label, ipMasked: row.ip_masked }))
}

export const touchUserSession = async (user, sessionId, metadata) => {
  if (!sessionId) return
  const context = sessionMetadata(metadata)

  if (!hasDatabase) {
    for (const entry of memoryRefreshTokens.values()) {
      if (entry.sessionId === sessionId && entry.userId === String(user.id) && !entry.revokedAt) {
        entry.lastSeenAt = new Date()
        if (context.ipMasked) entry.ipMasked = context.ipMasked
        if (context.deviceLabel) entry.deviceLabel = context.deviceLabel
      }
    }
    return
  }

  await tenantQuery(user.tenantId, `
    update refresh_tokens
       set last_seen_at = now(),
           ip_masked = case when $4 <> '' then $4 else ip_masked end,
           device_label = case when $5 <> '' then $5 else device_label end,
           user_agent = case when $6 <> '' then $6 else user_agent end
     where tenant_id = $1 and user_id = $2 and session_id = $3 and revoked_at is null
  `, [user.tenantId, String(user.id), sessionId, context.ipMasked, context.deviceLabel, context.userAgent])
}

export const revokeUserSession = async (user, sessionId) => {
  if (!hasDatabase) throw new Error('Sessoes requerem DATABASE_URL.')
  const result = await tenantQuery(user.tenantId, `
    update refresh_tokens set revoked_at = coalesce(revoked_at, now())
     where tenant_id = $1 and user_id = $2 and session_id = $3 and revoked_at is null
     returning session_id
  `, [user.tenantId, String(user.id), String(sessionId || '')])
  if (!result.rowCount) throw new Error('Sessao nao encontrada')
  await writeAuditEvent(user.tenantId, { action: 'session.revoked', actorType: 'user', actorId: user.id, entityType: 'session', entityId: sessionId })
}

export const revokeAllUserSessions = async (user) => {
  if (!hasDatabase) throw new Error('Sessoes requerem DATABASE_URL.')
  await withTenant(user.tenantId, async (client) => {
    await client.query(`update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where tenant_id = $1 and user_id = $2 and revoked_at is null`, [user.tenantId, String(user.id)])
    await client.query(`update users set token_version = token_version + 1, updated_at = now() where id::text = $1`, [String(user.id)])
    await writeAuditEvent(user.tenantId, { action: 'sessions.revoked_all', actorType: 'user', actorId: user.id, entityType: 'session', entityId: String(user.id) }, client)
  })
}
