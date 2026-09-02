import {
  env
} from '../config/env.js'

import {
  query
} from '../db/pool.js'

import {
  cleanupPrintFileStorage
} from '../services/printFileStorage.js'

const loadActiveStorageKeys =
  async () => {
    const result =
      await query(
        `
          select distinct
            print_file_storage_key
          from products
          where print_file_storage_key <> ''
        `
      )

    return result
      .rows
      .map((row) =>
        row.print_file_storage_key
      )
      .filter(Boolean)
  }

export const runPrintFileStorageCleanup =
  async () => {
    const activeStorageKeys =
      await loadActiveStorageKeys()

    const result =
      await cleanupPrintFileStorage({
        activeStorageKeys
      })

    if (
      result.removed >
      0
    ) {
      console.log(
        `[PrintFiles] Limpeza removeu ${result.removed} arquivo(s), ${result.removedBytes} bytes.`
      )
    }

    return result
  }

export const startPrintFileStorageCleanup =
  () => {
    const intervalMs =
      Math.max(
        60_000,
        Number(
          env.printFileStorageCleanupIntervalMs
        ) ||
          6 *
            60 *
            60 *
            1000
      )

    runPrintFileStorageCleanup()
      .catch((error) => {
        console.error(
          '[PrintFiles] Falha na limpeza inicial:',
          error.message ||
            error
        )
      })

    const timer =
      setInterval(
        () => {
          runPrintFileStorageCleanup()
            .catch((error) => {
              console.error(
                '[PrintFiles] Falha na limpeza agendada:',
                error.message ||
                  error
              )
            })
        },
        intervalMs
      )

    timer.unref?.()

    return timer
  }
