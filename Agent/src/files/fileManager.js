import {
  ensurePrintFileCached,
  pinPrintFileCache,
  unpinPrintFileCache
} from './printFileCache.js'

/**
 * Facade for Agent-local file operations.
 *
 * Cloud metadata and authorization remain outside this module; the Agent
 * only receives an already-authorized file descriptor and keeps the bytes
 * in its managed local cache.
 */
export const createFileManager = ({
  apiUrl,
  credentials
} = {}) => ({
  ensureCached:
    printFile =>
      ensurePrintFileCached(
        apiUrl,
        credentials,
        printFile
      ),
  pin:
    localPath =>
      pinPrintFileCache(
        localPath
      ),
  unpin:
    localPath =>
      unpinPrintFileCache(
        localPath
      )
})
