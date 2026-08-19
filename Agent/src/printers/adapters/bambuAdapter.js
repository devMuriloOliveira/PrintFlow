import mqtt from 'mqtt'

// ======================================================
// CONFIGURAÇÃO
// ======================================================

const DEFAULT_PORT = 8883
const CONNECT_TIMEOUT = 8_000
const STATUS_TIMEOUT = 8_000

// ======================================================
// AUXILIARES
// ======================================================

const requireValue = (
  value,
  message
) => {
  const normalized =
    String(value || '').trim()

  if (!normalized) {
    throw new Error(message)
  }

  return normalized
}

const getTopics = (serial) => ({
  report:
    `device/${serial}/report`,

  request:
    `device/${serial}/request`
})

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

// ======================================================
// NORMALIZAR STATUS
// ======================================================

const normalizeStatus = (
  payload,
  printer
) => {
  const print =
    payload?.print || {}

  return {
    connected: true,

    protocol: 'bambu',

    manufacturer:
      'Bambu Lab',

    name:
      printer.name ||
      'Bambu Lab',

    serial:
      printer.serial,

    ip:
      printer.ip,

    state:
      print.gcode_state ||
      print.print_status ||
      'unknown',

    progress:
      Number.isFinite(
        Number(print.mc_percent)
      )
        ? Number(
            print.mc_percent
          )
        : null,

    remainingMinutes:
      Number.isFinite(
        Number(
          print.mc_remaining_time
        )
      )
        ? Number(
            print.mc_remaining_time
          )
        : null,

    currentLayer:
      Number.isFinite(
        Number(
          print.layer_num
        )
      )
        ? Number(
            print.layer_num
          )
        : null,

    totalLayers:
      Number.isFinite(
        Number(
          print.total_layer_num
        )
      )
        ? Number(
            print.total_layer_num
          )
        : null,

    nozzleTemperature:
      Number.isFinite(
        Number(
          print.nozzle_temper
        )
      )
        ? Number(
            print.nozzle_temper
          )
        : null,

    nozzleTargetTemperature:
      Number.isFinite(
        Number(
          print.nozzle_target_temper
        )
      )
        ? Number(
            print.nozzle_target_temper
          )
        : null,

    bedTemperature:
      Number.isFinite(
        Number(
          print.bed_temper
        )
      )
        ? Number(
            print.bed_temper
          )
        : null,

    bedTargetTemperature:
      Number.isFinite(
        Number(
          print.bed_target_temper
        )
      )
        ? Number(
            print.bed_target_temper
          )
        : null,

    file:
      print.subtask_name ||
      null,

    raw:
      payload
  }
}

// ======================================================
// CRIAR CLIENTE MQTT
// ======================================================

const createClient = (
  printer,
  options = {}
) => {
  const ip =
    requireValue(
      printer.ip,
      'IP da Bambu obrigatório.'
    )

  const serial =
    requireValue(
      printer.serial ||
      options.serial,
      'Número de série da Bambu obrigatório.'
    )

  const accessCode =
    requireValue(
      options.accessCode,
      'LAN Access Code da Bambu obrigatório.'
    )

  const port =
    Number(
      printer.port ||
      DEFAULT_PORT
    )

  const url =
    `mqtts://${ip}:${port}`

  console.log('')
  console.log(
    `[Bambu] Preparando conexão com ${ip}:${port}`
  )

  console.log(
    `[Bambu] Serial: ${serial}`
  )

  // NÃO mostramos accessCode no log.

  const client =
    mqtt.connect(
      url,
      {
        username:
          'bblp',

        password:
          accessCode,

        protocolVersion:
          4,

        reconnectPeriod:
          0,

        connectTimeout:
          CONNECT_TIMEOUT,

        keepalive:
          60,

        clean:
          true,

        clientId:
          `printflow-${Math.random()
            .toString(16)
            .slice(2)}`,

        /*
         * A conexão LAN da Bambu usa TLS,
         * mas o certificado da impressora
         * normalmente não está na trust store
         * padrão do Node.
         *
         * Para o MVP local permitimos a
         * conexão. Antes de produção, vamos
         * evoluir isso para validação/pinning
         * de certificado.
         */
        rejectUnauthorized:
          false
      }
    )

  return {
    client,

    serial,

    topics:
      getTopics(serial)
  }
}

