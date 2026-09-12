import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson, sendText } from '../http/response.js'
import { hasDatabase, withTenant } from '../db/pool.js'
import { encryptField } from '../security/crypto.js'
import { validCompanyDocument } from '../services/companyDocument.js'
import { lookupCompanyByCnpj } from '../services/companyLookup.js'
import { loadAppData } from '../repositories/appDataRepository.js'
import { writeAuditEvent } from '../services/operationalEvents.js'

const text = (value, max = 300) => String(value || '').trim().slice(0, max)
const hexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim())
  ? String(value).trim().toLowerCase()
  : '#1768f2'
const settingsFields = ['name', 'document', 'phone', 'email', 'address', 'district', 'city', 'state', 'zip', 'country', 'currency', 'timezone']
const encryptedFields = new Set(['name', 'document', 'phone', 'email', 'address', 'district', 'city', 'state', 'zip'])
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`

export const formatTenantDataCsv = (data = {}) => {
  const rows = [['Colecao', 'Registro', 'Campo', 'Valor']]
  for (const [collection, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      value.forEach((record, index) => {
        for (const [field, fieldValue] of Object.entries(record && typeof record === 'object' ? record : { value: record })) {
          rows.push([collection, index + 1, field, typeof fieldValue === 'object' && fieldValue !== null ? JSON.stringify(fieldValue) : fieldValue])
        }
      })
    } else if (value && typeof value === 'object') {
      for (const [field, fieldValue] of Object.entries(value)) rows.push([collection, 1, field, typeof fieldValue === 'object' && fieldValue !== null ? JSON.stringify(fieldValue) : fieldValue])
    } else if (value !== null && value !== undefined) {
      rows.push([collection, 1, 'value', value])
    }
  }
  return `\ufeff${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}

export const tenantExportGroups = Object.freeze({
  company: ['settings'],
  customers: ['clients', 'orders'],
  catalog: ['products', 'filaments'],
  production: ['printers', 'printJobs'],
  financial: ['expenses', 'expenseSegments', 'goals'],
  marketplaces: ['marketplaces', 'marketplaceIntegrations']
})

const allTenantExportResources = Object.freeze([...new Set(Object.values(tenantExportGroups).flat())])

export const selectTenantExportResources = (groups = '') => {
  const requested = String(groups || '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!requested.length || requested.includes('all')) return { groups: ['all'], resources: new Set(allTenantExportResources) }
  const selectedGroups = [...new Set(requested.filter((group) => Object.hasOwn(tenantExportGroups, group)))]
  return { groups: selectedGroups, resources: new Set(selectedGroups.flatMap((group) => tenantExportGroups[group])) }
}

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
    const incomingDocument = values.document ? validCompanyDocument(values.document) : null
    if (values.document && !incomingDocument) throw new Error('Informe um CPF ou CNPJ valido.')
    const current = await client.query(`select tenant.document, tenant.document_hash, tenant.document_type, settings.document as settings_document from tenants tenant left join company_settings settings on settings.tenant_id = tenant.id where tenant.id = $1 limit 1`, [user.tenantId])
    const stored = current.rows[0] || {}
    const storedIdentity = stored.document_hash ? { hash: stored.document_hash, type: stored.document_type || '' } : validCompanyDocument(stored.document || stored.settings_document || '')
    if (storedIdentity?.hash && (!incomingDocument || incomingDocument.hash !== storedIdentity.hash)) throw new Error('O documento cadastrado nao pode ser alterado por esta tela. Solicite a troca para CNPJ ao suporte.')
    const documentIdentity = incomingDocument || storedIdentity
    // company_settings is the tenant's complete profile. Keep the small profile
    // duplicated in tenants in sync because the platform administration only
    // reads that central, minimised record (name, document and contact).
    await client.query(`
      insert into tenants (id, name, document, document_hash, document_type, document_locked_at, email, phone)
      values ($1, $2, $3, $4, $5, case when $4 <> '' then now() else null end, $6, $7)
      on conflict (id) do update set
        name = excluded.name,
        document = excluded.document,
        document_hash = coalesce(tenants.document_hash, excluded.document_hash),
        document_type = coalesce(tenants.document_type, excluded.document_type),
        document_locked_at = coalesce(tenants.document_locked_at, excluded.document_locked_at),
        email = excluded.email,
        phone = excluded.phone
    `, [
      user.tenantId,
      encryptField(values.name || user.tenantId),
      encryptField(values.document),
      documentIdentity?.hash || '',
      documentIdentity?.type || null,
      encryptField(values.email),
      encryptField(values.phone)
    ])
    const columns = [...settingsFields, 'kwh', 'preferences']
    const data = columns.map((field) => encryptedFields.has(field) ? encryptField(values[field]) : field === 'preferences' ? JSON.stringify(values[field]) : values[field])
    const assignments = columns.map((field, index) => `${field} = excluded.${field}`).join(', ')
    await client.query(`insert into company_settings (tenant_id, ${columns.join(', ')}) values ($1, ${columns.map((_, index) => `$${index + 2}`).join(', ')}) on conflict (tenant_id) do update set ${assignments}, updated_at = now()`, [user.tenantId, ...data])
    await writeAuditEvent(user.tenantId, { action: 'settings.updated', actorType: 'user', actorId: user.id, entityType: 'company_settings', entityId: user.tenantId, details: { changedFields: ['settings'] } }, client)
  })
  return sendJson(res, 200, (await loadAppData(user.tenantId)).settings)
}

