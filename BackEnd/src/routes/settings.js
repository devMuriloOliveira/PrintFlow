import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { hasDatabase, withTenant } from '../db/pool.js'
import { encryptField } from '../security/crypto.js'
import { loadAppData } from '../repositories/appDataRepository.js'
import { writeAuditEvent } from '../services/operationalEvents.js'

const text = (value, max = 300) => String(value || '').trim().slice(0, max)
const hexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim())
  ? String(value).trim().toLowerCase()
  : '#1768f2'
const settingsFields = ['name', 'document', 'phone', 'email', 'address', 'district', 'city', 'state', 'zip', 'country', 'currency', 'timezone']
const encryptedFields = new Set(['name', 'document', 'phone', 'email', 'address', 'district', 'city', 'state', 'zip'])

export const normalizedSettings = (payload = {}) => {
  const result = {}
  for (const field of settingsFields) result[field] = text(payload[field], field === 'address' ? 500 : 160)
  result.country = result.country || 'Brasil'
  result.currency = result.currency || 'Real (R$)'
  result.timezone = result.timezone || '(GMT-03:00) Brasilia'
  result.kwh = Math.max(0, Math.min(1000, Number(payload.kwh || 0)))
  const preferences = payload.preferences && typeof payload.preferences === 'object' ? payload.preferences : {}
  result.preferences = {
    emailAlerts: preferences.emailAlerts !== false,
    productionAlerts: preferences.productionAlerts !== false,
    marketplaceAlerts: preferences.marketplaceAlerts !== false,
    dailySummary: preferences.dailySummary === true,
    compactLayout: preferences.compactLayout === true,
    logoUrl: /^https:\/\//i.test(String(preferences.logoUrl || '').trim()) ? String(preferences.logoUrl).trim().slice(0, 1000) : '',
    brandName: text(preferences.brandName, 60),
    accentColor: hexColor(preferences.accentColor),
    defaultMargin: Math.max(0, Math.min(1000, Number(preferences.defaultMargin ?? 40))),
    monthlyFixedCost: Math.max(0, Math.min(1_000_000, Number(preferences.monthlyFixedCost || 0))),
    plannedMonthlyUnits: Math.max(0, Math.min(1_000_000, Math.floor(Number(preferences.plannedMonthlyUnits || 0))))
  }
  return result
}

export const handleSettingsUpdate = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Configuracoes exigem banco de dados.' })

  const values = normalizedSettings(await readJsonBody(req))
  await withTenant(user.tenantId, async (client) => {
    await client.query('insert into tenants (id, name) values ($1, $2) on conflict (id) do nothing', [user.tenantId, values.name || user.tenantId])
    const columns = [...settingsFields, 'kwh', 'preferences']
    const data = columns.map((field) => encryptedFields.has(field) ? encryptField(values[field]) : field === 'preferences' ? JSON.stringify(values[field]) : values[field])
    const assignments = columns.map((field, index) => `${field} = excluded.${field}`).join(', ')
    await client.query(`insert into company_settings (tenant_id, ${columns.join(', ')}) values ($1, ${columns.map((_, index) => `$${index + 2}`).join(', ')}) on conflict (tenant_id) do update set ${assignments}, updated_at = now()`, [user.tenantId, ...data])
    await writeAuditEvent(user.tenantId, { action: 'settings.updated', actorType: 'user', actorId: user.id, entityType: 'company_settings', entityId: user.tenantId, details: { changedFields: ['settings'] } }, client)
  })
  return sendJson(res, 200, (await loadAppData(user.tenantId)).settings)
}

export const backupStatus = () => ({
  databaseAvailable: hasDatabase,
  export: {
    enabled: hasDatabase,
    format: 'json',
    excludes: ['tokens de integracoes', 'credenciais', 'sessoes de autenticacao']
  },
  restore: {
    enabled: false,
    reason: 'A restauracao exige validacao e confirmacao explicita para evitar sobrescrita de dados.'
  }
})

export const handleSettingsBackupStatus = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  return sendJson(res, 200, backupStatus())
}

export const handleSettingsExport = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Exportacao exige banco de dados.' })
  const data = await loadAppData(user.tenantId)
  const recordCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0]))
  const recordCount = Object.values(recordCounts).reduce((total, value) => total + value, 0)
  const fileName = `printflow-dados-${new Date().toISOString().slice(0, 10)}.json`
  await withTenant(user.tenantId, async (client) => {
    await client.query('insert into export_history (tenant_id, file_name, export_type, file_format, record_count) values ($1, $2, $3, $4, $5)', [user.tenantId, fileName, 'tenant_data', 'json', recordCount])
    await writeAuditEvent(user.tenantId, { action: 'settings.data_exported', actorType: 'user', actorId: user.id, entityType: 'export', entityId: fileName, details: { recordCounts } }, client)
  })
  return sendJson(res, 200, { fileName, exportedAt: new Date().toISOString(), recordCounts, data }, { 'Content-Disposition': `attachment; filename="${fileName}"` })
}

export const handleSettingsExportHistory = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Historico exige banco de dados.' })
  const rows = await withTenant(user.tenantId, (client) => client.query(`select id, file_name, export_type, file_format, record_count, status, created_at from export_history where tenant_id = $1 order by created_at desc limit 20`, [user.tenantId]))
  return sendJson(res, 200, rows.rows.map((row) => ({ id: String(row.id), fileName: row.file_name, type: row.export_type, format: row.file_format, recordCount: Number(row.record_count), status: row.status, createdAt: row.created_at })))
}