// ======================================================
// AGUARDAR CONEXÃO
// ======================================================

const waitForConnection = (
  client
) => {
  return new Promise(
    (resolve, reject) => {
      let finished = false

      const finish = (
        error = null
      ) => {
        if (finished) {
          return
        }

        finished = true

        clearTimeout(timeout)

        client.removeListener(
          'connect',
          onConnect
        )

        client.removeListener(
          'error',
          onError
        )

        if (error) {
          reject(error)
        } else {
          resolve(true)
        }
      }

      const onConnect = () => {
        finish()
      }

      const onError = (
        error
      ) => {
        finish(error)
      }

      const timeout =
        setTimeout(
          () => {
            finish(
              new Error(
                'Tempo esgotado ao conectar na Bambu.'
              )
            )
          },
          CONNECT_TIMEOUT
        )

      client.once(
        'connect',
        onConnect
      )

      client.once(
        'error',
        onError
      )
    }
  )
}

// ======================================================
// ASSINAR STATUS
// ======================================================

const subscribeReport = (
  client,
  topic
) => {
  return new Promise(
    (resolve, reject) => {
      client.subscribe(
        topic,
        {
          qos: 0
        },
        error => {
          if (error) {
            reject(error)
            return
          }

          resolve(true)
        }
      )
    }
  )
}

// ======================================================
// PUBLICAR COMANDO
// ======================================================

const publishJson = (
  client,
  topic,
  payload,
  qos = 0
) => {
  return new Promise(
    (resolve, reject) => {
      client.publish(
        topic,
        JSON.stringify(
          payload
        ),
        {
          qos
        },
        error => {
          if (error) {
            reject(error)
            return
          }

          resolve(true)
        }
      )
    }
  )
}

// ======================================================
// PEDIR STATUS COMPLETO
// ======================================================

const requestFullStatus = async (
  connection
) => {
  await publishJson(
    connection.client,
    connection.topics.request,
    {
      pushing: {
        sequence_id:
          String(Date.now()),

        command:
          'pushall',

        version:
          1,

        push_target:
          1
      }
    }
  )
}

// O comando pushall é útil principalmente para
// obter um snapshot completo de status em modelos
// que enviam apenas alterações incrementais.
// A documentação comunitária do protocolo recomenda
// não dispará-lo com alta frequência em P1.

// ======================================================
// AGUARDAR PRIMEIRO STATUS
// ======================================================

const waitForStatus = (
  connection,
  printer
) => {
  return new Promise(
    (resolve, reject) => {
      let finished = false

      const finish = (
        error,
        result = null
      ) => {
        if (finished) {
          return
        }

        finished = true

        clearTimeout(timeout)

        connection.client.removeListener(
          'message',
          onMessage
        )

        if (error) {
          reject(error)
          return
        }

        resolve(result)
      }

      const onMessage = (
        topic,
        buffer
      ) => {
        if (
          topic !==
          connection.topics.report
        ) {
          return
        }

        const payload =
          safeJsonParse(
            buffer.toString()
          )

        if (!payload) {
          return
        }

        finish(
          null,
          normalizeStatus(
            payload,
            printer
          )
        )
      }

      const timeout =
        setTimeout(
          () => {
            finish(
              new Error(
                'Bambu conectou, mas não enviou telemetria dentro do tempo esperado.'
              )
            )
          },
          STATUS_TIMEOUT
        )

      connection.client.on(
        'message',
        onMessage
      )
    }
  )
}

// ======================================================
// ENCERRAR CLIENTE
// ======================================================

const closeClient = (
  client
) => {
  return new Promise(
    resolve => {
      if (!client) {
        resolve()
        return
      }

      try {
        client.end(
          true,
          {},
          () => {
            resolve()
          }
        )
      } catch {
        resolve()
      }
    }
  )
}

