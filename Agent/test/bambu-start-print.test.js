import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  bambuAdapter
} from '../src/printers/adapters/bambuAdapter.js'

const create3mfFile = async () => {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-bambu-'
      )
    )

  const filePath =
    path.join(
      directory,
      'peca teste.3mf'
    )

  await fs.writeFile(
    filePath,
    'fake-3mf-for-command-test'
  )

  return {
    directory,
    filePath
  }
}

test('Bambu envia 3MF por FTPS e dispara project_file via MQTT', async () => {
  const {
    directory,
    filePath
  } =
    await create3mfFile()

  const published = []
  const uploads = []

  const connection = {
    connected:
      true,
    accessCode:
      'LAN-CODE',
    printer: {
      ip:
        '192.168.1.20',
      serial:
        'ABC123'
    },
    topics: {
      request:
        'device/ABC123/request'
    },
    client: {
      connected:
        true,
      publish: (
        topic,
        payload,
        _options,
        callback
      ) => {
        published.push({
          topic,
          payload:
            JSON.parse(
              payload
            )
        })

        callback()
      }
    },
    ftpsUploader: async (upload) => {
      uploads.push(upload)
      return {
        uploaded:
          true
      }
    }
  }

  try {
    const result =
      await bambuAdapter.startPrint(
        connection,
        {
          id:
            'job-1',
          title:
            'Peca teste',
          printFile: {
            localPath:
              filePath,
            name:
              'peca teste.3mf',
            format:
              '3mf'
          },
          printProfile: {
            plateIndex:
              1,
            bedLeveling:
              true,
            flowCalibration:
              false
          }
        }
      )

    assert.equal(
      result.started,
      true
    )

    assert.equal(
      uploads.length,
      1
    )

    assert.equal(
      uploads[0].remotePath,
      '/cache/peca_teste.gcode.3mf'
    )

    assert.equal(
      published.length,
      1
    )

    assert.equal(
      published[0].topic,
      'device/ABC123/request'
    )

    assert.equal(
      published[0].payload.print.command,
      'project_file'
    )

    assert.equal(
      published[0].payload.print.url,
      'ftp:///cache/peca_teste.gcode.3mf'
    )

    assert.equal(
      published[0].payload.print.param,
      'Metadata/plate_1.gcode'
    )

    assert.equal(
      published[0].payload.print.subtask_id,
      '0'
    )

    assert.equal(
      published[0].payload.print.flow_cali,
      false
    )
  } finally {
    await fs.rm(
      directory,
      {
        recursive:
          true,
        force:
          true
      }
    )
  }
})
