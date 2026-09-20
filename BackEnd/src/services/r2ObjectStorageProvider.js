import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import {
  createObjectStorageProvider
} from './objectStorageProvider.js'

const required = [
  'accountId',
  'bucket',
  'accessKeyId',
  'secretAccessKey'
]

const assertConfig = config => {
  for (const name of required) {
    if (!String(config?.[name] || '').trim()) {
      throw new Error(`Configuracao R2 ausente: ${name}.`)
    }
  }
}

const normalizeKey = key => {
  const normalized = String(key || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')

  if (!normalized || normalized.split('/').some(part => part === '..')) {
    throw new Error('Chave de objeto invalida.')
  }
  return normalized
}

export const createR2ObjectStorageProvider = (config, dependencies = {}) => {
  assertConfig(config)
  const endpoint = config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`
  const client = dependencies.client || new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  })
  const presign = dependencies.presign || getSignedUrl
  const expiresIn = Math.min(604800, Math.max(1, Number(config.presignExpiresSeconds || 900)))

  const commandInput = key => ({
    Bucket: config.bucket,
    Key: normalizeKey(key)
  })

  const provider = {
    async put ({ key, body, contentType = '' } = {}) {
      const response = await client.send(new PutObjectCommand({
        ...commandInput(key),
        Body: body,
        ...(contentType ? { ContentType: contentType } : {})
      }))
      return {
        key: normalizeKey(key),
        etag: response.ETag || '',
        versionId: response.VersionId || ''
      }
    },

    async get (key, options = {}) {
      const start = Number.isInteger(options.start) ? options.start : null
      const end = Number.isInteger(options.end) ? options.end : null
      const response = await client.send(new GetObjectCommand({
        ...commandInput(key),
        ...(start !== null || end !== null
          ? { Range: `bytes=${start ?? ''}-${end ?? ''}` }
          : {})
      }))
      return {
        key: normalizeKey(key),
        body: response.Body,
        sizeBytes: response.ContentLength,
        contentType: response.ContentType || '',
        lastModified: response.LastModified || null,
        etag: response.ETag || ''
      }
    },

    async head (key) {
      const response = await client.send(new HeadObjectCommand(commandInput(key)))
      return {
        key: normalizeKey(key),
        sizeBytes: response.ContentLength,
        contentType: response.ContentType || '',
        lastModified: response.LastModified || null,
        etag: response.ETag || ''
      }
    },

    async delete (key) {
      await client.send(new DeleteObjectCommand(commandInput(key)))
      return { key: normalizeKey(key) }
    },

    async createPresignedGetUrl (key, options = {}) {
      return presign(
        client,
        new GetObjectCommand(commandInput(key)),
        { expiresIn: options.expiresIn || expiresIn }
      )
    },

    async createPresignedPutUrl (key, options = {}) {
      return presign(
        client,
        new PutObjectCommand({
          ...commandInput(key),
          ...(options.contentType ? { ContentType: options.contentType } : {})
        }),
        { expiresIn: options.expiresIn || expiresIn }
      )
    }
  }

  return createObjectStorageProvider(provider)
}
