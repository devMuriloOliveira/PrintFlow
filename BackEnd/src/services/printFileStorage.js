import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  env
} from '../config/env.js'

const allowedFormats =
  new Set([
    '3mf',
    'gcode',
    'bgcode'
  ])

const cleanSegment =
  (value) =>
    String(
      value ||
        ''
    )
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120)

export const detectPrintFileFormat =
  (fileName, fallback = '') => {
    const ext =
      path
        .extname(
          String(
            fileName ||
              ''
          )
        )
        .replace('.', '')
        .toLowerCase()

    const format =
      String(
        fallback ||
          ext
      )
        .trim()
        .replace('.', '')
        .toLowerCase()

    return allowedFormats.has(format)
      ? format
      : ''
  }

export const savePrintFileStream =
  async ({
    tenantId,
    productId,
    fileName,
    format,
    stream
  }) => {
    const detectedFormat =
      detectPrintFileFormat(
        fileName,
        format
      )

    if (!detectedFormat) {
      throw new Error(
        'Formato de arquivo invalido.'
      )
    }

    const safeTenant =
      cleanSegment(
        tenantId
      )

    const safeProduct =
      cleanSegment(
        productId
      )

    const safeName =
      cleanSegment(
        fileName
      ) ||
      `print-file.${detectedFormat}`

    const folder =
      path.join(
        env.printFileStorageDir,
        safeTenant,
        safeProduct
      )

    await mkdir(
      folder,
      {
        recursive:
          true
      }
    )

    const tempPath =
      path.join(
        folder,
        `${Date.now()}-${safeName}.tmp`
      )

    const hash =
      createHash(
        'sha256'
      )

    let sizeBytes =
      0

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

        stream.on(
          'data',
          (chunk) => {
            sizeBytes +=
              chunk.length

            if (
              sizeBytes >
              env.printFileMaxBytes
            ) {
              stream.destroy(
                new Error(
                  'Arquivo excede o limite permitido.'
                )
              )
              return
            }

            hash.update(
              chunk
            )
          }
        )

        stream.on(
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

        stream.pipe(
          output
        )
      })

      if (
        sizeBytes <=
        0
      ) {
        throw new Error(
          'Arquivo vazio.'
        )
      }

      const digest =
        hash.digest(
          'hex'
        )

      const storedName =
        `${digest}.${detectedFormat}`

      const finalPath =
        path.join(
          folder,
          storedName
        )

      await rename(
        tempPath,
        finalPath
      )

      return {
        fileName:
          safeName,
        format:
          detectedFormat,
        hash:
          digest,
        sizeBytes,
        storageKey:
          `${safeTenant}/${safeProduct}/${storedName}`
      }
    } catch (error) {
      await rm(
        tempPath,
        {
          force:
            true
        }
      )

      throw error
    }
  }

export const resolvePrintFilePath =
  (storageKey) => {
    const safeParts =
      String(
        storageKey ||
          ''
      )
        .split('/')
        .map(cleanSegment)
        .filter(Boolean)

    if (
      safeParts.length !==
      3
    ) {
      throw new Error(
        'Chave de arquivo invalida.'
      )
    }

    const filePath =
      path.join(
        env.printFileStorageDir,
        ...safeParts
      )

    const root =
      path.resolve(
        env.printFileStorageDir
      )

    const resolved =
      path.resolve(
        filePath
      )

    if (
      !resolved.startsWith(
        root
      )
    ) {
      throw new Error(
        'Chave de arquivo invalida.'
      )
    }

    return resolved
  }

export const openPrintFileReadStream =
  async (
    storageKey
  ) => {
    const resolved =
      resolvePrintFilePath(
        storageKey
      )

    const info =
      await stat(
        resolved
      )

    return {
      stream:
        createReadStream(
          resolved
        ),
      sizeBytes:
        info.size,
      filePath:
        resolved
    }
  }
