import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  publishAgentCommandAvailable,
  subscribeAgentEvents
} from '../src/services/agentRealtime.js'

test(
  'evento de comando e entregue somente ao Agent inscrito',
  () => {
    const request =
      new EventEmitter()

    const response =
      new EventEmitter()

    const written = []

    response.corsHeaders = {}
    response.writeHead = () => {}
    response.write = (
      value
    ) => {
      written.push(value)
    }

    subscribeAgentEvents(
      {
        id: 'agent-a'
      },
      request,
      response
    )

    publishAgentCommandAvailable({
      agentId: 'agent-b'
    })

    assert.equal(
      written.filter(
        value =>
          value.includes(
            'event: command'
          )
      ).length,
      0
    )

    publishAgentCommandAvailable({
      agentId: 'agent-a'
    })

    assert.equal(
      written.some(
        value =>
          value.includes(
            'event: command\ndata: {"type":"command_available"}'
          )
      ),
      true
    )

    request.emit('close')
  }
)
