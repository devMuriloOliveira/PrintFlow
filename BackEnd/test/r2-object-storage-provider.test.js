import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'

import { createR2ObjectStorageProvider } from '../src/services/r2ObjectStorageProvider.js'

test('provider R2 usa comandos S3 e nunca normaliza chave para fora do tenant', async () => {
  const calls = []
  const client = {
    async send(command) {
      calls.push(command)
      switch (command.constructor.name) {
        case 'PutObjectCommand': return { ETag: 'etag-put' }
        case 'GetObjectCommand': return {
          Body: Readable.from(['data']),
          ContentLength: 4,
          ContentType: 'text/plain'
        }
        case 'HeadObjectCommand': return {
          ContentLength: 4,
          ETag: 'etag-head'
        }
        case 'DeleteObjectCommand': return {}
        default: throw new Error(`Comando inesperado: ${command.constructor.name}`)
      }
    }
  }
  const presign = async (_client, command, options) => ({
    url: `https://signed.test/${command.input.Key}`,
    expiresIn: options.expiresIn
  })
  const provider = createR2ObjectStorageProvider({
    accountId: 'account-test',
    bucket: 'bucket-test',
    accessKeyId: 'access-test',
    secretAccessKey: 'secret-test'
  }, { client, presign })

  assert.equal((await provider.put({ key: 'tenant-a/file.txt', body: 'data' })).etag, 'etag-put')
  assert.equal((await provider.get('tenant-a/file.txt')).sizeBytes, 4)
  assert.equal((await provider.head('tenant-a/file.txt')).etag, 'etag-head')
  assert.equal((await provider.delete('tenant-a/file.txt')).key, 'tenant-a/file.txt')
  assert.equal((await provider.createPresignedGetUrl('tenant-a/file.txt')).url, 'https://signed.test/tenant-a/file.txt')
  assert.equal(calls.length, 4)
  await assert.rejects(() => provider.head('../outside'), /invalida/)
})

test('provider R2 exige configuração completa sem expor valores', () => {
  assert.throws(() => createR2ObjectStorageProvider({}), /Configuracao R2 ausente/)
})
