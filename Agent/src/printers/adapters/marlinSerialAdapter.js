import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { SerialPort } from 'serialport'

const DEFAULT_BAUD_RATE =
  115200

const OPEN_TIMEOUT =
  12_000

const COMMAND_TIMEOUT =
  8_000

const STARTUP_DELAY =
  2_000

const PRINT_LINE_TIMEOUT =
  20_000

const PRINT_PAUSE_POLL =
  250

const normalizePort = (
  value
) => {
  const port =
    String(
      value ||
        ''
    ).trim()

  if (!port) {
    throw new Error(
      'Porta serial da impressora obrigatoria.'
    )
  }

  return port
}

const normalizeBaudRate = (
  value
) => {
  const baudRate =
    Number(
      value ||
        DEFAULT_BAUD_RATE
    )

  if (
    !Number.isFinite(
      baudRate
    ) ||
    baudRate <=
      0
  ) {
    return DEFAULT_BAUD_RATE
  }

  return baudRate
}

const wait = (
  ms
) =>
  new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  )

const normalizePrintFile = (
  job
) => {
  const printFile =
    job?.printFile ||
    {}

  const localPath =
    String(
      printFile.localPath ||
        job?.localPath ||
        ''
    ).trim()

  if (!localPath) {
    throw new Error(
      'Arquivo G-code local obrigatorio para impressao Marlin USB.'
    )
  }

  const name =
    String(
      printFile.name ||
        job?.title ||
        localPath
    )

  const format =
    String(
      printFile.format ||
        name.split('.').pop() ||
        ''
    )
      .trim()
      .toLowerCase()

  if (
    format !==
    'gcode'
  ) {
    throw new Error(
      'Marlin USB aceita apenas arquivo .gcode.'
    )
  }

  return {
    localPath,
    name
  }
}

const cleanGcodeLine = (
  line
) => {
  const withoutComment =
    String(
      line ||
        ''
    )
      .replace(
        /;.*$/,
        ''
      )
      .trim()

  return withoutComment
}

async function * readGcodeCommands(
  filePath
) {
  const reader =
    createInterface({
      input:
        createReadStream(
          filePath,
          {
            encoding:
              'utf8'
          }
        ),

      crlfDelay:
        Infinity
    })

  for await (
    const line
    of reader
  ) {
    const command =
      cleanGcodeLine(
        line
      )

    if (command) {
      yield command
    }
  }
}

const countGcodeCommands = async (
  filePath
) => {
  let count =
    0

  for await (
    const _command
    of readGcodeCommands(
      filePath
    )
  ) {
    count +=
      1
  }

  return count
}

const waitWhilePaused = async (
  printState
) => {
  while (
    printState?.paused &&
    !printState.cancelled
  ) {
    await wait(
      PRINT_PAUSE_POLL
    )
  }
}

const openSerial = (
  path,
  baudRate
) => {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const serial =
        new SerialPort({
          path,
          baudRate,
          autoOpen:
            false
        })

      const timeout =
        setTimeout(
          () => {
            reject(
              new Error(
                `Tempo esgotado ao abrir ${path}.`
              )
            )
          },
          OPEN_TIMEOUT
        )

      serial.open(
        error => {
          clearTimeout(
            timeout
          )

          if (error) {
            reject(
              error
            )

            return
          }

          resolve(
            serial
          )
        }
      )
    }
  )
}

const closeSerial = (
  serial
) => {
  return new Promise(
    resolve => {
      if (
        !serial ||
        !serial.isOpen
      ) {
        resolve()

        return
      }

      serial.close(
        () => resolve()
      )
    }
  )
}

const parseTemperatureValue = (
  line,
  key
) => {
  const match =
    line.match(
      new RegExp(
        `${key}:\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*(?:\\/\\s*([-+]?\\d+(?:\\.\\d+)?))?`,
        'i'
      )
    )

  if (!match) {
    return {
      current:
        null,

      target:
        null
    }
  }

  return {
    current:
      Number(
        match[1]
      ),

    target:
      match[2] !==
        undefined
        ? Number(
            match[2]
          )
        : null
  }
}

