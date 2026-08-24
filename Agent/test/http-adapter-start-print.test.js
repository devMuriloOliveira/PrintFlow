import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import axios from 'axios'

import {
  moonrakerAdapter
} from '../src/printers/adapters/moonrakerAdapter.js'

import {
  octoprintAdapter
} from '../src/printers/adapters/octoprintAdapter.js'

import {
  prusaLinkAdapter
} from '../src/printers/adapters/prusaLinkAdapter.js'

const createTempPrintFile = async () => {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-agent-'
      )
    )

  const filePath =
    path.join(
      directory,
      'part.gcode'
    )

  await fs.writeFile(
    filePath,
    'G28\n'
  )

  return {
    directory,
    filePath
  }
}

const withAxiosMock = async (
  handler,
  run
) => {
  const originalPost =
    axios.post

  const originalPut =
    axios.put

  try {
    axios.post =
      handler.post ||
      originalPost

    axios.put =
      handler.put ||
      originalPut

    return await run()
  } finally {
    axios.post =
      originalPost

    axios.put =
      originalPut
  }
}

test('OctoPrint envia arquivo para /api/files/local com print=true', async () => {
  const {
    directory,
    filePath
  } =
    await createTempPrintFile()

  const calls = []

  try {
    await withAxiosMock(
      {
        post: async (
          url,
          body,
          options
        ) => {
          calls.push({
            url,
            body,
            options
          })

          return {
            data: {
              done: true
            }
          }
        }
      },
      async () => {
        const result =
          await octoprintAdapter.startPrint(
            {
              connected: true,
              baseUrl: 'http://octo.local',
              apiKey: 'secret'
            },
            {
              printFile: {
                localPath:
                  filePath,
                name:
                  'part.gcode'
              }
            }
          )

        assert.equal(
          result.started,
          true
        )
      }
    )

    assert.equal(
      calls[0].url,
      'http://octo.local/api/files/local'
    )

    assert.equal(
      calls[0].options.headers['X-Api-Key'],
      'secret'
    )
  } finally {
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
})

test('Moonraker envia arquivo para /server/files/upload com print=true', async () => {
  const {
    directory,
    filePath
  } =
    await createTempPrintFile()

  const calls = []

  try {
    await withAxiosMock(
      {
        post: async (
          url,
          body,
          options
        ) => {
          calls.push({
            url,
            body,
            options
          })

          return {
            data: {
              item: {
                path: 'part.gcode'
              }
            }
          }
        }
      },
      async () => {
        const result =
          await moonrakerAdapter.startPrint(
            {
              connected: true,
              baseUrl: 'http://moon.local',
              apiKey: 'token'
            },
            {
              printFile: {
                localPath:
                  filePath,
                name:
                  'part.gcode',
                hash:
                  'abc'
              }
            }
          )

        assert.equal(
          result.started,
          true
        )
      }
    )

    assert.equal(
      calls[0].url,
      'http://moon.local/server/files/upload'
    )

    assert.equal(
      calls[0].options.headers.Authorization,
      'Bearer token'
    )
  } finally {
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
})

test('PrusaLink envia arquivo para /api/v1/files/local com Print-After-Upload', async () => {
  const {
    directory,
    filePath
  } =
    await createTempPrintFile()

  const calls = []

  try {
    await withAxiosMock(
      {
        put: async (
          url,
          body,
          options
        ) => {
          calls.push({
            url,
            body,
            options
          })

          return {
            data: null
          }
        }
      },
      async () => {
        const result =
          await prusaLinkAdapter.startPrint(
            {
              connected: true,
              baseUrl: 'http://prusa.local',
              username: 'maker',
              password: 'secret'
            },
            {
              printFile: {
                localPath:
                  filePath,
                name:
                  'part.gcode'
              }
            }
          )

        assert.equal(
          result.started,
          true
        )
      }
    )

    assert.equal(
      calls[0].url,
      'http://prusa.local/api/v1/files/local/part.gcode'
    )

    assert.equal(
      calls[0].options.headers['Print-After-Upload'],
      '?1'
    )
  } finally {
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
})
