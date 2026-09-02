import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
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

const listStorageFiles =
  async (
    root,
    current = root
  ) => {
    const entries =
      await readdir(
        current,
        {
          withFileTypes:
            true
        }
      )

    const files =
      []

    for (const entry of entries) {
      const entryPath =
        path.join(
          current,
          entry.name
        )

      if (entry.isDirectory()) {
        files.push(
          ...await listStorageFiles(
            root,
            entryPath
          )
        )
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const info =
        await stat(
          entryPath
        )

      files.push({
        filePath:
          entryPath,
        storageKey:
          path
            .relative(
              root,
              entryPath
            )
            .split(path.sep)
            .join('/'),
        size:
          info.size,
        mtimeMs:
          info.mtimeMs,
        isTemp:
          entry.name.includes(
            '.tmp'
          )
      })
    }

    return files
  }

const removeFile =
  async (
    filePath
  ) => {
    await rm(
      filePath,
      {
        force:
          true
      }
    )
  }

export const cleanupPrintFileStorage =
  async ({
    activeStorageKeys = [],
    storageDir = env.printFileStorageDir,
    now = Date.now(),
    maxTotalBytes = env.printFileStorageMaxBytes,
    retentionDays = env.printFileStorageRetentionDays,
    tempMaxAgeMs = env.printFileTempMaxAgeMs
  } = {}) => {
    const root =
      path.resolve(
        storageDir
      )

    let files =
      []

    try {
      files =
        await listStorageFiles(
          root
        )
    } catch (error) {
      if (
        error.code ===
        'ENOENT'
      ) {
        return {
          removed:
            0,
          removedBytes:
            0,
          kept:
            0,
          remainingBytes:
            0
        }
      }

      throw error
    }

    const active =
      new Set(
        activeStorageKeys
          .map((key) =>
            String(
              key ||
                ''
            )
              .replace(/\\/g, '/')
          )
          .filter(Boolean)
      )

    const retentionMs =
      Math.max(
        0,
        Number(retentionDays) || 0
      ) *
      24 *
      60 *
      60 *
      1000

    const removedFiles =
      new Set()

    let removedBytes =
      0

    for (const file of files) {
      const ageMs =
        now -
        file.mtimeMs

      const expiredTemp =
        file.isTemp &&
        ageMs >=
          tempMaxAgeMs

      const expiredInactive =
        !file.isTemp &&
        !active.has(
          file.storageKey
        ) &&
        retentionMs > 0 &&
        ageMs >=
          retentionMs

      if (
        expiredTemp ||
        expiredInactive
      ) {
        await removeFile(
          file.filePath
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
          !active.has(
            file.storageKey
          )
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

      await removeFile(
        file.filePath
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
