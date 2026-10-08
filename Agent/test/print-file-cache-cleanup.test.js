import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cleanupPrintFileCache,
  getPrintFileCacheStats,
  pinPrintFileCache,
  recoverStalePrintFilePins,
  unpinPrintFileCacheByPrintJobId,
  unpinPrintFileCache
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

test('estatisticas do cache reportam apenas contagens e bytes dos arquivos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printflow-agent-cache-stats-'))
  try {
    const pinnedPath = path.join(root, 'active.3mf')
    await writeCacheFile(pinnedPath, 'payload', new Date())
    await pinPrintFileCache(pinnedPath, { printJobId: 'job-cache-stats' })
    await writeCacheFile(path.join(root, 'download.3mf.part'), 'tmp', new Date())

    assert.deepEqual(await getPrintFileCacheStats({ directory: root }), {
      files: 2,
      bytes: 10,
      pinnedFiles: 1,
      temporaryFiles: 1
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

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

test('limpeza do cache preserva arquivo pinado', async () => {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-agent-cache-pin-'
      )
    )
  const filePath =
    path.join(root, 'active.3mf')

  await writeCacheFile(
    filePath,
    'active',
    new Date(Date.now() - 10 * 60 * 1000)
  )
  await pinPrintFileCache(filePath)

  const result =
    await cleanupPrintFileCache({
      directory: root,
      maxAgeMs: 1,
      maxTotalBytes: 1,
      tempMaxAgeMs: 1
    })

  assert.equal(result.removed, 0)
  assert.equal(
    await fs.readFile(filePath, 'utf8'),
    'active'
  )

  await unpinPrintFileCache(filePath)
  await fs.rm(root, { recursive: true, force: true })
})

test('recupera pin vencido somente quando o monitor nao existe e a impressora confirma ociosa', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printflow-agent-cache-recovery-'))
  const filePath = path.join(root, 'recover-me.3mf')
  const printJobId = 'job-recovery-1'
  const printer = {
    protocol: 'octoprint',
    connectionType: 'network',
    ip: '192.168.5.42',
    port: 80,
    apiKey: 'must-not-be-persisted'
  }
  await writeCacheFile(filePath, 'payload', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
  await pinPrintFileCache(filePath, { printJobId, printer })

  const markerPath = `${filePath}.pin`
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'))
  marker.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  await fs.writeFile(markerPath, JSON.stringify(marker), 'utf8')
  const persistedMarker = await fs.readFile(markerPath, 'utf8')
  assert.equal(persistedMarker.includes('must-not-be-persisted'), false)
  assert.equal(await unpinPrintFileCacheByPrintJobId(printJobId, { directory: root }), 1)
  await pinPrintFileCache(filePath, { printJobId, printer })
  const repinnedMarker = JSON.parse(await fs.readFile(markerPath, 'utf8'))
  repinnedMarker.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  await fs.writeFile(markerPath, JSON.stringify(repinnedMarker), 'utf8')

  let probes = 0
  const monitored = await recoverStalePrintFilePins({
    directory: root,
    activePrintJobIds: [printJobId],
    leaseMs: 24 * 60 * 60 * 1000,
    isPrinterIdle: async () => { probes += 1; return true }
  })
  assert.deepEqual(monitored, { released: 0, retained: 1 })
  assert.equal(probes, 0)

  const anotherPrintActive = await recoverStalePrintFilePins({
    directory: root,
    hasActivePrints: true,
    leaseMs: 24 * 60 * 60 * 1000,
    isPrinterIdle: async () => { probes += 1; return true }
  })
  assert.deepEqual(anotherPrintActive, { released: 0, retained: 0 })
  assert.equal(probes, 0)

  const unverifiable = await recoverStalePrintFilePins({
    directory: root,
    leaseMs: 24 * 60 * 60 * 1000,
    isPrinterIdle: async () => false
  })
  assert.deepEqual(unverifiable, { released: 0, retained: 1 })
  assert.equal(await fs.readFile(filePath, 'utf8'), 'payload')

  const idle = await recoverStalePrintFilePins({
    directory: root,
    leaseMs: 24 * 60 * 60 * 1000,
    isPrinterIdle: async candidate => candidate.ip === printer.ip
  })
  assert.deepEqual(idle, { released: 1, retained: 0 })
  assert.equal(await unpinPrintFileCacheByPrintJobId(printJobId, { directory: root }), 0)

  const cleanup = await cleanupPrintFileCache({ directory: root, maxAgeMs: 1, maxTotalBytes: 0 })
  assert.equal(cleanup.removed, 1)
  await fs.rm(root, { recursive: true, force: true })
})
