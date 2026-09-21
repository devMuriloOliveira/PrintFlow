import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import { env } from '../BackEnd/src/config/env.js'
import { query, pool } from '../BackEnd/src/db/pool.js'
import { createConfiguredObjectStorage } from '../BackEnd/src/services/configuredObjectStorage.js'
import { resolvePrintFilePath } from '../BackEnd/src/services/printFileStorage.js'

const tenantFlag = process.argv.find(value => value.startsWith('--tenant='))
const tenantId = tenantFlag?.slice('--tenant='.length).trim()
const apply = process.argv.includes('--apply')

if (!tenantId) throw new Error('Informe --tenant=<tenant_id> para limitar a migração.')
if (env.objectStorageProvider !== 'r2') throw new Error('OBJECT_STORAGE_PROVIDER deve ser r2 para esta migração.')

const hashFile = async filePath => {
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(filePath)) {
    sizeBytes += chunk.length
    hash.update(chunk)
  }
  return { hash: hash.digest('hex'), sizeBytes }
}

const verifyRemote = async (storageKey, expected) => {
  const remote = await provider.head(storageKey)
  if (Number(remote.sizeBytes) !== expected.sizeBytes) return false
  const downloaded = await provider.get(storageKey)
  const remoteHash = createHash('sha256')
  let remoteSize = 0
  for await (const chunk of downloaded.body) {
    remoteSize += chunk.length
    remoteHash.update(chunk)
  }
  return remoteSize === expected.sizeBytes && remoteHash.digest('hex') === expected.hash
}

const provider = createConfiguredObjectStorage()
const summary = { total: 0, copied: 0, alreadyPresent: 0, skipped: 0, failed: 0 }

try {
  const products = await query(
    `select id, print_file_storage_key, print_file_hash, print_file_size_bytes
       from products
      where tenant_id = $1
        and print_file_storage_key <> ''
      order by id`,
    [tenantId]
  )
  summary.total = products.rowCount

  for (const product of products.rows) {
    const storageKey = String(product.print_file_storage_key || '')
    let localPath
    try {
      localPath = resolvePrintFilePath(storageKey)
      await stat(localPath)
    } catch {
      summary.skipped += 1
      console.warn(`arquivo local ausente; produto=${product.id} chave=${storageKey}`)
      continue
    }

    const local = await hashFile(localPath)
    if (local.hash !== String(product.print_file_hash || '') || local.sizeBytes !== Number(product.print_file_size_bytes || 0)) {
      summary.failed += 1
      console.error(`metadata divergente; produto=${product.id} chave=${storageKey}`)
      continue
    }

    try {
      if (await verifyRemote(storageKey, local)) {
        summary.alreadyPresent += 1
        console.log(`ja presente; produto=${product.id} chave=${storageKey}`)
        continue
      }
    } catch {
      // O objeto ainda nao existe; a copia abaixo e o caminho esperado.
    }

    if (!apply) {
      summary.copied += 1
      console.log(`pronto para copiar; produto=${product.id} chave=${storageKey} bytes=${local.sizeBytes}`)
      continue
    }

    await provider.put({
      key: storageKey,
      body: createReadStream(localPath),
      contentType: 'application/octet-stream'
    })
    if (!await verifyRemote(storageKey, local)) throw new Error('hash R2 divergente')
    summary.copied += 1
    console.log(`copiado e verificado; produto=${product.id} chave=${storageKey}`)
  }
  console.log(JSON.stringify({ tenantId, apply, ...summary }))
} finally {
  await pool.end()
}