// ======================================================
// ADAPTER
// ======================================================

export const bambuAdapter = {
  protocol:
    'bambu',

  // ====================================================
  // CONECTAR
  // ====================================================

  async connect(
    printer,
    options = {}
  ) {
    let connection = null

    try {
      console.log('')
      console.log(
        '================================='
      )
      console.log(
        '       BAMBU LAB CONNECTION'
      )
      console.log(
        '================================='
      )

      const created =
        createClient(
          printer,
          options
        )

      connection = {
        client:
          created.client,

        serial:
          created.serial,

        topics:
          created.topics,

        connected:
          false,

        protocol:
          'bambu'
      }

      console.log(
        '[Bambu] Conectando via MQTT TLS...'
      )

      await waitForConnection(
        connection.client
      )

      connection.connected =
        true

      console.log(
        '[Bambu] ✅ MQTT conectado'
      )

      console.log(
        `[Bambu] Assinando ${connection.topics.report}`
      )

      await subscribeReport(
        connection.client,
        connection.topics.report
      )

      console.log(
        '[Bambu] ✅ Canal de telemetria assinado'
      )

      return connection
    } catch (error) {
      if (
        connection?.client
      ) {
        await closeClient(
          connection.client
        )
      }

      console.log(
        '[Bambu] ❌ Não foi possível conectar.'
      )

      console.log(
        '[Bambu] Erro:',
        error.message
      )

      throw error
    }
  },

  // ====================================================
  // DESCONECTAR
  // ====================================================

  async disconnect(
    printer,
    connection
  ) {
    if (
      !connection?.client
    ) {
      return {
        disconnected:
          true
      }
    }

    console.log(
      `[Bambu] Desconectando ${printer?.ip || ''}...`
    )

    await closeClient(
      connection.client
    )

    connection.connected =
      false

    return {
      disconnected:
        true
    }
  },

  // ====================================================
  // STATUS
  // ====================================================

  async getStatus(
    printer,
    connection
  ) {
    if (
      !connection?.client ||
      !connection.connected
    ) {
      throw new Error(
        'Bambu não está conectada.'
      )
    }

    const statusPromise =
      waitForStatus(
        connection,
        printer
      )

    await requestFullStatus(
      connection
    )

    const status =
      await statusPromise

    return status
  },

  // ====================================================
  // PAUSAR
  // ====================================================

  async pausePrint(
    printer,
    connection
  ) {
    if (
      !connection?.connected
    ) {
      throw new Error(
        'Bambu não está conectada.'
      )
    }

    await publishJson(
      connection.client,
      connection.topics.request,
      {
        print: {
          sequence_id:
            String(Date.now()),

          command:
            'pause'
        }
      },
      1
    )

    return {
      success:
        true
    }
  },

  // ====================================================
  // RETOMAR
  // ====================================================

  async resumePrint(
    printer,
    connection
  ) {
    if (
      !connection?.connected
    ) {
      throw new Error(
        'Bambu não está conectada.'
      )
    }

    await publishJson(
      connection.client,
      connection.topics.request,
      {
        print: {
          sequence_id:
            String(Date.now()),

          command:
            'resume'
        }
      },
      1
    )

    return {
      success:
        true
    }
  },

  // ====================================================
  // CANCELAR
  // ====================================================

  async cancelPrint(
    printer,
    connection
  ) {
    if (
      !connection?.connected
    ) {
      throw new Error(
        'Bambu não está conectada.'
      )
    }

    await publishJson(
      connection.client,
      connection.topics.request,
      {
        print: {
          sequence_id:
            String(Date.now()),

          command:
            'stop',

          param:
            ''
        }
      },
      1
    )

    return {
      success:
        true
    }
  },

  // ====================================================
  // INICIAR ARQUIVO
  // ====================================================

  async startPrint() {
    throw new Error(
      'Envio/início de arquivo Bambu será implementado na etapa de arquivos 3MF.'
    )
  }
}