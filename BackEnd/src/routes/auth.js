import { createToken, verifyToken } from '../auth/token.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { env } from '../config/env.js'
import { clearRefreshCookie, createRefreshCookie, readRefreshCookie } from '../http/cookies.js'
import { getClientIp } from '../http/clientIp.js'
import { changeUserPassword, consumeAuthEmailCode, consumeAuthEmailToken, consumeMfaChallenge, createAuthEmailCode, createAuthEmailToken, createMfaChallenge, createMfaSetup, createSession, disableUserMfa, enableUserMfa, findActiveUserByEmail, findActiveUserById, isUserMfaEnabled, listUserSessions, loginOrRegisterGoogleUser, loginUser, markEmailVerified, registerUser, resetUserPassword, revokeAllUserSessions, revokeRefreshSession, revokeUserSession, rotateRefreshToken, touchUserSession, validateAccessPayload, verifyUserCurrentPassword, verifyUserMfa } from '../repositories/authRepository.js'
import { otpauthUri } from '../services/mfa.js'
import { isEmailDeliveryConfigured, sendAuthEmail } from '../services/email.js'
import { acceptInvitation } from '../repositories/invitationsRepository.js'
import { cancelTenantDeletionOnLogin, requestTenantDeletion } from '../services/tenantDeletion.js'
import { verifyGoogleCredential } from '../services/googleAuth.js'

const authPayload = (user, session) => {
  const accessToken = createToken(user, session)
  return {
    user,
    accessToken,
    token: accessToken
  }
}

const maskIp = (ip) => {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).concat('0').join('.')
  const blocks = ip.split(':').filter(Boolean)
  return blocks.length > 1 ? `${blocks.slice(0, 3).join(':')}::` : ''
}

const sessionMetadata = (req) => {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300)
  return {
    ipMasked: maskIp(getClientIp(req)),
    userAgent,
    deviceLabel: userAgent ? userAgent.replace(/\s+/g, ' ').slice(0, 120) : 'Dispositivo nao identificado'
  }
}

const sendAuth = (res, status, user, session, extra = {}) => sendJson(res, status, {
  ...authPayload(user, session),
  ...extra
}, { 'Set-Cookie': createRefreshCookie(session.refreshToken) })

// Uma request pode passar por autenticação global, autorização e pelo handler
// específico. Reutilizar a mesma promessa evita validar o JWT e tocar a sessão
// mais de uma vez, sem compartilhar autenticação entre requests diferentes.
const authUserByRequest = new WeakMap()

export const getAuthUser = async (req) => {
  if (authUserByRequest.has(req)) return authUserByRequest.get(req)
  const resolution = (async () => {
    const header = req.headers.authorization || ''
    const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : ''
    const payload = verifyToken(token)
    if (!payload) return null
    const user = await validateAccessPayload(payload)
    if (!user) return null
    await touchUserSession(user, payload.sid, sessionMetadata(req))
    req.printflowTenantId = user.tenantId || null
    return user
  })()
  authUserByRequest.set(req, resolution)
  return resolution
}

export const handleRegister = async (req, res) => {
  if (env.authRequireEmailVerification && !isEmailDeliveryConfigured()) return sendJson(res, 503, { error: 'Confirmacao de e-mail ainda nao configurada.' })
  const user = await registerUser(await readJsonBody(req))
  if (env.authRequireEmailVerification) {
    const { token } = await createAuthEmailToken(user.id, 'verify_email')
    if (isEmailDeliveryConfigured()) await sendAuthEmail({ email: user.email, subject: 'Confirme seu e-mail no Filamind', text: `Confirme seu cadastro em ate 15 minutos: ${env.appPublicUrl}/verificar-email?token=${encodeURIComponent(token)}` })
    return sendJson(res, 202, { user, verificationRequired: true })
  }
  const session = await createSession(user, undefined, sessionMetadata(req))
  return sendAuth(res, 201, user, session)
}

export const handleLogin = async (req, res) => {
  const user = await loginUser(await readJsonBody(req))
  if (env.authRequireMfaForPrivileged && ['owner', 'platform_super_admin'].includes(String(user.role || user.platformRole || '')) && await isUserMfaEnabled(user.id)) {
    const challenge = await createMfaChallenge(user.id)
    return sendJson(res, 202, { mfaRequired: true, challengeToken: challenge.token })
  }
  const deletionCancelled = await cancelTenantDeletionOnLogin(user, req)
  const session = await createSession(user, undefined, sessionMetadata(req))
  return sendAuth(res, 200, user, session, { deletionCancelled })
}

