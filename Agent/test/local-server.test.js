import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const dataDirectory =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-local-server-'
    )
  )

process.env.PRINTFLOW_AGENT_DATA_DIR =
  dataDirectory

const {
  startLocalServer
} = await import(
  '../src/localServer.js'
)

test(
  'health local bloqueia atualizacao durante impressao monitorada',
  async t => {
    const server =
      startLocalServer({
        port: 0,
        getRuntimeStatus: () => ({
          updateBlocked: true,
          updateBlockedReason:
            'active_print',
          activePrintJobs: 2
        })
      })

    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })

    t.after(
      () =>
        new Promise(resolve =>
          server.close(resolve)
        )
    )

    const address = server.address()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/healthz`
    )
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload.updateBlocked, true)
    assert.equal(
      payload.updateBlockedReason,
      'active_print'
    )
    assert.equal(payload.activePrintJobs, 2)
  }
)
