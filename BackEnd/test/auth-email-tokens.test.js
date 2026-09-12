import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''
process.env.AUTH_SECRET = 'auth-email-token-test-secret-32-characters'
process.env.DATA_ENCRYPTION_KEY = 'auth-email-token-data-key-32-characters'
process.env.WEBHOOK_SHARED_SECRET = 'auth-email-token-webhook-secret-32-characters'
process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com'

const { createAuthEmailToken, consumeAuthEmailToken, registerUser, resetUserPassword, loginUser } = await import('../src/repositories/authRepository.js')
const { generateMfaSecret, createTotpCode, verifyTotpCode } = await import('../src/services/mfa.js')

test('tokens de autenticacao sao de uso unico e separados por finalidade', async () => {
  const user = await registerUser({ name: 'Token Teste', email: `token-${Date.now()}@example.com`, password: 'SenhaForte1!', company: 'Empresa Token' })
  const created = await createAuthEmailToken(user.id, 'verify_email')
  assert.equal(await consumeAuthEmailToken(created.token, 'verify_email'), user.id)
  await assert.rejects(() => consumeAuthEmailToken(created.token, 'verify_email'), /Token invalido ou expirado/)
})

test('reset de senha invalida a senha anterior', async () => {
  const email = `reset-${Date.now()}@example.com`
  const user = await registerUser({ name: 'Reset Teste', email, password: 'SenhaForte1!', company: 'Empresa Reset' })
  const created = await createAuthEmailToken(user.id, 'reset_password')
  const userAfterReset = await resetUserPassword(await consumeAuthEmailToken(created.token, 'reset_password'), 'NovaSenhaForte1!')
  assert.equal(userAfterReset.id, user.id)
  await assert.rejects(() => loginUser({ email, password: 'SenhaForte1!' }), /E-mail ou senha invalidos/)
  assert.equal((await loginUser({ email, password: 'NovaSenhaForte1!' })).id, user.id)
})

test('MFA TOTP valida codigo atual e rejeita formato invalido', () => {
  const secret = generateMfaSecret()
  const timestamp = 1_725_000_000_000
  const code = createTotpCode(secret, timestamp)
  assert.equal(verifyTotpCode(secret, code, timestamp), true)
  assert.equal(verifyTotpCode(secret, 'abc123', timestamp), false)
  assert.equal(verifyTotpCode(secret, '000000', timestamp), false)
})
