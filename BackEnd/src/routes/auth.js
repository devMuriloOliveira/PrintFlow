import { createToken, verifyToken } from '../auth/token.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { changeUserPassword, createSession, listUserSessions, loginUser, registerUser, revokeAllUserSessions, revokeRefreshSession, revokeUserSession, rotateRefreshToken, validateAccessPayload } from '../repositories/authRepository.js'
import { acceptInvitation } from '../repositories/invitationsRepository.js'
import { cancelTenantDeletionOnLogin, requestTenantDeletion } from '../services/tenantDeletion.js'

const authPayload = (user, session) => {
  const accessToken = createToken(user, session)
  return {
    user,
    accessToken,
    refreshToken: session.refreshToken,
    token: accessToken
  }
}

export const getAuthUser = async (req) => {
  const header = req.headers.authorization || ''
  const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : ''
  const payload = verifyToken(token)
  return payload ? validateAccessPayload(payload) : null
}

export const handleRegister = async (req, res) => {
  const user = await registerUser(await readJsonBody(req))
  const session = await createSession(user)
  return sendJson(res, 201, authPayload(user, session))
}

export const handleLogin = async (req, res) => {
  const user = await loginUser(await readJsonBody(req))
  const deletionCancelled = await cancelTenantDeletionOnLogin(user, req)
  const session = await createSession(user)
  return sendJson(res, 200, { ...authPayload(user, session), deletionCancelled })
}

export const handlePasswordChange = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })

  const updatedUser = await changeUserPassword(user, await readJsonBody(req))
  const session = await createSession(updatedUser)
  return sendJson(res, 200, authPayload(updatedUser, session))
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
  const payload = await readJsonBody(req)
  const session = await rotateRefreshToken(payload.refreshToken)
  return sendJson(res, 200, authPayload(session.user, session))
}

export const handleLogout = async (req, res) => {
  const payload = await readJsonBody(req)
  await revokeRefreshSession(payload.refreshToken)
  return sendJson(res, 200, { status: 'logged_out' })
}

export const handleInvitationAccept = async (req, res) => {
  const user = await acceptInvitation(await readJsonBody(req))
  const session = await createSession(user)
  return sendJson(res, 201, authPayload(user, session))
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
