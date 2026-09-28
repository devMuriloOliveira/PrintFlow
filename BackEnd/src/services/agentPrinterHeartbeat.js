const MAX_PRINTERS_PER_HEARTBEAT = 100

const safeText = (value, maxLength) =>
  String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength)

const safeLastStatus = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const serialized = JSON.stringify(value)
  if (serialized.length > 16_000) return null
  return value
}

export const normalizeAgentPrinterHeartbeat = value => {
  if (!Array.isArray(value)) return null

  const unique = new Map()
  for (const item of value.slice(0, MAX_PRINTERS_PER_HEARTBEAT)) {
    const connectionKey = safeText(item?.connectionKey, 256)
    if (!connectionKey) continue
    unique.set(connectionKey, {
      connectionKey,
      status: item?.status === 'connected' ? 'connected' : 'disconnected',
      lastError: safeText(item?.lastError, 500),
      lastStatus: safeLastStatus(item?.lastStatus)
    })
  }

  return Array.from(unique.values())
}

export const syncAgentPrinterHeartbeat = async ({
  client,
  tenantId,
  agentId,
  printers
}) => {
  const normalized = normalizeAgentPrinterHeartbeat(printers)
  if (normalized === null) return { skipped: true, updated: 0 }

  const connectedKeys = normalized
    .filter(item => item.status === 'connected')
    .map(item => item.connectionKey)

  await client.query(
    `update agent_printers
        set status = 'disconnected',
            disconnected_at = coalesce(disconnected_at, now()),
            updated_at = now()
      where tenant_id = $1
        and agent_id = $2
        and status <> 'disconnected'
        and not (connection_key = any($3::text[]))`,
    [tenantId, agentId, connectedKeys]
  )

  let updated = 0
  for (const printer of normalized) {
    const result = await client.query(
      `update agent_printers
          set status = $1,
              last_error = $2,
              last_connection_error = $2,
              last_status = case
                when $3::jsonb is not null then $3::jsonb
                else last_status
              end,
              last_seen_at = case
                when $1 = 'connected' then now()
                else last_seen_at
              end,
              disconnected_at = case
                when $1 = 'connected' then null
                else coalesce(disconnected_at, now())
              end,
              updated_at = now()
        where tenant_id = $4
          and agent_id = $5
          and connection_key = $6`,
      [
        printer.status,
        printer.lastError,
        printer.lastStatus ? JSON.stringify(printer.lastStatus) : null,
        tenantId,
        agentId,
        printer.connectionKey
      ]
    )
    updated += Number(result.rowCount || 0)
  }

  return { skipped: false, updated }
}
