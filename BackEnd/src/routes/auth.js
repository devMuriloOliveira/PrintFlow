import { createToken, verifyToken } from '../auth/token.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { createSession, loginUser, registerUser, revokeRefreshSession, rotateRefreshToken, validateAccessPayload } from '../repositories/authRepository.js'

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
  const session = await createSession(user)
  return sendJson(res, 200, authPayload(user, session))
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
