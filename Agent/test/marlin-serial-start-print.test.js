import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  marlinSerialAdapter
} from '../src/printers/adapters/marlinSerialAdapter.js'

class FakeSerial extends EventEmitter {
  constructor({
    delayOkMs = 0
  } = {}) {
    super()
    this.isOpen = true
    this.delayOkMs = delayOkMs
    this.writes = []
  }

  write(command, callback) {
    this.writes.push(command.trim())
    if (callback) callback()

    setTimeout(
      () => this.emit('data', Buffer.from('ok\n')),
      this.delayOkMs
    )
  }
}

const createGcodeFile = async (content) => {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-marlin-'
      )
    )

  const filePath =
    path.join(
      directory,
      'part.gcode'
    )

  await fs.writeFile(
    filePath,
    content
  )

  return {
    directory,
    filePath
  }
}

const waitFor = async (
  predicate,
  timeoutMs = 1000
) => {
  const startedAt =
    Date.now()

  while (
    Date.now() - startedAt <
    timeoutMs
  ) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  assert.equal(predicate(), true)
}

test('Marlin USB envia G-code em segundo plano e ignora comentarios', async () => {
  const {
    directory,
    filePath
  } =
    await createGcodeFile(
      '; comentario\nG28 ; home\n\nG1 X10 Y10\nM104 S200\n'
    )

  const serial =
    new FakeSerial()

  const connection = {
    connected:
      true,
    serial,
    printer: {
      name:
        'Marlin teste',
      port:
        'COM3'
    },
    queue:
      Promise.resolve(),
    lastLines:
      []
  }

  try {
    const result =
      await marlinSerialAdapter.startPrint(
        connection,
        {
          printFile: {
            localPath:
              filePath,
            name:
              'part.gcode',
            format:
              'gcode'
          }
        }
      )

    assert.equal(
      result.started,
      true
    )

    assert.equal(
      result.background,
      true
    )

    await connection.queue

    assert.deepEqual(
      serial.writes,
      [
        'G28',
        'G1 X10 Y10',
        'M104 S200'
      ]
    )

    assert.equal(
      connection.activePrint.status,
      'completed'
    )

    assert.equal(
      connection.activePrint.progress,
      100
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

test('Marlin USB pausa, retoma e cancela streaming local', async () => {
  const {
    directory,
    filePath
  } =
    await createGcodeFile(
      'G1 X1\nG1 X2\nG1 X3\nG1 X4\n'
    )

  const serial =
    new FakeSerial({
      delayOkMs:
        20
    })

  const connection = {
    connected:
      true,
    serial,
    printer: {
      name:
        'Marlin teste',
      port:
        'COM3'
    },
    queue:
      Promise.resolve(),
    lastLines:
      []
  }

  try {
    await marlinSerialAdapter.startPrint(
      connection,
      {
        printFile: {
          localPath:
            filePath,
          name:
            'part.gcode',
          format:
            'gcode'
        }
      }
    )

    await waitFor(
      () => serial.writes.length >= 1
    )

    const status =
      await marlinSerialAdapter.getStatus(
        connection
      )

    assert.equal(
      status.state,
      'PRINTING'
    )

    assert.equal(
      typeof status.progress,
      'number'
    )

    const pause =
      await marlinSerialAdapter.pause(
        connection
      )

    assert.equal(
      pause.paused,
      true
    )

    const writesWhilePaused =
      serial.writes.length

    await new Promise(resolve => setTimeout(resolve, 80))

    assert.equal(
      serial.writes.length,
      writesWhilePaused
    )

    const resume =
      await marlinSerialAdapter.resume(
        connection
      )

    assert.equal(
      resume.resumed,
      true
    )

    await waitFor(
      () => serial.writes.length > writesWhilePaused
    )

    const cancel =
      await marlinSerialAdapter.cancel(
        connection
      )

    assert.equal(
      cancel.cancelled,
      true
    )

    await assert.rejects(
      connection.queue,
      /cancelada/
    )

    assert.equal(
      connection.activePrint.status,
      'cancelled'
    )

    assert.ok(
      serial.writes.includes(
        'M410'
      )
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