const parsePositionValue = (
  line,
  key
) => {
  const match =
    line.match(
      new RegExp(
        `${key}:\\s*([-+]?\\d+(?:\\.\\d+)?)`,
        'i'
      )
    )

  return match
    ? Number(
        match[1]
      )
    : null
}

const parseStatus = (
  lines,
  printer,
  connection = null
) => {
  const text =
    lines.join(
      '\n'
    )

  const temperatureLine =
    lines.find(
      line =>
        /\bT:\s*[-+]?\d/i.test(
          line
        )
    ) ||
    ''

  const positionLine =
    lines.find(
      line =>
        /\bX:\s*[-+]?\d/i.test(
          line
        )
    ) ||
    ''

  const nozzle =
    parseTemperatureValue(
      temperatureLine,
      'T'
    )

  const bed =
    parseTemperatureValue(
      temperatureLine,
      'B'
    )

  const activePrint =
    connection?.activePrint ||
    null

  return {
    connected:
      true,

    protocol:
      'marlin',

    manufacturer:
      printer?.manufacturer ||
      null,

    name:
      printer?.name ||
      'Impressora Marlin',

    port:
      printer?.port ||
      null,

    baudRate:
      printer?.baudRate ||
      null,

    state:
      activePrint?.status ===
        'paused'
        ? 'PAUSE'
        : activePrint?.status ===
            'printing'
          ? 'PRINTING'
          : text.toLowerCase().includes(
              'paused'
            )
            ? 'PAUSE'
            : 'CONNECTED',

    progress:
      activePrint?.progress ??
      null,

    remainingMinutes:
      null,

    nozzleTemperature:
      nozzle.current,

    nozzleTargetTemperature:
      nozzle.target,

    bedTemperature:
      bed.current,

    bedTargetTemperature:
      bed.target,

    position: {
      x:
        parsePositionValue(
          positionLine,
          'X'
        ),

      y:
        parsePositionValue(
          positionLine,
          'Y'
        ),

      z:
        parsePositionValue(
          positionLine,
          'Z'
        )
    },

    raw: {
      lines,

      activePrint:
        activePrint
          ? {
              status:
                activePrint.status,

              file:
                activePrint.file,

              sentCommands:
                activePrint.sentCommands,

              totalCommands:
                activePrint.totalCommands,

              error:
                activePrint.error ||
                null
            }
          : null
    }
  }
}

const enqueueCommand = (
  connection,
  command,
  options = {}
) => {
  const run = async () =>
    sendCommandNow(
      connection,
      command,
      options
    )

  connection.queue =
    connection.queue.then(
      run,
      run
    )

  return connection.queue
}

const writeRawCommand = (
  connection,
  command
) =>
  new Promise(
    (
      resolve,
      reject
    ) => {
      if (
        !connection?.serial ||
        !connection.serial.isOpen
      ) {
        reject(
          new Error(
            'Impressora Marlin nao esta conectada.'
          )
        )

        return
      }

      connection.serial.write(
        `${command}\n`,
        error => {
          if (error) {
            reject(
              error
            )

            return
          }

          resolve()
        }
      )
    }
  )

