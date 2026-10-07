import test from 'node:test'
import assert from 'node:assert/strict'
import { instrumentClient } from '../src/db/pool.js'

const createClient = ({ failOn } = {}) => {
  const calls = []
  let activeQueries = 0
  let maxActiveQueries = 0
  const client = {
    async query(text) {
      calls.push(`start:${text}`)
      activeQueries += 1
      maxActiveQueries = Math.max(maxActiveQueries, activeQueries)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeQueries -= 1
      calls.push(`finish:${text}`)
      if (text === failOn) throw new Error(`failed:${text}`)
      return { rows: [] }
    }
  }
  return { client, calls, get maxActiveQueries() { return maxActiveQueries } }
}

test('serializa consultas concorrentes no mesmo cliente', async () => {
  const fake = createClient()
  const client = instrumentClient(fake.client)

  await Promise.all([client.query('first'), client.query('second'), client.query('third')])

  assert.equal(fake.maxActiveQueries, 1)
  assert.deepEqual(fake.calls.filter((call) => call.startsWith('start:')), [
    'start:first', 'start:second', 'start:third'
  ])
})

test('continua a fila depois de uma consulta falhar', async () => {
  const fake = createClient({ failOn: 'fails' })
  const client = instrumentClient(fake.client)

  await assert.rejects(Promise.all([
    client.query('first'), client.query('fails'), client.query('last')
  ]), /failed:fails/)
  await client.flushQueries()

  assert.equal(fake.maxActiveQueries, 1)
  assert.deepEqual(fake.calls.filter((call) => call.startsWith('start:')), [
    'start:first', 'start:fails', 'start:last'
  ])
})