export const handleGoogleLogin = async (req, res) => {
  const body = await readJsonBody(req)
  const profile = await verifyGoogleCredential(body.credential)
  try {
    const result = await loginOrRegisterGoogleUser({ ...profile, company: body.company, document: body.document })
    const user = result.user || result
    const deletionCancelled = await cancelTenantDeletionOnLogin(user, req)
    const session = await createSession(user, undefined, sessionMetadata(req))
    return sendAuth(res, 200, user, session, { deletionCancelled, requiresCompanyProfile: Boolean(result.requiresCompanyProfile) })
  } catch (error) {
    if (error?.code === 'GOOGLE_SIGNUP_REQUIRED') return sendJson(res, 409, { error: error.message, googleSignupRequired: true, profile: error.profile })
    throw error
  }
}

export const handleMfaSetup = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  if (!['owner', 'platform_super_admin'].includes(String(user.role || user.platformRole || ''))) return sendJson(res, 403, { error: 'MFA disponivel apenas para perfis privilegiados.' })
  const setup = createMfaSetup(user.email)
  return sendJson(res, 200, { secret: setup.secret, otpauthUri: otpauthUri(setup.secret, setup.email) })
}

export const handleMfaStatus = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  return sendJson(res, 200, { enabled: await isUserMfaEnabled(user.id) })
}

export const handleMfaEnable = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  if (!['owner', 'platform_super_admin'].includes(String(user.role || user.platformRole || ''))) return sendJson(res, 403, { error: 'MFA disponivel apenas para perfis privilegiados.' })
  const body = await readJsonBody(req)
  await enableUserMfa(user.id, String(body.secret || ''), String(body.code || ''))
  return sendJson(res, 200, { status: 'enabled' })
}

export const handleMfaDisable = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  if (!['owner', 'platform_super_admin'].includes(String(user.role || user.platformRole || ''))) return sendJson(res, 403, { error: 'MFA disponivel apenas para perfis privilegiados.' })
  const body = await readJsonBody(req)
  if (!await verifyUserCurrentPassword(user.id, body.currentPassword)) return sendJson(res, 400, { error: 'Senha atual invalida.' })
  await disableUserMfa(user.id)
  return sendJson(res, 200, { status: 'disabled' })
}

export const handleMfaLogin = async (req, res) => {
  const body = await readJsonBody(req)
  const userId = await consumeMfaChallenge(body.challengeToken)
  if (!await verifyUserMfa(userId, body.code)) return sendJson(res, 400, { error: 'Codigo MFA invalido.' })
  const user = await findActiveUserById(userId)
  if (!user) return sendJson(res, 400, { error: 'Sessao MFA invalida.' })
  const session = await createSession(user, undefined, sessionMetadata(req))
  return sendAuth(res, 200, user, session)
}

export const handleEmailVerification = async (req, res) => {
  const body = await readJsonBody(req)
  const userId = await consumeAuthEmailToken(body.token, 'verify_email')
  await markEmailVerified(userId)
  return sendJson(res, 200, { status: 'verified' })
}

export const handlePasswordResetRequest = async (req, res) => {
  const body = await readJsonBody(req)
  const user = await findActiveUserByEmail(body.email)
  if (user && isEmailDeliveryConfigured()) {
    const { token } = await createAuthEmailToken(user.id, 'reset_password')
    await sendAuthEmail({ email: user.email, subject: 'Redefinicao de senha do Filamind', text: `Redefina sua senha em ate 15 minutos: ${env.appPublicUrl}/redefinir-senha?token=${encodeURIComponent(token)}` })
  }
  return sendJson(res, 202, { message: 'Se o e-mail estiver cadastrado, voce recebera as instrucoes.' })
}

export const handlePasswordResetConfirm = async (req, res) => {
  const body = await readJsonBody(req)
  const userId = await consumeAuthEmailToken(body.token, 'reset_password')
  await resetUserPassword(userId, body.newPassword)
  return sendJson(res, 200, { status: 'password_reset' })
}

export const handlePasswordChangeCodeRequest = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  if (!isEmailDeliveryConfigured()) return sendJson(res, 503, { error: 'O envio de codigo por e-mail ainda nao esta configurado.' })
  const body = await readJsonBody(req)
  if (!await verifyUserCurrentPassword(user.id, body.currentPassword)) return sendJson(res, 400, { error: 'Senha atual invalida.' })
  const { code } = await createAuthEmailCode(user.id, 'change_password_email')
  await sendAuthEmail({
    email: user.email,
    subject: 'Codigo para alterar sua senha no Filamind',
    text: `Seu codigo para alterar a senha e ${code}. Ele expira em 10 minutos. Se voce nao solicitou esta alteracao, ignore esta mensagem.`
  })
  return sendJson(res, 202, { status: 'code_sent' })
}

export const handlePasswordChangeConfirm = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Sessao invalida ou expirada' })
  const body = await readJsonBody(req)
  if (!await verifyUserCurrentPassword(user.id, body.currentPassword)) return sendJson(res, 400, { error: 'Senha atual invalida.' })
  await consumeAuthEmailCode(user.id, 'change_password_email', body.code)
  const updatedUser = await changeUserPassword(user, body)
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
