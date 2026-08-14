import { createToken, verifyToken } from '../auth/token.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { loginUser, registerUser } from '../repositories/authRepository.js'

const authPayload = (user) => ({
  user,
  token: createToken(user)
})

export const getAuthUser = (req) => {
  const header = req.headers.authorization || ''
  const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : ''
  return verifyToken(token)
}

export const handleRegister = async (req, res) => {
  const user = await registerUser(await readJsonBody(req))
  return sendJson(res, 201, authPayload(user))
}

export const handleLogin = async (req, res) => {
  const user = await loginUser(await readJsonBody(req))
  return sendJson(res, 200, authPayload(user))
}

export const handleMe = async (req, res) => {
  const user = getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  return sendJson(res, 200, {
    user: {
      id: String(user.sub),
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      role: user.role,
      status: 'active'
    }
  })
}
