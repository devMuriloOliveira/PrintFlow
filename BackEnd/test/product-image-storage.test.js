import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'

import {
  detectProductImageType,
  readProductImage,
  saveProductImage
} from '../src/services/productImageStorage.js'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

test('valida a imagem pelo conteudo e usa chave controlada pelo backend', async () => {
  let written = null
  const provider = {
    async put (value) { written = value },
    async get () { return { body: Readable.from([png]) } }
  }

  const stored = await saveProductImage({
    tenantId: 'tenant-a',
    productId: 'product-1',
    body: png,
    objectStorageProvider: provider
  })

  assert.equal(stored.key, 'product-images/tenant-a/product-1/cover')
  assert.equal(stored.marker, 'photo:image/png|product-1')
  assert.equal(written.key, stored.key)
  assert.equal(written.contentType, 'image/png')

  const read = await readProductImage({
    tenantId: 'tenant-a',
    productId: 'product-1',
    marker: stored.marker,
    objectStorageProvider: provider
  })
  assert.deepEqual(read.body, png)
})

test('rejeita arquivo que apenas declara ser imagem', async () => {
  assert.throws(() => detectProductImageType(Buffer.from('<script>alert(1)</script>')), /Formato de imagem invalido/)
})

test('rejeita identificadores capazes de alterar a chave do objeto', async () => {
  await assert.rejects(() => saveProductImage({
    tenantId: '../outro-tenant',
    productId: 'product-1',
    body: png,
    objectStorageProvider: { put: async () => {} }
  }), /Identificador de imagem invalido/)
})
