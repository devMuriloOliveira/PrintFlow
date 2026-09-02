import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cleanupPrintFileStorage
} from '../src/services/printFileStorage.js'

const writeFile =
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

test('limpeza do storage remove temporarios e arquivos inativos sem apagar chaves ativas', async () => {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-storage-cleanup-'
      )
    )

  const now =
    Date.now()

  const oldDate =
    new Date(
      now -
        3 *
          24 *
          60 *
          60 *
          1000
    )

  const activePath =
    path.join(
      root,
      'tenant-a',
      'product-a',
      'active.3mf'
    )

  const inactivePath =
    path.join(
      root,
      'tenant-a',
      'product-a',
      'inactive.3mf'
    )

  const tempPath =
    path.join(
      root,
      'tenant-a',
      'product-a',
      'upload.tmp'
    )

  await writeFile(
    activePath,
    'active',
    oldDate
  )

  await writeFile(
    inactivePath,
    'inactive',
    oldDate
  )

  await writeFile(
    tempPath,
    'temp',
    oldDate
  )

  const result =
    await cleanupPrintFileStorage({
      activeStorageKeys: [
        'tenant-a/product-a/active.3mf'
      ],
      storageDir:
        root,
      now,
      maxTotalBytes:
        1024,
      retentionDays:
        1,
      tempMaxAgeMs:
        60 *
        60 *
        1000
    })

  assert.equal(
    result.removed,
    2
  )

  assert.equal(
    await fs.readFile(
      activePath,
      'utf8'
    ),
    'active'
  )

  await assert.rejects(
    fs.stat(
      inactivePath
    ),
    {
      code:
        'ENOENT'
    }
  )

  await assert.rejects(
    fs.stat(
      tempPath
    ),
    {
      code:
        'ENOENT'
    }
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

test('limpeza do storage respeita limite total removendo inativos mais antigos', async () => {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-storage-size-'
      )
    )

  const now =
    Date.now()

  const oldPath =
    path.join(
      root,
      'tenant-a',
      'product-a',
      'old.3mf'
    )

  const newPath =
    path.join(
      root,
      'tenant-a',
      'product-a',
      'new.3mf'
    )

  await writeFile(
    oldPath,
    '12345',
    new Date(
      now -
        2000
    )
  )

  await writeFile(
    newPath,
    '12345',
    new Date(
      now -
        1000
    )
  )

  const result =
    await cleanupPrintFileStorage({
      storageDir:
        root,
      now,
      maxTotalBytes:
        5,
      retentionDays:
        0,
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
      oldPath
    ),
    {
      code:
        'ENOENT'
    }
  )

  assert.equal(
    await fs.readFile(
      newPath,
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
