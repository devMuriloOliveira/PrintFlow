import assert from 'node:assert/strict'
import test from 'node:test'

import { createDiscoveryProgressReporter } from '../src/cloud/discoveryProgress.js'

test('progresso de discovery agrega candidatos, deduplica e limita dados sensiveis', async () => {
  const sent = []
  const reporter = createDiscoveryProgressReporter({ publish: async progress => sent.push(progress), debounceMs: 10_000 })
  reporter.add({ protocol: 'bambu', connectionType: 'network', ip: '192.168.1.25', serial: 'SERIAL-1', name: 'Bambu', accessCode: 'must-not-ship' })
  reporter.add({ protocol: 'bambu', connectionType: 'network', ip: '192.168.1.25', serial: 'SERIAL-1', name: 'Bambu' })
  reporter.add({ protocol: 'moonraker', connectionType: 'network', ip: '192.168.1.26', port: 7125, token: 'must-not-ship' })

  await reporter.flush()
  reporter.stop()

  assert.equal(sent.length, 1)
  assert.equal(sent[0].discoveredCount, 2)
  assert.equal(sent[0].printers.length, 2)
  assert.doesNotMatch(JSON.stringify(sent), /must-not-ship/)
})
