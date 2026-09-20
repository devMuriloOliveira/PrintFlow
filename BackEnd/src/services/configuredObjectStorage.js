import { env } from '../config/env.js'
import { createLocalObjectStorageProvider } from './localObjectStorageProvider.js'
import { createR2ObjectStorageProvider } from './r2ObjectStorageProvider.js'

export const createConfiguredObjectStorage = () => {
  if (env.objectStorageProvider === 'local') {
    return createLocalObjectStorageProvider({
      root: env.objectStorageLocalDir
    })
  }

  if (env.objectStorageProvider === 'r2') {
    return createR2ObjectStorageProvider({
      accountId: env.r2AccountId,
      bucket: env.r2Bucket,
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
      endpoint: env.r2Endpoint,
      presignExpiresSeconds: env.r2PresignExpiresSeconds
    })
  }

  throw new Error('OBJECT_STORAGE_PROVIDER deve ser local ou r2.')
}
