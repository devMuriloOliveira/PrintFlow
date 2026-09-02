import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

const MAX_LOG_SIZE_BYTES =
  1024 * 1024 * 5

const getLogDirectory = () =>
  process.env.PRINTFLOW_AGENT_LOG_DIR
    ? path.resolve(
        process.env.PRINTFLOW_AGENT_LOG_DIR
      )
    : path.resolve(
        process.cwd(),
        'logs'
      )

const formatArgument = value => {
  if (
    value instanceof Error
  ) {
    return value.stack ||
      value.message
  }

  if (
    typeof value ===
      'string'
  ) {
    return value
  }

  return util.inspect(
    value,
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

  fs.mkdirSync(
    logDirectory,
    {
      recursive:
        true
    }
  )

  const logPath =
    path.join(
      logDirectory,
      'printflow-agent.log'
    )

  const originalLog =
    console.log.bind(
      console
    )

  const originalError =
    console.error.bind(
      console
    )

  const writeLine = args => {
    try {
      rotateLogIfNeeded(
        logPath
      )

      const line =
        `[${new Date().toISOString()}] ${args.map(formatArgument).join(' ')}\n`

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
