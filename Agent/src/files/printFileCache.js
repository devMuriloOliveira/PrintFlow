import axios from 'axios'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import {
  getAgentLocalPaths
} from '../storage/localPaths.js'

const cacheDirectory =
  getAgentLocalPaths()
    .cacheFiles

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
      if (
        !entry.isFile() ||
        entry.name.endsWith('.pin')
      ) {
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
          entry.name.includes('.tmp-') ||
          entry.name.endsWith('.part'),
        isPinned:
          await fs.access(
            `${filePath}.pin`
          )
            .then(
              () => true,
              () => false
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
          !file.isPinned &&
          ageMs >=
            tempMaxAgeMs
        ) ||
        (
          !file.isTemp &&
          !file.isPinned &&
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
          !file.isTemp &&
          !file.isPinned
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

export const pinPrintFileCache =
  async (
    localPath
  ) => {
    if (!localPath) {
      throw new Error(
        'Caminho local do cache obrigatorio.'
      )
    }

    await fs.writeFile(
      `${localPath}.pin`,
      'pinned\n',
      'utf8'
    )
  }

export const unpinPrintFileCache =
  async (
    localPath
  ) => {
    if (!localPath) {
      return
    }

    await fs.rm(
      `${localPath}.pin`,
      {
        force:
          true
      }
    )
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

    if (!String(printFile.printJobId || '').trim()) {
      throw new Error('Arquivo de impressao sem Production Job autorizado.')
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
      `${finalPath}.part`

    let partialBytes =
      0

    try {
      partialBytes =
        (await fs.stat(tempPath)).size
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    const expectedBytes =
      Number(
        printFile.sizeBytes ||
        0
      )

    if (
      expectedBytes > 0 &&
      partialBytes >= expectedBytes
    ) {
      await fs.rm(
        tempPath,
        {
          force:
            true
        }
      )
      partialBytes =
        0
    }

    const requestHeaders = {
      'x-agent-id':
        credentials.agentId,
      'x-agent-secret':
        credentials.agentSecret,
      ...(partialBytes > 0
        ? {
            Range:
              `bytes=${partialBytes}-`
          }
        : {})
    }

    const response =
      await axios.get(
        `${apiUrl}/api/agents/print-file?key=${encodeURIComponent(printFile.storageKey)}&printJobId=${encodeURIComponent(printFile.printJobId)}`,
        {
          responseType:
            'stream',
          headers:
            requestHeaders,
          validateStatus:
            status =>
              (status >= 200 &&
                status < 300) ||
              status === 416
        }
      )

    if (
      response.status ===
      416
    ) {
      await fs.rm(
        tempPath,
        {
          force:
            true
        }
      )

      return ensurePrintFileCached(
        apiUrl,
        credentials,
        printFile
      )
    }

    const resume =
      partialBytes > 0 &&
      response.status === 206

    if (
      partialBytes > 0 &&
      !resume
    ) {
      await fs.rm(
        tempPath,
        {
          force:
            true
        }
      )
      partialBytes =
        0
    }

    const hash =
      crypto.createHash(
        'sha256'
      )

    let sizeBytes =
      partialBytes

    if (resume) {
      await new Promise((resolve, reject) => {
        const existing =
          createReadStream(
            tempPath
          )

        existing.on(
          'data',
          chunk => hash.update(chunk)
        )
        existing.on(
          'error',
          reject
        )
        existing.on(
          'end',
          resolve
        )
      })
    }

    try {
      await new Promise((resolve, reject) => {
        const output =
          createWriteStream(
            tempPath,
            {
              flags:
                resume
                  ? 'a'
                  : 'w'
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
        expectedBytes > 0 &&
        expectedBytes !== sizeBytes
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
      if (
        error.message ===
        'Hash do arquivo baixado nao confere.'
      ) {
        await fs.rm(
          tempPath,
          {
            force:
              true
          }
        )
      }

      throw error
    }
  }
