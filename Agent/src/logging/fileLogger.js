import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import {
  getAgentLocalPaths
} from '../storage/localPaths.js'

const MAX_LOG_SIZE_BYTES =
  1024 * 1024 * 5

const getLogDirectory = () =>
  process.env.PRINTFLOW_AGENT_LOG_DIR
    ? path.resolve(
        process.env.PRINTFLOW_AGENT_LOG_DIR
      )
    : getAgentLocalPaths()
        .logs

const sensitiveField =
  /secret|token|password|access.?code|api.?key|authorization|credential/i

const redactText = value =>
  String(value || '')
    .replace(
      /(bearer\s+)[^\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /([?&](?:token|secret|password|access_code|api_key)=)[^&\s]+/gi,
      '$1[REDACTED]'
    )

export const sanitizeLogValue = (
  value,
  seen = new WeakSet()
) => {
  if (
    value instanceof Error
  ) {
    return redactText(
      value.stack ||
      value.message
    )
  }

  if (
    typeof value ===
    'string'
  ) {
    return redactText(
      value
    )
  }

  if (
    !value ||
    typeof value !==
    'object'
  ) {
    return value
  }

  if (
    seen.has(value)
  ) {
    return '[Circular]'
  }

  seen.add(value)

  if (
    Array.isArray(value)
  ) {
    return value.map(
      item => sanitizeLogValue(
        item,
        seen
      )
    )
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(
        ([key, item]) => [
          key,
          sensitiveField.test(key)
            ? '[REDACTED]'
            : sanitizeLogValue(
                item,
                seen
              )
        ]
      )
  )
}

const formatArgument = value => {
  if (
    value instanceof Error
  ) {
    return sanitizeLogValue(
      value
    )
  }

  if (
    typeof value ===
      'string'
  ) {
    return sanitizeLogValue(
      value
    )
  }

  return util.inspect(
    sanitizeLogValue(
      value
    ),
    {
      depth:
        6,

      breakLength:
        120
    }
  )
}

const rotateLogIfNeeded = logPath => {
  try {
    const stats =
      fs.statSync(
        logPath
      )

    if (
      stats.size <
      MAX_LOG_SIZE_BYTES
    ) {
      return
    }

    const oldLogPath =
      `${logPath}.1`

    if (
      fs.existsSync(
        oldLogPath
      )
    ) {
      fs.rmSync(
        oldLogPath,
        {
          force:
            true
        }
      )
    }

    fs.renameSync(
      logPath,
      oldLogPath
    )
  } catch {
    // Sem log em arquivo se o sistema negar acesso.
  }
}

export const installFileLogger = () => {
  const logDirectory =
    getLogDirectory()

  const logPath =
    path.join(
      logDirectory,
      'printflow-agent.log'
    )

  try {
    fs.mkdirSync(
      logDirectory,
      {
        recursive:
          true
      }
    )
  } catch {
    return {
      logPath: null
    }
  }

  const originalLog =
    console.log.bind(
      console
    )

  const originalError =
    console.error.bind(
      console
    )

  const writeLine = (
    level,
    args
  ) => {
    try {
      rotateLogIfNeeded(
        logPath
      )

      const line =
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          message: args.map(formatArgument).join(' ')
        })}\n`

      fs.appendFileSync(
        logPath,
        line,
        'utf8'
      )
    } catch {
      // Nunca deixa falha de log derrubar o Agent.
    }
  }

  console.log = (
    ...args
  ) => {
    writeLine(
      'info',
      args
    )

    originalLog(
      ...args
    )
  }

  console.error = (
    ...args
  ) => {
    writeLine(
      'error',
      args
    )

    originalError(
      ...args
    )
  }

  return {
    logPath
  }
}