export const handleCompanyCnpjLookup = async (req, res, url) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  try {
    const company = await lookupCompanyByCnpj(url.searchParams.get('cnpj'))
    return sendJson(res, 200, company, { 'Cache-Control': 'no-store' })
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 503), { error: error?.message || 'Nao foi possivel consultar o CNPJ.' }, { 'Cache-Control': 'no-store' })
  }
}

export const backupStatus = () => ({
  databaseAvailable: hasDatabase,
  export: {
    enabled: hasDatabase,
    format: 'csv',
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

export const handleSettingsExport = async (req, res, url = new URL(req.url, 'http://localhost')) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Exportacao exige banco de dados.' })
  const requestedGroups = url.searchParams.get('groups') || ''
  const selection = selectTenantExportResources(requestedGroups)
  if (requestedGroups && !selection.groups.length) return sendJson(res, 400, { error: 'Selecione pelo menos um grupo de dados valido.' })
  const loadedData = await loadAppData(user.tenantId, selection.resources)
  const data = Object.fromEntries([...selection.resources].map((resource) => [resource, loadedData[resource]]))
  const recordCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0]))
  const recordCount = Object.values(recordCounts).reduce((total, value) => total + value, 0)
  const fileName = `printflow-dados-${new Date().toISOString().slice(0, 10)}.csv`
  await withTenant(user.tenantId, async (client) => {
    await client.query('insert into export_history (tenant_id, file_name, export_type, file_format, record_count) values ($1, $2, $3, $4, $5)', [user.tenantId, fileName, 'tenant_data', 'csv', recordCount])
    await writeAuditEvent(user.tenantId, { action: 'settings.data_exported', actorType: 'user', actorId: user.id, entityType: 'export', entityId: fileName, details: { format: 'csv', groups: selection.groups, recordCounts } }, client)
  })
  return sendText(res, 200, formatTenantDataCsv(data), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store'
  })
}

export const handleSettingsExportHistory = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Historico exige banco de dados.' })
  const rows = await withTenant(user.tenantId, (client) => client.query(`select id, file_name, export_type, file_format, record_count, status, created_at from export_history where tenant_id = $1 order by created_at desc limit 20`, [user.tenantId]))
  return sendJson(res, 200, rows.rows.map((row) => ({ id: String(row.id), fileName: row.file_name, type: row.export_type, format: row.file_format, recordCount: Number(row.record_count), status: row.status, createdAt: row.created_at })))
}