const sendCommandNow = (
  connection,
  command,
  options = {}
) => {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      if (
        !connection?.serial ||
        !connection.connected ||
        !connection.serial.isOpen
      ) {
        reject(
          new Error(
            'Impressora Marlin nao esta conectada.'
          )
        )

        return
      }

      const waitForOk =
        options.waitForOk !==
        false

      const collected =
        []

      let buffer =
        ''

      let finished =
        false

      const cleanup = () => {
        clearTimeout(
          timeout
        )

        connection.serial.removeListener(
          'data',
          onData
        )
      }

      const finish = (
        error = null
      ) => {
        if (finished) {
          return
        }

        finished =
          true

        cleanup()

        if (error) {
          reject(
            error
          )

          return
        }

        connection.lastLines =
          collected

        resolve(
          collected
        )
      }

      const timeout =
        setTimeout(
          () => {
            finish(
              new Error(
                `Tempo esgotado aguardando resposta para ${command}.`
              )
            )
          },
          options.timeout ||
            COMMAND_TIMEOUT
        )

      const onLine = (
        line
      ) => {
        const clean =
          line.trim()

        if (!clean) {
          return
        }

        collected.push(
          clean
        )

        connection.lastActivityAt =
          new Date()

        const lower =
          clean.toLowerCase()

        if (
          lower.startsWith(
            'error'
          )
        ) {
          finish(
            new Error(
              clean
            )
          )

          return
        }

        if (
          waitForOk &&
          (
            lower ===
              'ok' ||
            lower.startsWith(
              'ok '
            )
          )
        ) {
          finish()
        }
      }

      const onData = (
        data
      ) => {
        buffer +=
          data.toString(
            'utf8'
          )

        const parts =
          buffer.split(
            /\r?\n/
          )

        buffer =
          parts.pop() ||
          ''

        for (
          const part
          of parts
        ) {
          onLine(
            part
          )
        }
      }

      connection.serial.on(
        'data',
        onData
      )

      connection.serial.write(
        `${command}\n`,
        error => {
          if (error) {
            finish(
              error
            )
          }
        }
      )
    }
  )
}

const requireConnection = (
  connection
) => {
  if (
    !connection?.serial ||
    !connection.connected ||
    !connection.serial.isOpen
  ) {
    throw new Error(
      'Impressora Marlin nao esta conectada.'
    )
  }
}

