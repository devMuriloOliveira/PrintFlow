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

    try {
      const existingHash =
        await hashFile(
          finalPath
        )

      if (
        existingHash ===
        printFile.hash
      ) {
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
