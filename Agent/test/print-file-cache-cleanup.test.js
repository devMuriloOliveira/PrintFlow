import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cleanupPrintFileCache
} from '../src/files/printFileCache.js'

const writeCacheFile =
  async (
    filePath,
    content,
    mtime
  ) => {
    await fs.mkdir(
      path.dirname(
        filePath
      ),
      {
        recursive:
          true
      }
    )

    await fs.writeFile(
      filePath,
      content
    )

    await fs.utimes(
      filePath,
      mtime,
      mtime
    )
  }

test('limpeza do cache do Agent remove arquivos temporarios e expirados', async () => {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-agent-cache-cleanup-'
      )
    )

  const now =
    Date.now()

  const oldDate =
    new Date(
      now -
        10 *
          60 *
          1000
    )

  const freshDate =
    new Date(
      now -
        1000
    )

  const oldFile =
    path.join(
      root,
      'old.3mf'
    )

  const tempFile =
    path.join(
      root,
      'download.3mf.tmp-123'
    )

  const freshFile =
    path.join(
      root,
      'fresh.3mf'
    )

  await writeCacheFile(
    oldFile,
    'old',
    oldDate
  )

  await writeCacheFile(
    tempFile,
    'temp',
    oldDate
  )

  await writeCacheFile(
    freshFile,
    'fresh',
    freshDate
  )

  const result =
    await cleanupPrintFileCache({
      directory:
        root,
      now,
      maxAgeMs:
        5 *
        60 *
        1000,
      maxTotalBytes:
        1024,
      tempMaxAgeMs:
        5 *
        60 *
        1000
    })

  assert.equal(
    result.removed,
    2
  )

  await assert.rejects(
    fs.stat(
      oldFile
    ),
    {
      code:
        'ENOENT'
    }
  )

  await assert.rejects(
    fs.stat(
      tempFile
    ),
    {
      code:
        'ENOENT'
    }
  )

  assert.equal(
    await fs.readFile(
      freshFile,
      'utf8'
    ),
    'fresh'
  )

  await fs.rm(
    root,
    {
      recursive:
        true,
      force:
        true
    }
  )
})

test('limpeza do cache do Agent corta tamanho removendo arquivos mais antigos', async () => {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-agent-cache-size-'
      )
    )

  const now =
    Date.now()

  const oldFile =
    path.join(
      root,
      'old.3mf'
    )

  const newFile =
    path.join(
      root,
      'new.3mf'
    )

  await writeCacheFile(
    oldFile,
    '12345',
    new Date(
      now -
        2000
    )
  )

  await writeCacheFile(
    newFile,
    '12345',
    new Date(
      now -
        1000
    )
  )

  const result =
    await cleanupPrintFileCache({
      directory:
        root,
      now,
      maxAgeMs:
        0,
      maxTotalBytes:
        5,
      tempMaxAgeMs:
        60 *
        60 *
        1000
    })

  assert.equal(
    result.removed,
    1
  )

  await assert.rejects(
    fs.stat(
      oldFile
    ),
    {
      code:
        'ENOENT'
    }
  )

  assert.equal(
    await fs.readFile(
      newFile,
      'utf8'
    ),
    '12345'
  )

  await fs.rm(
    root,
    {
      recursive:
        true,
      force:
        true
    }
  )
})
