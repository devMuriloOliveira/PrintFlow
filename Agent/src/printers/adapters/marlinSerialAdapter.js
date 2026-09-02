import { SerialPort } from 'serialport'

const DEFAULT_BAUD_RATE =
  115200

const OPEN_TIMEOUT =
  12_000

const COMMAND_TIMEOUT =
  8_000

const STARTUP_DELAY =
  2_000

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
  printer
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
      text.toLowerCase().includes(
        'paused'
      )
        ? 'PAUSE'
        : 'CONNECTED',

    progress:
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
      lines
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
      false
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
      connection.printer
    )
  },

  async startPrint() {
    throw new Error(
      'Envio/inicio de arquivo por Marlin USB sera implementado na etapa de arquivos G-code.'
    )
  },

  async pause(
    connection
  ) {
    requireConnection(
      connection
    )

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
