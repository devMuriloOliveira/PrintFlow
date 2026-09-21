import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const dataDirectory =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-cache-resume-'
    )
  )

process.env.PRINTFLOW_AGENT_DATA_DIR =
  dataDirectory

const {
  ensurePrintFileCached
} = await import(
  '../src/files/printFileCache.js'
)

test('download do cache continua com Range e valida o hash final', async () => {
  const content =
    Buffer.from(
      'conteudo grande o bastante para testar resume'
    )
  const hash =
    crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
  const partial =
    content.subarray(0, 12)
  const requests = []

  const server =
    http.createServer((req, res) => {
      requests.push(req.headers.range || null)
      const start =
        req.headers.range
          ? Number(
              req.headers.range.match(/bytes=(\d+)-/)[1]
            )
          : 0
      const body =
        content.subarray(start)

      res.writeHead(
        start > 0 ? 206 : 200,
        {
          'Content-Length':
            body.length,
          ...(start > 0
            ? {
                'Content-Range':
                  `bytes ${start}-${content.length - 1}/${content.length}`
              }
            : {})
        }
      )
      res.end(body)
    })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const apiUrl =
    `http://127.0.0.1:${address.port}`
  const cachePath =
    path.join(
      dataDirectory,
      'cache',
      'files',
      `${hash}.3mf.part`
    )

  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, partial)

  try {
    const result =
      await ensurePrintFileCached(
        apiUrl,
        {
          agentId: 'agent-test',
          agentSecret: 'secret-test'
        },
        {
          storageKey: 'tenant/file.3mf',
          hash,
          format: '3mf',
          sizeBytes: content.length
        }
      )

    assert.equal(requests[0], `bytes=${partial.length}-`)
    assert.deepEqual(
      await fs.readFile(result.localPath),
      content
    )
    assert.equal(
      await fs.stat(`${result.localPath}.part`).then(
        () => true,
        error => error.code !== 'ENOENT'
      ),
      false
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(dataDirectory, { recursive: true, force: true })
  }
})
