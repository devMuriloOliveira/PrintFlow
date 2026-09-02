import axios from 'axios'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDirectory = process.env.PRINTFLOW_AGENT_DATA_DIR
  ? path.resolve(process.env.PRINTFLOW_AGENT_DATA_DIR)
  : path.resolve(__dirname, '../../data')

const cacheDirectory =
  path.join(
    dataDirectory,
    'print-files'
  )

const defaultCacheMaxAgeMs =
  Number(
    process.env.PRINTFLOW_AGENT_CACHE_MAX_AGE_DAYS ||
      14
  ) *
  24 *
  60 *
  60 *
  1000

const defaultCacheMaxBytes =
  Number(
    process.env.PRINTFLOW_AGENT_CACHE_MAX_BYTES ||
      2 *
        1024 *
        1024 *
        1024
  )

const defaultTempMaxAgeMs =
  Number(
    process.env.PRINTFLOW_AGENT_CACHE_TEMP_MAX_AGE_MS ||
      60 *
        60 *
        1000
  )

const safeName =
  (value) =>
    String(
      value ||
        ''
    )
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 160)

const hashFile =
  async (
    filePath
  ) => {
    const hash =
      crypto.createHash(
        'sha256'
      )

    await new Promise((resolve, reject) => {
      const input =
        createReadStream(
          filePath
        )

      input.on(
        'data',
        (chunk) => hash.update(chunk)
      )

      input.on(
        'error',
        reject
      )

      input.on(
        'end',
        resolve
      )
    })

    return hash.digest(
      'hex'
    )
  }

const listCacheFiles =
  async (
    directory
  ) => {
    let entries =
      []

    try {
      entries =
        await fs.readdir(
          directory,
          {
            withFileTypes:
              true
          }
        )
    } catch (error) {
      if (
        error.code ===
        'ENOENT'
      ) {
        return []
      }

      throw error
    }

    const files =
      []

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }

      const filePath =
        path.join(
          directory,
          entry.name
        )

      const info =
        await fs.stat(
          filePath
        )

      files.push({
        filePath,
        name:
          entry.name,
        size:
          info.size,
        mtimeMs:
          info.mtimeMs,
        isTemp:
          entry.name.includes(
            '.tmp-'
          )
      })
    }

    return files
  }

export const cleanupPrintFileCache =
  async ({
    directory = cacheDirectory,
    now = Date.now(),
    maxAgeMs = defaultCacheMaxAgeMs,
    maxTotalBytes = defaultCacheMaxBytes,
    tempMaxAgeMs = defaultTempMaxAgeMs
  } = {}) => {
    const files =
      await listCacheFiles(
        directory
      )

    const removedFiles =
      new Set()

    let removedBytes =
      0

    for (const file of files) {
      const ageMs =
        now -
        file.mtimeMs

      if (
        (
          file.isTemp &&
          ageMs >=
            tempMaxAgeMs
        ) ||
        (
          !file.isTemp &&
          maxAgeMs > 0 &&
          ageMs >=
            maxAgeMs
        )
      ) {
        await fs.rm(
          file.filePath,
          {
            force:
              true
          }
        )

        removedFiles.add(
          file.filePath
        )

        removedBytes +=
          file.size
      }
    }

    const remaining =
      files
        .filter((file) =>
          !removedFiles.has(
            file.filePath
          )
        )

    let remainingBytes =
      remaining.reduce(
        (total, file) =>
          total +
          file.size,
        0
      )

    const removable =
      remaining
        .filter((file) =>
          !file.isTemp
        )
        .sort((a, b) =>
          a.mtimeMs -
          b.mtimeMs
        )

    for (const file of removable) {
      if (
        remainingBytes <=
        maxTotalBytes
      ) {
        break
      }

      await fs.rm(
        file.filePath,
        {
          force:
            true
        }
      )

      removedFiles.add(
        file.filePath
      )

      removedBytes +=
        file.size

      remainingBytes -=
        file.size
    }

    return {
      removed:
        removedFiles.size,
      removedBytes,
      kept:
        files.length -
        removedFiles.size,
      remainingBytes
    }
  }

export const ensurePrintFileCached =
  async (
    apiUrl,
    credentials,
    printFile
  ) => {
    if (
      !printFile
        ?.storageKey
    ) {
      throw new Error(
        'Arquivo de impressao sem chave de storage.'
      )
    }

    if (
      !printFile.hash
    ) {
      throw new Error(
        'Arquivo de impressao sem hash para validacao.'
      )
    }

    const format =
      safeName(
        printFile.format ||
        'print'
      )

    const cacheName =
      `${safeName(printFile.hash)}.${format}`

    const finalPath =
      path.join(
        cacheDirectory,
        cacheName
      )

    await fs.mkdir(
      cacheDirectory,
      {
        recursive:
          true
      }
    )

    await cleanupPrintFileCache()

    try {
      const existingHash =
        await hashFile(
          finalPath
        )

      if (
        existingHash ===
        printFile.hash
      ) {
        await fs.utimes(
          finalPath,
          new Date(),
          new Date()
        )

        return {
          ...printFile,
          localPath:
            finalPath,
          cached:
            true
        }
      }
    } catch (error) {
      if (
        error.code !==
        'ENOENT'
      ) {
        throw error
      }
    }

    const tempPath =
      `${finalPath}.tmp-${Date.now()}`

    const hash =
      crypto.createHash(
        'sha256'
      )

    let sizeBytes =
      0

    const response =
      await axios.get(
        `${apiUrl}/api/agents/print-file?key=${encodeURIComponent(printFile.storageKey)}`,
        {
          responseType:
            'stream',
          headers: {
            'x-agent-id':
              credentials.agentId,
            'x-agent-secret':
              credentials.agentSecret
          }
        }
      )

    try {
      await new Promise((resolve, reject) => {
        const output =
          createWriteStream(
            tempPath,
            {
              flags:
                'wx'
            }
          )

        response.data.on(
          'data',
          (chunk) => {
            sizeBytes +=
              chunk.length

            hash.update(
              chunk
            )
          }
        )

        response.data.on(
          'error',
          reject
        )

        output.on(
          'error',
          reject
        )

        output.on(
          'finish',
          resolve
        )

        response.data.pipe(
          output
        )
      })

      const digest =
        hash.digest(
          'hex'
        )

      if (
        digest !==
        printFile.hash
      ) {
        throw new Error(
          'Hash do arquivo baixado nao confere.'
        )
      }

      if (
        printFile.sizeBytes &&
        Number(printFile.sizeBytes) !==
          sizeBytes
      ) {
        throw new Error(
          'Tamanho do arquivo baixado nao confere.'
        )
      }

      await fs.rename(
        tempPath,
        finalPath
      )

      await cleanupPrintFileCache()

      return {
        ...printFile,
        localPath:
          finalPath,
        cached:
          false
      }
    } catch (error) {
      await fs.rm(
        tempPath,
        {
          force:
            true
        }
      )

      throw error
    }
  }
