import { createOpaqueId } from '../auth/token.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { hasDatabase, query } from '../db/pool.js'
import { blindIndex, blindIndexesForLookup, decryptField, encryptField } from '../security/crypto.js'

const memoryUsers = new Map()

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()

const publicUser = (row) => ({
  id: String(row.id),
  tenantId: row.tenant_id,
  name: decryptField(row.name),
  email: decryptField(row.email),
  role: row.role,
  status: row.status
})

export const registerUser = async ({ name, email, password, company }) => {
  const normalizedEmail = normalizeEmail(email)
  const cleanName = String(name || '').trim()
  const companyName = String(company || cleanName || 'PrintFlow 3D').trim()

  if (!cleanName) throw new Error('Informe o nome.')
  if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail valido.')
  if (String(password || '').length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.')

  const tenantId = createOpaqueId('tenant')
  const passwordHash = hashPassword(password)
  const emailHash = blindIndex(normalizedEmail)

  if (!hasDatabase) {
    if (memoryUsers.has(normalizedEmail)) throw new Error('Este e-mail ja esta cadastrado.')
    const user = { id: createOpaqueId('user'), tenant_id: tenantId, name: cleanName, email: normalizedEmail, password_hash: passwordHash, role: 'admin', status: 'active' }
    memoryUsers.set(normalizedEmail, user)
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
    `insert into users (tenant_id, name, email, email_hash, password_hash, role, status)
     values ($1, $2, $3, $4, $5, 'admin', 'active')
     returning id, tenant_id, name, email, role, status`,
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
    `select id, tenant_id, name, email, email_hash, password_hash, role, status
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
