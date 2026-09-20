const wait = (
  delay
) =>
  new Promise(
    resolve =>
      setTimeout(
        resolve,
        delay
      )
  )

const parseEvent = (
  block
) => {
  const lines =
    block.split('\n')

  let type =
    'message'

  const data = []

  for (
    const line
    of lines
  ) {
    if (
      line.startsWith(
        'event:'
      )
    ) {
      type =
        line.slice(6)
          .trim()
      continue
    }

    if (
      line.startsWith(
        'data:'
      )
    ) {
      data.push(
        line.slice(5)
          .trim()
      )
    }
  }

  if (!data.length) {
    return null
  }

  try {
    return {
      type,
      data:
        JSON.parse(
          data.join('\n')
        )
    }
  } catch {
    return null
  }
}

export const consumeCommandEvents = async (
  {
    stream,
    onEvent
  }
) => {
  const reader =
    stream.getReader()

  const decoder =
    new TextDecoder()

  let buffer =
    ''

  while (true) {
    const next =
      await reader.read()

    if (next.done) {
      return
    }

    buffer +=
      decoder.decode(
        next.value,
        {
          stream: true
        }
      )
        .replace(/\r\n/g, '\n')

    let separator =
      buffer.indexOf('\n\n')

    while (separator >= 0) {
      const event =
        parseEvent(
          buffer.slice(
            0,
            separator
          )
        )

      buffer =
        buffer.slice(
          separator + 2
        )

      if (event) {
        await onEvent(event)
      }

      separator =
        buffer.indexOf('\n\n')
    }
  }
}

export const startCommandEvents = (
  {
    apiUrl,
    credentials,
    onCommandAvailable,
    onError = () => {},
    fetchImpl = fetch
  }
) => {
  let stopped =
    false

  let controller =
    null

  let reconnectDelay =
    1_000

  const run = async () => {
    while (!stopped) {
      try {
        controller =
          new AbortController()

        const response =
          await fetchImpl(
            `${apiUrl}/api/agents/events`,
            {
              headers: {
                'x-agent-id':
                  credentials.agentId,
                'x-agent-secret':
                  credentials.agentSecret,
                Accept:
                  'text/event-stream'
              },
              signal:
                controller.signal
            }
          )

        if (!response.ok || !response.body) {
          throw new Error(
            `Eventos do Agent indisponiveis (${response.status}).`
          )
        }

        reconnectDelay =
          1_000

        await consumeCommandEvents({
          stream:
            response.body,
          onEvent: async (
            event
          ) => {
            if (
              event.type ===
                'command' &&
              event.data?.type ===
                'command_available'
            ) {
              await onCommandAvailable()
            }
          }
        })
      } catch (error) {
        if (!stopped) {
          onError(error)
        }
      } finally {
        controller =
          null
      }

      if (!stopped) {
        await wait(
          reconnectDelay +
          Math.round(
            Math.random() *
            250
          )
        )

        reconnectDelay =
          Math.min(
            reconnectDelay * 2,
            30_000
          )
      }
    }
  }

  void run()

  return () => {
    stopped = true
    controller?.abort()
  }
}
