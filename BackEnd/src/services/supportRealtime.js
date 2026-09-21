const listeners = new Map()

const keyFor = (tenantId, userId) => `${String(tenantId)}:${String(userId)}`

export const subscribeTenantSupportEvents = (user, req, res) => {
  const key = keyFor(user.tenantId, user.id)
  const listener = (event) => res.write(`event: support\ndata: ${JSON.stringify(event)}\n\n`)
  const entries = listeners.get(key) || new Set()
  entries.add(listener)
  listeners.set(key, entries)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...res.corsHeaders
  })
  res.write('retry: 3000\nevent: ready\ndata: {}\n\n')
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000)
  const close = () => {
    clearInterval(heartbeat)
    entries.delete(listener)
    if (!entries.size) listeners.delete(key)
  }
  req.once('close', close)
  res.once('close', close)
}

export const publishTenantSupportEvent = ({ tenantId, requesterId, requestId, type }) => {
  const entries = listeners.get(keyFor(tenantId, requesterId))
  if (!entries) return
  const event = { type, requestId: String(requestId) }
  for (const listener of entries) listener(event)
}
