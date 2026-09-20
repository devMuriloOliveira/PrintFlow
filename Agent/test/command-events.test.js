import assert from 'node:assert/strict'
import test from 'node:test'

import {
  consumeCommandEvents
} from '../src/cloud/commandEvents.js'

test(
  'consome somente sinal de comando SSE completo',
  async () => {
    const encoder =
      new TextEncoder()

    const stream =
      new ReadableStream({
        start(
          controller
        ) {
          controller.enqueue(
            encoder.encode(
              'event: ready\ndata: {}\n\n'
            )
          )
          controller.enqueue(
            encoder.encode(
              'event: command\ndata: {"type":"command_'
            )
          )
          controller.enqueue(
            encoder.encode(
              'available"}\n\n'
            )
          )
          controller.close()
        }
      })

    const events = []

    await consumeCommandEvents({
      stream,
      onEvent: async (
        event
      ) => {
        events.push(event)
      }
    })

    assert.deepEqual(
      events,
      [
        {
          type: 'ready',
          data: {}
        },
        {
          type: 'command',
          data: {
            type:
              'command_available'
          }
        }
      ]
    )
  }
)
