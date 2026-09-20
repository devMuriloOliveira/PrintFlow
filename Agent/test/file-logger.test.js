import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  installFileLogger,
  sanitizeLogValue
} from '../src/logging/fileLogger.js'

test(
  'redige credenciais e URLs temporarias antes de gravar logs',
  () => {
    const sanitized =
      sanitizeLogValue({
        agentSecret: 'secret-value',
        printer: {
          apiKey: 'printer-key',
          url: 'https://storage.example/file?token=temporary-token'
        },
        authorization: 'Bearer access-token'
      })

    assert.deepEqual(
      sanitized,
      {
        agentSecret: '[REDACTED]',
        printer: {
          apiKey: '[REDACTED]',
          url: 'https://storage.example/file?token=[REDACTED]'
        },
        authorization: '[REDACTED]'
      }
    )
  }
)

test(
  'grava JSON Lines estruturado sem segredo no arquivo local',
  async () => {
    const directory =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          'printflow-agent-log-'
        )
      )
    const originalLog =
      console.log
    const previousDirectory =
      process.env.PRINTFLOW_AGENT_LOG_DIR

    process.env.PRINTFLOW_AGENT_LOG_DIR =
      directory

    try {
      console.log = () => {}

      const logger =
        installFileLogger()

      console.log({
        event: 'agent.command.completed',
        commandId: 'command-1',
        agentSecret: 'never-write-this'
      })

      console.log = originalLog

      const [line] =
        (await fs.readFile(
          logger.logPath,
          'utf8'
        )).trim().split('\n')

      const record =
        JSON.parse(line)

      assert.equal(
        record.level,
        'info'
      )
      assert.equal(
        record.message.includes('agent.command.completed'), true)
      assert.equal(
        record.message.includes('never-write-this'), false)
    } finally {
      console.log = originalLog

      if (previousDirectory === undefined) {
        delete process.env.PRINTFLOW_AGENT_LOG_DIR
      } else {
        process.env.PRINTFLOW_AGENT_LOG_DIR =
          previousDirectory
      }

      await fs.rm(
        directory,
        {
          recursive: true,
          force: true
        }
      )
    }
  }
)
