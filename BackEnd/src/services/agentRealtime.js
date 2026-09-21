const listeners =
  new Map()

const sockets =
  new Map()

const keyFor = (
  agentId
) =>
  String(
    agentId
  )

export const subscribeAgentEvents = (
  agent,
  req,
  res
) => {
  const key =
    keyFor(
      agent.id
    )

  const listener = (
    event
  ) =>
    res.write(
      `event: command\ndata: ${JSON.stringify(event)}\n\n`
    )

  const entries =
    listeners.get(key) ||
    new Set()

  entries.add(listener)
  listeners.set(key, entries)

  res.writeHead(200, {
    'Content-Type':
      'text/event-stream; charset=utf-8',
    'Cache-Control':
      'no-store, no-cache',
    Connection:
      'keep-alive',
    'X-Accel-Buffering':
      'no',
    ...res.corsHeaders
  })

  res.write(
    'retry: 3000\nevent: ready\ndata: {}\n\n'
  )

  const heartbeat =
    setInterval(
      () =>
        res.write(
          ': keep-alive\n\n'
        ),
      25_000
    )

  const close = () => {
    clearInterval(heartbeat)
    entries.delete(listener)

    if (!entries.size) {
      listeners.delete(key)
    }
  }

  req.once('close', close)
  res.once('close', close)
}

export const subscribeAgentWebSocket = (
  agent,
  socket
) => {
  const key = keyFor(agent.id)
  const entries = sockets.get(key) || new Set()
  entries.add(socket)
  sockets.set(key, entries)

  const close = () => {
    entries.delete(socket)
    if (!entries.size) sockets.delete(key)
  }

  socket.once('close', close)
  socket.once('error', close)
  socket.send(JSON.stringify({ type: 'ready' }))
}

export const publishAgentCommandAvailable = (
  {
    agentId
  }
) => {
  const entries =
    listeners.get(
      keyFor(agentId)
    )

  const event = {
    type:
      'command_available'
  }

  if (entries) {
    for (
      const listener
      of entries
    ) {
      listener(event)
    }
  }

  const websocketEntries = sockets.get(keyFor(agentId))
  if (!websocketEntries) return

  for (const socket of websocketEntries) {
    if (socket.readyState === 1) socket.send(JSON.stringify(event))
  }
}
