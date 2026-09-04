import { createToken, verifyToken } from '../auth/token.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { clearRefreshCookie, createRefreshCookie, readRefreshCookie } from '../http/cookies.js'
import { changeUserPassword, createSession, listUserSessions, loginUser, registerUser, revokeAllUserSessions, revokeRefreshSession, revokeUserSession, rotateRefreshToken, touchUserSession, validateAccessPayload } from '../repositories/authRepository.js'
import { acceptInvitation } from '../repositories/invitationsRepository.js'
import { cancelTenantDeletionOnLogin, requestTenantDeletion } from '../services/tenantDeletion.js'

const authPayload = (user, session) => {
  const accessToken = createToken(user, session)
  return {
    user,
    accessToken,
    token: accessToken
  }
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.socket.remoteAddress || '')

const maskIp = (ip) => {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).concat('0').join('.')
  const blocks = ip.split(':').filter(Boolean)
  return blocks.length > 1 ? `${blocks.slice(0, 3).join(':')}::` : ''
}

const sessionMetadata = (req) => {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300)
  return {
    ipMasked: maskIp(clientIp(req)),
    userAgent,
    deviceLabel: userAgent ? userAgent.replace(/\s+/g, ' ').slice(0, 120) : 'Dispositivo nao identificado'
  }
}

const sendAuth = (res, status, user, session, extra = {}) => sendJson(res, status, {
  ...authPayload(user, session),
  ...extra
}, { 'Set-Cookie': createRefreshCookie(session.refreshToken) })

export const getAuthUser = async (req) => {
  const header = req.headers.authorization || ''
  const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : ''
  const payload = verifyToken(token)
  if (!payload) return null
  const user = await validateAccessPayload(payload)
  if (!user) return null
  await touchUserSession(user, payload.sid, sessionMetadata(req))
  return user
}

export const handleRegister = async (req, res) => {
  const user = await registerUser(await readJsonBody(req))
  const session = await createSession(user, undefined, sessionMetadata(req))
  return sendAuth(res, 201, user, session)
}

export const handleLogin = async (req, res) => {
  const user = await loginUser(await readJsonBody(req))
  const deletionCancelled = await cancelTenantDeletionOnLogin(user, req)
  const session = await createSession(user, undefined, sessionMetadata(req))
  return sendAuth(res, 200, user, session, { deletionCancelled })
}

export const handlePasswordChange = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })

  const updatedUser = await changeUserPassword(user, await readJsonBody(req))
  const session = await createSession(updatedUser, undefined, sessionMetadata(req))
  return sendAuth(res, 200, updatedUser, session)
}

export const handleTenantDeletionRequest = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  const result = await requestTenantDeletion(user, await readJsonBody(req), req)
  return sendJson(res, 202, result)
}

export const handleMe = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  return sendJson(res, 200, {
    user: {
      id: String(user.id),
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      role: user.role,
      status: 'active'
    }
  })
}

export const handleRefresh = async (req, res) => {
  const session = await rotateRefreshToken(readRefreshCookie(req), sessionMetadata(req))
  return sendAuth(res, 200, session.user, session)
}

export const handleLogout = async (req, res) => {
  await revokeRefreshSession(readRefreshCookie(req))
  return sendJson(res, 200, { status: 'logged_out' }, { 'Set-Cookie': clearRefreshCookie() })
}

export const handleInvitationAccept = async (req, res) => {
  const user = await acceptInvitation(await readJsonBody(req))
  const session = await createSession(user, undefined, sessionMetadata(req))
  return sendAuth(res, 201, user, session)
}

export const handleSessionsList = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  return sendJson(res, 200, await listUserSessions(user))
}

export const handleSessionRevoke = async (req, res, sessionId) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  await revokeUserSession(user, sessionId)
  return sendJson(res, 200, { status: 'revoked' })
}

export const handleSessionsRevokeAll = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  await revokeAllUserSessions(user)
  return sendJson(res, 200, { status: 'revoked_all' })
}
