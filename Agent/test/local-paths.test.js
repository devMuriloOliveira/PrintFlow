import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-paths-'
    )
  )

process.env.PRINTFLOW_AGENT_DATA_DIR =
  root

const {
  getAgentLocalPaths
} = await import(
  '../src/storage/localPaths.js'
)

test(
  'define layout local gerenciado sob o diretorio do Agent',
  () => {
    const paths =
      getAgentLocalPaths()

    assert.equal(
      paths.root,
      root
    )
    assert.equal(
      paths.cacheFiles,
      path.join(
        root,
        'cache',
        'files'
      )
    )
    assert.equal(
      paths.logs,
      path.join(
        root,
        'logs'
      )
    )
    assert.equal(
      paths.database,
      path.join(
        root,
        'agent-operations.sqlite'
      )
    )
  }
)
