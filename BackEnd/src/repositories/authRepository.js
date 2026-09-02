import { createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { createOpaqueId } from '../auth/token.js'
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../auth/password.js'
import { hasDatabase, query } from '../db/pool.js'
import { blindIndex, blindIndexesForLookup, decryptField, encryptField } from '../security/crypto.js'

const memoryUsers = new Map()
const memoryUsersById = new Map()
const memoryRefreshTokens = new Map()

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
const refreshTokenHash = (token) => createHash('sha256').update(String(token || '')).digest('hex')
const createRefreshTokenValue = () => `refresh_${randomBytes(32).toString('base64url')}`
const refreshExpiresAt = () => new Date(Date.now() + env.refreshTokenTtlSeconds * 1000)

const publicUser = (row) => ({
  id: String(row.id),
  tenantId: row.tenant_id,
  name: decryptField(row.name),
  email: decryptField(row.email),
  role: row.role,
  status: row.status,
  tokenVersion: Number(row.token_version || 0)
})

const publicUserFromPayload = (payload) => ({
  id: String(payload.sub),
  tenantId: payload.tenantId,
  name: payload.name,
  email: payload.email,
  role: payload.role,
  status: 'active',
  tokenVersion: Number(payload.tokenVersion || 0)
})

const createMemorySession = (user, sessionId = createOpaqueId('session')) => {
  const refreshToken = createRefreshTokenValue()
  const tokenHash = refreshTokenHash(refreshToken)
  memoryRefreshTokens.set(tokenHash, {
    tokenHash,
    sessionId,
    userId: String(user.id),
    tenantId: user.tenantId,
    expiresAt: refreshExpiresAt(),
    revokedAt: null,
    replacedByHash: null
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

const createDatabaseSession = async (user, sessionId = createOpaqueId('session')) => {
  const refreshToken = createRefreshTokenValue()
  const tokenHash = refreshTokenHash(refreshToken)
  await query(
    `insert into refresh_tokens (tenant_id, user_id, session_id, token_hash, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [user.tenantId, String(user.id), sessionId, tokenHash, refreshExpiresAt()]
  )
  return { refreshToken, sessionId }
}

export const createSession = async (user, sessionId) =>
  hasDatabase ? createDatabaseSession(user, sessionId) : createMemorySession(user, sessionId)

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
    return activeSession ? publicUserFromPayload(payload) : null
  }

  const result = await query(
    `select u.id, u.tenant_id, u.name, u.email, u.role, u.status, u.token_version
     from users u
     where u.id = $1 and u.tenant_id = $2 and u.status = 'active'
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

export const rotateRefreshToken = async (refreshToken) => {
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
    const session = createMemorySession(publicUser(user), current.sessionId)
    current.revokedAt = new Date()
    current.replacedByHash = refreshTokenHash(session.refreshToken)
    return { user: publicUser(user), ...session }
  }

  const result = await query(
    `select rt.id, rt.tenant_id, rt.user_id, rt.session_id, rt.expires_at, rt.revoked_at,
      u.name, u.email, u.role, u.status, u.token_version
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

  const user = publicUser({
    id: current.user_id,
    tenant_id: current.tenant_id,
    name: current.name,
    email: current.email,
    role: current.role,
    status: current.status,
    token_version: current.token_version
  })
  const session = await createDatabaseSession(user, current.session_id)
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
    const user = { id: createOpaqueId('user'), tenant_id: tenantId, name: cleanName, email: normalizedEmail, password_hash: passwordHash, role: 'admin', status: 'active', token_version: 0 }
    memoryUsers.set(normalizedEmail, user)
    memoryUsersById.set(String(user.id), user)
    return publicUser(user)
  }

  const existing = await query('select id from users where email_hash = any($1::text[]) or email = $2 limit 1', [blindIndexesForLookup(normalizedEmail), normalizedEmail])
  if (existing.rowCount) throw new Error('Este e-mail ja esta cadastrado.')

  await query(
    `insert into tenants (id, name, email, is_initialized)
     values ($1, $2, $3, false)
     on conflict (id) do nothing`,
    [tenantId, encryptField(companyName), encryptField(normalizedEmail)]
  )

  const result = await query(
    `insert into users (tenant_id, name, email, email_hash, password_hash, role, status, token_version)
     values ($1, $2, $3, $4, $5, 'admin', 'active', 0)
     returning id, tenant_id, name, email, role, status, token_version`,
    [tenantId, encryptField(cleanName), encryptField(normalizedEmail), emailHash, passwordHash]
  )

  return publicUser(result.rows[0])
}

export const loginUser = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password) throw new Error('Informe e-mail e senha.')
  const emailHash = blindIndex(normalizedEmail)

  if (!hasDatabase) {
    const user = memoryUsers.get(normalizedEmail)
    if (!user || !verifyPassword(password, user.password_hash)) throw new Error('E-mail ou senha invalidos.')
    return publicUser(user)
  }

  const result = await query(
    `select id, tenant_id, name, email, email_hash, password_hash, role, status, token_version
     from users where (email_hash = any($1::text[]) or email = $2) and status = 'active' limit 1`,
    [blindIndexesForLookup(normalizedEmail), normalizedEmail]
  )
  const user = result.rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('E-mail ou senha invalidos.')

  if (!user.email_hash || user.email_hash !== emailHash || user.email === normalizedEmail) {
    await query(
      `update users set name = $1, email = $2, email_hash = $3, updated_at = now()
       where id = $4`,
      [encryptField(decryptField(user.name)), encryptField(normalizedEmail), emailHash, user.id]
    )
  }

  return publicUser(user)
}
