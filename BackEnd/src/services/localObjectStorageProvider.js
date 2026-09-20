import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, rm, stat, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  createObjectStorageProvider
} from './objectStorageProvider.js'

const normalizeKey = key =>
  String(key || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')

const resolveKeyPath = (root, key) => {
  const normalized = normalizeKey(key)
  if (!normalized || normalized.split('/').some(part => part === '..')) {
    throw new Error('Chave de objeto invalida.')
  }

  const rootPath = path.resolve(root)
  const resolved = path.resolve(rootPath, normalized)
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Chave de objeto invalida.')
  }
  return { normalized, resolved }
}

const writeBody = (body, output) => new Promise((resolve, reject) => {
  if (body && typeof body.pipe === 'function') {
    body.once('error', reject)
    output.once('error', reject)
    output.once('finish', resolve)
    body.pipe(output)
    return
  }

  output.once('error', reject)
  output.once('finish', resolve)
  output.end(body)
})

export const createLocalObjectStorageProvider = ({ root }) => {
  if (!root) throw new Error('Diretorio do object storage local obrigatorio.')

  const provider = {
    async put ({ key, body, contentType = '' } = {}) {
      const target = resolveKeyPath(root, key)
      await mkdir(path.dirname(target.resolved), { recursive: true })
      const temporary = `${target.resolved}.${randomUUID()}.tmp`
      try {
        await writeBody(body, createWriteStream(temporary, { flags: 'wx' }))
        await rename(temporary, target.resolved)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      const info = await stat(target.resolved)
      return {
        key: target.normalized,
        sizeBytes: info.size,
        contentType
      }
    },

    async get (key, options = {}) {
      const target = resolveKeyPath(root, key)
      const info = await stat(target.resolved)
      const start = Number.isInteger(options.start) ? options.start : null
      const end = Number.isInteger(options.end) ? options.end : null
      return {
        key: target.normalized,
        body: createReadStream(target.resolved, {
          ...(start !== null ? { start } : {}),
          ...(end !== null ? { end } : {})
        }),
        sizeBytes: info.size,
        lastModified: info.mtime
      }
    },

    async head (key) {
      const target = resolveKeyPath(root, key)
      const info = await stat(target.resolved)
      return {
        key: target.normalized,
        sizeBytes: info.size,
        lastModified: info.mtime
      }
    },

    async delete (key) {
      const target = resolveKeyPath(root, key)
      await rm(target.resolved, { force: true })
      return { key: target.normalized }
    }
  }

  return createObjectStorageProvider(provider)
}
