import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import { query, withTenant } from '../db/pool.js'
import { writeAuditEvent } from './operationalEvents.js'

const allowedMimeTypes = new Set(['application/pdf', 'text/plain', 'text/csv', 'image/png', 'image/jpeg'])
const cleanName = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 120) || 'anexo'
const attachmentRow = (row) => ({ id: String(row.id), tenantId: row.tenant_id || undefined, requestId: row.request_id, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), expiresAt: row.expires_at, createdAt: row.created_at })
const decodePayload = (payload = {}) => {
  const mimeType = String(payload.mimeType || '').toLowerCase()
  if (!allowedMimeTypes.has(mimeType)) throw new Error('Tipo de anexo nao permitido.')
  const raw = String(payload.data || '').replace(/^data:[^;]+;base64,/, '')
  if (!raw || !/^[a-z0-9+/]+=*$/i.test(raw)) throw new Error('Conteudo do anexo invalido.')
  const buffer = Buffer.from(raw, 'base64')
  if (!buffer.length || buffer.length > env.supportAttachmentMaxBytes) throw new Error('Anexo excede o tamanho permitido.')
  return { mimeType, buffer, fileName: cleanName(payload.fileName) }
}
const writeAttachmentFile = async (tenantId, requestId, payload) => {
  const { mimeType, buffer, fileName } = decodePayload(payload)
  const id = `attachment_${randomBytes(16).toString('hex')}`
  const storageKey = `${tenantId}/${requestId}/${id}-${fileName}`
  const filePath = path.resolve(env.supportAttachmentStorageDir, storageKey)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, buffer, { flag: 'wx' })
  return { id, storageKey, filePath, mimeType, buffer, fileName }
}

const authorizedRequest = async (user, requestId) => {
  const result = await query(`
    select id, tenant_id from tenant_audit_requests request
     where id = $1 and request_kind = 'support'
       and (request.chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators c where c.request_id = request.id and c.user_id = $2))
     limit 1
  `, [requestId, String(user.id)])
  if (!result.rowCount) throw new Error('Somente o responsavel ou colaborador pode acessar anexos deste suporte.')
  return result.rows[0]
}

export const addPlatformSupportAttachment = async (user, requestId, payload = {}) => {
  const request = await authorizedRequest(user, requestId)
  const stored = await writeAttachmentFile(request.tenant_id, request.id, payload)
  try {
    const result = await query(`
      insert into tenant_audit_request_attachments (id, tenant_id, request_id, uploader_type, uploader_id, original_name, storage_key, mime_type, size_bytes, expires_at)
      values ($1, $2, $3, 'superadmin', $4, $5, $6, $7, $8, now() + ($9::int * interval '1 day')) returning id, tenant_id, request_id, original_name, mime_type, size_bytes, expires_at, created_at
    `, [stored.id, request.tenant_id, request.id, String(user.id), stored.fileName, stored.storageKey, stored.mimeType, stored.buffer.length, env.supportAttachmentRetentionDays])
    return attachmentRow(result.rows[0])
  } catch (error) {
    await rm(stored.filePath, { force: true })
    throw error
  }
}

const tenantRequest = (client, user, requestId, writable = false) => client.query(`select id, tenant_id from tenant_audit_requests where id = $1 and tenant_id = $2 and requested_by::text = $3 and request_kind = 'support' ${writable ? "and status not in ('closed', 'cancelled', 'expired') and support_status <> 'resolved'" : ''} limit 1`, [requestId, user.tenantId, String(user.id)])

export const addTenantSupportAttachment = async (user, requestId, payload = {}) => {
  const stored = await writeAttachmentFile(user.tenantId, requestId, payload)
  try {
    return await withTenant(user.tenantId, async (client) => {
      const requestResult = await tenantRequest(client, user, requestId, true)
      if (!requestResult.rowCount) throw new Error('Solicitacao indisponivel.')
      const row = (await client.query(`insert into tenant_audit_request_attachments (id, tenant_id, request_id, uploader_type, uploader_id, original_name, storage_key, mime_type, size_bytes, expires_at) values ($1, $2, $3, 'requester', $4, $5, $6, $7, $8, now() + ($9::int * interval '1 day')) returning id, tenant_id, request_id, original_name, mime_type, size_bytes, expires_at, created_at`, [stored.id, user.tenantId, requestId, String(user.id), stored.fileName, stored.storageKey, stored.mimeType, stored.buffer.length, env.supportAttachmentRetentionDays])).rows[0]
      await writeAuditEvent(user.tenantId, { action: 'support.request.attachment_added', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: requestId, details: { attachmentId: stored.id, mimeType: stored.mimeType, sizeBytes: stored.buffer.length } }, client)
      return attachmentRow(row)
    })
  } catch (error) {
    await rm(stored.filePath, { force: true })
    throw error
  }
}

export const listTenantSupportAttachments = async (user, requestId) => withTenant(user.tenantId, async (client) => {
  const requestResult = await tenantRequest(client, user, requestId)
  if (!requestResult.rowCount) throw new Error('Solicitacao indisponivel.')
  const result = await client.query(`select id, tenant_id, request_id, original_name, mime_type, size_bytes, expires_at, created_at from tenant_audit_request_attachments where request_id = $1 and tenant_id = $2 and deleted_at is null and expires_at > now() order by created_at asc`, [requestId, user.tenantId])
  return result.rows.map(attachmentRow)
})

export const readTenantSupportAttachment = async (user, requestId, attachmentId) => withTenant(user.tenantId, async (client) => {
  const requestResult = await tenantRequest(client, user, requestId)
  if (!requestResult.rowCount) throw new Error('Solicitacao indisponivel.')
  const result = await client.query(`select original_name, storage_key, mime_type, expires_at from tenant_audit_request_attachments where id = $1 and request_id = $2 and tenant_id = $3 and deleted_at is null and expires_at > now() limit 1`, [attachmentId, requestId, user.tenantId])
  if (!result.rowCount) throw new Error('Anexo nao encontrado ou expirado.')
  const row = result.rows[0]
  const root = path.resolve(env.supportAttachmentStorageDir)
  const filePath = path.resolve(root, row.storage_key)
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Anexo invalido.')
  return { ...row, body: await readFile(filePath) }
})

export const listPlatformSupportAttachments = async (user, requestId) => {
  await authorizedRequest(user, requestId)
  const result = await query(`select id, tenant_id, request_id, original_name, mime_type, size_bytes, expires_at, created_at from tenant_audit_request_attachments where request_id = $1 and deleted_at is null and expires_at > now() order by created_at asc`, [requestId])
  return result.rows.map(attachmentRow)
}

export const readPlatformSupportAttachment = async (user, requestId, attachmentId) => {
  await authorizedRequest(user, requestId)
  const result = await query(`select original_name, storage_key, mime_type, expires_at from tenant_audit_request_attachments where id = $1 and request_id = $2 and deleted_at is null and expires_at > now() limit 1`, [attachmentId, requestId])
  if (!result.rowCount) throw new Error('Anexo nao encontrado ou expirado.')
  const row = result.rows[0]
  const filePath = path.resolve(env.supportAttachmentStorageDir, row.storage_key)
  const root = path.resolve(env.supportAttachmentStorageDir)
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Anexo invalido.')
  return { ...row, body: await readFile(filePath) }
}
