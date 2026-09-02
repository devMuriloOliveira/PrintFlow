const nowSequence = () =>
  Number(
    Date.now() % 100
  )

const createStatus = (
  connection
) => {
  const elapsedSeconds =
    Math.floor(
      (
        Date.now() -
        connection.connectedAt.getTime()
      ) / 1000
    )

  const progress =
    Math.min(
      100,
      Math.floor(
        elapsedSeconds / 3
      )
    )

  const state =
    connection.printState ||
    (
      progress >= 100
        ? 'FINISH'
        : 'RUNNING'
    )

  return {
    connected:
      true,

    protocol:
      'bambu',

    manufacturer:
      'Bambu Lab',

    name:
      connection.printer?.name ||
      'Bambu Lab - Ambiente de Teste',

    serial:
      connection.serial,

    ip:
      connection.printer?.ip ||
      null,

    state,

    progress,

    remainingMinutes:
      Math.max(
        0,
        120 -
          progress
      ),

    currentLayer:
      Math.max(
        1,
        Math.floor(
          progress / 4
        )
      ),

    totalLayers:
      25,

    nozzleTemperature:
      state === 'PAUSE'
        ? 185
        : 215,

    nozzleTargetTemperature:
      215,

    bedTemperature:
      58,

    bedTargetTemperature:
      60,

    file:
      'printflow-teste.3mf',

    mock:
      true,

    raw: {
      sequence:
        nowSequence(),

      source:
        'printflow-agent-mock'
    }
  }
}

export const createMockBambuConnection = (
  printer,
  options = {}
) => {
  const serial =
    String(
      printer.serial ||
      options.serial ||
      'PFMOCKBAMBU001'
    ).trim()

  return {
    connected:
      true,

    protocol:
      'bambu',

    mock:
      true,

    serial,

    printer: {
      ...printer,

      serial,

      mock:
        true
    },

    connectedAt:
      new Date(),

    printState:
      'RUNNING'
  }
}

export const getMockBambuStatus = (
  connection
) => {
  if (
    !connection?.connected
  ) {
    throw new Error(
      'Bambu simulada nao esta conectada.'
    )
  }

  return createStatus(
    connection
  )
}
