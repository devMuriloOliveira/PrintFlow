import { randomUUID } from 'node:crypto'

import { createR2ObjectStorageProvider } from '../BackEnd/src/services/r2ObjectStorageProvider.js'

const required = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
const missing = required.filter(name => !String(process.env[name] || '').trim())
if (missing.length) {
  console.error(`R2 smoke bloqueado: variáveis ausentes (${missing.join(', ')}).`)
  process.exitCode = 1
} else {
  const provider = createR2ObjectStorageProvider({
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    endpoint: process.env.R2_ENDPOINT,
    presignExpiresSeconds: 300
  })
  const key = `printflow-smoke/${randomUUID()}.txt`
  const expected = Buffer.from('printflow-r2-smoke\n')

  try {
    await provider.put({ key, body: expected, contentType: 'text/plain' })
    const metadata = await provider.head(key)
    if (metadata.sizeBytes !== expected.length) throw new Error('Tamanho retornado pelo R2 divergiu.')
    const object = await provider.get(key)
    const chunks = []
    for await (const chunk of object.body) chunks.push(chunk)
    if (!Buffer.concat(chunks).equals(expected)) throw new Error('Conteúdo retornado pelo R2 divergiu.')
    console.log(`R2 smoke passou: objeto temporário validado (${key}).`)
  } finally {
    await provider.delete(key)
  }
}
