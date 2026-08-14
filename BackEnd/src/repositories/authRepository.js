import { createOpaqueId } from '../auth/token.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { hasDatabase, query } from '../db/pool.js'

const memoryUsers = new Map()

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
const sanitizeTenant = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60)

const publicUser = (row) => ({
  id: String(row.id),
  tenantId: row.tenant_id,
  name: row.name,
  email: row.email,
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

  const tenantBase = sanitizeTenant(companyName) || 'tenant'
  const tenantId = `${tenantBase}_${createOpaqueId('ws').slice(3)}`
  const passwordHash = hashPassword(password)

  if (!hasDatabase) {
    if (memoryUsers.has(normalizedEmail)) throw new Error('Este e-mail ja esta cadastrado.')
    const user = { id: createOpaqueId('user'), tenant_id: tenantId, name: cleanName, email: normalizedEmail, password_hash: passwordHash, role: 'admin', status: 'active' }
    memoryUsers.set(normalizedEmail, user)
    return publicUser(user)
  }

  const existing = await query('select id from users where email = $1 limit 1', [normalizedEmail])
  if (existing.rowCount) throw new Error('Este e-mail ja esta cadastrado.')

  await query(
    `insert into tenants (id, name, email, is_initialized)
     values ($1, $2, $3, false)
     on conflict (id) do nothing`,
    [tenantId, companyName, normalizedEmail]
  )

  const result = await query(
    `insert into users (tenant_id, name, email, password_hash, role, status)
     values ($1, $2, $3, $4, 'admin', 'active')
     returning id, tenant_id, name, email, role, status`,
    [tenantId, cleanName, normalizedEmail, passwordHash]
  )

  return publicUser(result.rows[0])
}

export const loginUser = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password) throw new Error('Informe e-mail e senha.')

  if (!hasDatabase) {
    const user = memoryUsers.get(normalizedEmail)
    if (!user || !verifyPassword(password, user.password_hash)) throw new Error('E-mail ou senha invalidos.')
    return publicUser(user)
  }

  const result = await query(
    `select id, tenant_id, name, email, password_hash, role, status
     from users where email = $1 and status = 'active' limit 1`,
    [normalizedEmail]
  )
  const user = result.rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('E-mail ou senha invalidos.')
  return publicUser(user)
}