export const marlinSerialAdapter = {
  protocol:
    'marlin',

  capabilities: {
    status:
      true,

    pause:
      true,

    resume:
      true,

    cancel:
      true,

    disconnect:
      true,

    upload:
      false,

    startPrint:
      true
  },

  async connect(
    printer
  ) {
    const port =
      normalizePort(
        printer.port
      )

    const baudRate =
      normalizeBaudRate(
        printer.baudRate
      )

    console.log(
      `[Marlin] Conectando na porta ${port} em ${baudRate} baud...`
    )

    const serial =
      await openSerial(
        port,
        baudRate
      )

    const connection = {
      connected:
        true,

      protocol:
        'marlin',

      serial,

      printer: {
        ...printer,

        port,

        baudRate
      },

      baudRate,

      connectedAt:
        new Date(),

      lastActivityAt:
        null,

      lastLines:
        [],

      queue:
        Promise.resolve()
    }

    serial.on(
      'close',
      () => {
        connection.connected =
          false

        console.log(
          `[Marlin] Porta serial encerrada: ${port}`
        )
      }
    )

    serial.on(
      'error',
      error => {
        connection.connected =
          false

        console.log(
          `[Marlin] Erro serial (${port}): ${error.message}`
        )
      }
    )

    try {
      await wait(
        STARTUP_DELAY
      )

      const firmwareLines =
        await enqueueCommand(
          connection,
          'M115',
          {
            timeout:
              10_000
          }
        )

      connection.firmware =
        firmwareLines.join(
          '\n'
        )

      console.log(
        `[Marlin] Conectada em ${port}.`
      )

      return connection
    } catch (
      error
    ) {
      connection.connected =
        false

      await closeSerial(
        serial
      )

      throw error
    }
  },

  async disconnect(
    connection
  ) {
    if (
      !connection?.serial
    ) {
      return {
        disconnected:
          true,

        alreadyDisconnected:
          true
      }
    }

    await closeSerial(
      connection.serial
    )

    connection.connected =
      false

    return {
      disconnected:
        true,

      alreadyDisconnected:
        false
    }
  },

  async getStatus(
    connection
  ) {
    requireConnection(
      connection
    )

    if (
      connection.activePrint &&
      ![
        'completed',
        'cancelled',
        'failed'
      ].includes(
        connection.activePrint.status
      )
    ) {
      return parseStatus(
        connection.lastLines ||
        [],
        connection.printer,
        connection
      )
    }

    const temperatureLines =
      await enqueueCommand(
        connection,
        'M105'
      )

    let positionLines =
      []

    try {
      positionLines =
        await enqueueCommand(
          connection,
          'M114'
        )
    } catch {
      positionLines =
        []
    }

    return parseStatus(
      [
        ...temperatureLines,
        ...positionLines
      ],
      connection.printer,
      connection
    )
  },

  async startPrint(
    connection,
    job
  ) {
    requireConnection(
      connection
    )

    if (
      connection.activePrint &&
      ![
        'completed',
        'cancelled',
        'failed'
      ].includes(
        connection.activePrint.status
      )
    ) {
      throw new Error(
        'Ja existe uma impressao Marlin em andamento nesta conexao.'
      )
    }

    const printFile =
      normalizePrintFile(
        job
      )

    const totalCommands =
      await countGcodeCommands(
        printFile.localPath
      )

    if (
      totalCommands <=
      0
    ) {
      throw new Error(
        'Arquivo G-code nao possui comandos validos para imprimir.'
      )
    }

    const printState = {
      status:
        'printing',

      file:
        printFile.name,

      totalCommands,

      sentCommands:
        0,

      progress:
        0,

      paused:
        false,

      cancelled:
        false,

      startedAt:
        new Date()
    }

    connection.activePrint =
      printState

    const run = async () => {
      try {
        for await (
          const command
          of readGcodeCommands(
            printFile.localPath
          )
        ) {
          await waitWhilePaused(
            printState
          )

          if (
            printState.cancelled
          ) {
            throw new Error(
              'Impressao Marlin cancelada pelo usuario.'
            )
          }

          await sendCommandNow(
            connection,
            command,
            {
              timeout:
                PRINT_LINE_TIMEOUT
            }
          )

          printState.sentCommands +=
            1

          printState.progress =
            Math.min(
              100,
              Math.round(
                (
                  printState.sentCommands /
                  totalCommands
                ) *
                100
              )
            )
        }

        printState.status =
          'completed'

        printState.completedAt =
          new Date()

        return {
          started:
            true,

          completed:
            true,

          file:
            printFile.name,

          sentCommands:
            printState.sentCommands
        }
      } catch (
        error
      ) {
        printState.status =
          printState.cancelled
            ? 'cancelled'
            : 'failed'

        printState.error =
          error.message

        throw error
      } finally {
        printState.finishedAt =
          new Date()
      }
    }

    connection.queue =
      connection.queue.then(
        run,
        run
      )

    connection.queue.catch(
      error => {
        console.log(
          `[Marlin] Impressao G-code finalizada com erro: ${error.message}`
        )
      }
    )

    return {
      started:
        true,

      background:
        true,

      file:
        printFile.name,

      totalCommands
    }
  },

  async pause(
    connection
  ) {
    requireConnection(
      connection
    )

    if (
      connection.activePrint?.status ===
      'printing'
    ) {
      connection.activePrint.paused =
        true

      connection.activePrint.status =
        'paused'

      return {
        success:
          true,

        paused:
          true
      }
    }

    await enqueueCommand(
      connection,
      'M25'
    )

    return {
      success:
        true
    }
  },

  async resume(
    connection
  ) {
    requireConnection(
      connection
    )

    if (
      connection.activePrint?.status ===
      'paused'
    ) {
      connection.activePrint.paused =
        false

      connection.activePrint.status =
        'printing'

      return {
        success:
          true,

        resumed:
          true
      }
    }

    await enqueueCommand(
      connection,
      'M24'
    )

    return {
      success:
        true
    }
  },

  async cancel(
    connection
  ) {
    requireConnection(
      connection
    )

    if (
      connection.activePrint &&
      ![
        'completed',
        'cancelled',
        'failed'
      ].includes(
        connection.activePrint.status
      )
    ) {
      connection.activePrint.cancelled =
        true

      connection.activePrint.status =
        'cancelled'

      try {
        await writeRawCommand(
          connection,
          'M410'
        )
      } catch {
        // Nem todo firmware aceita parada rapida; o streaming local ja foi interrompido.
      }

      return {
        success:
          true,

        cancelled:
          true
      }
    }

    await enqueueCommand(
      connection,
      'M524'
    )

    return {
      success:
        true
    }
  }
}
