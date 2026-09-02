import mqtt from 'mqtt'

import { spawn } from 'node:child_process'
import path from 'node:path'

import {
  createMockBambuConnection,
  getMockBambuStatus
} from './mockBambu.js'

// ======================================================
// CONFIGURACAO
// ======================================================

const DEFAULT_PORT = 8883

const CONNECT_TIMEOUT =
  8_000

const STATUS_TIMEOUT =
  8_000

const FTPS_TIMEOUT =
  120_000

const MOCK_BAMBU_IP =
  '192.168.2.250'

// ======================================================
// AUXILIARES
// ======================================================

const requireValue = (
  value,
  message
) => {
  const normalized =
    String(
      value || ''
    ).trim()

  if (!normalized) {
    throw new Error(
      message
    )
  }

  return normalized
}

const getTopics = (
  serial
) => ({
  report:
    `device/${serial}/report`,

  request:
    `device/${serial}/request`
})

const safeJsonParse = (
  value
) => {
  try {
    return JSON.parse(
      value
    )
  } catch {
    return null
  }
}

const isMockPrinter = (
  printer
) => {
  return (
    printer?.mock ===
      true ||
    (
      String(
        process.env.PRINTFLOW_DEV_MOCK_BAMBU ||
          ''
      ).toLowerCase() ===
        'true' &&
      String(
        printer?.ip ||
          ''
      ).trim() ===
        MOCK_BAMBU_IP
    )
  )
}

const sanitizeRemoteName = (
  value
) => {
  const baseName =
    path
      .basename(
        String(
          value ||
            'printflow-job.gcode.3mf'
        )
      )
      .replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      )

  const withoutDanger =
    baseName
      .replace(
        /^\.+/,
        ''
      )
      .slice(
        0,
        120
      )

  const normalized =
    withoutDanger ||
    'printflow-job.gcode.3mf'

  return /\.gcode\.3mf$/i.test(
    normalized
  )
    ? normalized
    : normalized.replace(
        /\.3mf$/i,
        ''
      ) + '.gcode.3mf'
}

const normalizeRemoteDirectory = (
  value
) => {
  const raw =
    String(
      value ||
        '/cache'
    )
      .trim()
      .replace(
        /\\/g,
        '/'
      )

  const safe =
    raw
      .split(
        '/'
      )
      .map(part =>
        part.replace(
          /[^a-zA-Z0-9._-]/g,
          ''
        )
      )
      .filter(Boolean)
      .join('/')

  return safe
    ? `/${safe}`
    : ''
}

const joinRemotePath = (
  directory,
  name
) => {
  const normalizedDirectory =
    normalizeRemoteDirectory(
      directory
    )

  return normalizedDirectory
    ? `${normalizedDirectory}/${name}`
    : `/${name}`
}

const getPrintFile = (
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
      'Arquivo 3MF local obrigatorio para impressao Bambu.'
    )
  }

  const name =
    String(
      printFile.name ||
        job?.title ||
        path.basename(
          localPath
        )
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
      '3mf' &&
    !/\.gcode\.3mf$/i.test(
      name
    )
  ) {
    throw new Error(
      'Bambu aceita apenas arquivo .3mf ou .gcode.3mf.'
    )
  }

  return {
    localPath,
    name
  }
}

const runCurl = (
  args,
  {
    timeout = FTPS_TIMEOUT
  } = {}
) =>
  new Promise(
    (
      resolve,
      reject
    ) => {
      const child =
        spawn(
          process.env.PRINTFLOW_CURL_PATH ||
            'curl',
          args,
          {
            windowsHide:
              true
          }
        )

      let stderr =
        ''

      let stdout =
        ''

      const timer =
        setTimeout(
          () => {
            child.kill()

            reject(
              new Error(
                'Tempo esgotado ao enviar arquivo para a Bambu via FTPS.'
              )
            )
          },
          timeout
        )

      child.stdout.on(
        'data',
        data => {
          stdout +=
            data.toString()
        }
      )

      child.stderr.on(
        'data',
        data => {
          stderr +=
            data.toString()
        }
      )

      child.on(
        'error',
        error => {
          clearTimeout(
            timer
          )

          reject(
            error
          )
        }
      )

      child.on(
        'close',
        code => {
          clearTimeout(
            timer
          )

          if (
            code ===
            0
          ) {
            resolve({
              stdout,
              stderr
            })

            return
          }

          reject(
            new Error(
              `Falha no upload FTPS para Bambu. Codigo ${code}. ${stderr.trim()}`
            )
          )
        }
      )
    }
  )

const uploadBambuPrintFile = async (
  connection,
  printFile,
  remotePath
) => {
  if (
    typeof connection.ftpsUploader ===
    'function'
  ) {
    return connection.ftpsUploader({
      connection,
      printFile,
      remotePath
    })
  }

  const ip =
    requireValue(
      connection.printer?.ip,
      'IP da Bambu obrigatorio para upload FTPS.'
    )

  const accessCode =
    requireValue(
      connection.accessCode,
      'LAN Access Code da Bambu obrigatorio para upload FTPS.'
    )

  const port =
    Number(
      connection.printer?.ftpPort ||
        connection.printer?.ftpsPort ||
        990
    )

  const uploadUrl =
    `ftps://${ip}:${port}${remotePath
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/')}`

  await runCurl([
    '-k',
    '--ftp-pasv',
    '--ssl-reqd',
    '--connect-timeout',
    '20',
    '--max-time',
    String(
      Math.ceil(
        FTPS_TIMEOUT /
        1000
      )
    ),
    '-u',
    `bblp:${accessCode}`,
    '-T',
    printFile.localPath,
    uploadUrl
  ])

  return {
    uploaded:
      true,
    remotePath,
    uploadUrl:
      uploadUrl.replace(
        accessCode,
        '***'
      )
  }
}

const buildProjectFilePayload = (
  connection,
  job,
  remotePath,
  remoteName
) => {
  const profile =
    job?.printProfile ||
    {}

  const plate =
    Number(
      profile.plate ||
        profile.plateIndex ||
        1
    )

  const plateNumber =
    Number.isInteger(
      plate
    ) &&
    plate > 0
      ? plate
      : 1

  const boolOption = (
    key,
    fallback
  ) => {
    if (
      profile[key] ===
      false
    ) {
      return false
    }

    if (
      profile[key] ===
      true
    ) {
      return true
    }

    return fallback
  }

  return {
    print: {
      sequence_id:
        String(
          Date.now()
        ),

      command:
        'project_file',

      url:
        `ftp://${remotePath}`,

      file:
        remotePath,

      param:
        String(
          profile.param ||
            `Metadata/plate_${plateNumber}.gcode`
        ),

      subtask_id:
        String(
          profile.subtaskId ||
            profile.subtask_id ||
            '0'
        ),

      subtask_name:
        String(
          job?.title ||
            job?.productName ||
            remoteName
        ),

      use_ams:
        boolOption(
          'useAms',
          Boolean(
            profile.use_ams
          )
        ),

      ams_mapping:
        Array.isArray(
          profile.amsMapping
        )
          ? profile.amsMapping
          : Array.isArray(
              profile.ams_mapping
            )
            ? profile.ams_mapping
            : undefined,

      timelapse:
        boolOption(
          'timelapse',
          false
        ),

      flow_cali:
        boolOption(
          'flowCalibration',
          true
        ),

      bed_leveling:
        boolOption(
          'bedLeveling',
          true
        ),

      layer_inspect:
        boolOption(
          'layerInspect',
          true
        ),

      vibration_cali:
        boolOption(
          'vibrationCalibration',
          false
        )
    }
  }
}

const stripUndefined = (
  value
) => {
  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      stripUndefined
    )
  }

  if (
    value &&
    typeof value ===
      'object'
  ) {
    return Object.fromEntries(
      Object
        .entries(
          value
        )
        .filter(([, item]) =>
          item !==
          undefined
        )
        .map(([key, item]) => [
          key,
          stripUndefined(
            item
          )
        ])
    )
  }

  return value
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
    connected:
      true,

    protocol:
      'bambu',

    manufacturer:
      'Bambu Lab',

    name:
      printer?.name ||
      'Bambu Lab',

    serial:
      printer?.serial ||
      null,

    ip:
      printer?.ip ||
      null,

    state:
      print.gcode_state ||
      print.print_status ||
      'unknown',

    progress:
      Number.isFinite(
        Number(
          print.mc_percent
        )
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
      'IP da Bambu obrigatorio.'
    )

  const serial =
    requireValue(
      printer.serial ||
      options.serial,
      'Numero de serie da Bambu obrigatorio.'
    )

  const accessCode =
    requireValue(
      options.accessCode,
      'LAN Access Code da Bambu obrigatorio.'
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
    `[Bambu] Preparando conexao com ${ip}:${port}`
  )

  console.log(
    `[Bambu] Serial: ${serial}`
  )

  /*
   * IMPORTANTE:
   *
   * Nunca registrar accessCode
   * em logs.
   */

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
         * A Bambu utiliza MQTT sobre TLS.
         *
         * Para o nosso MVP local estamos
         * permitindo certificado nao
         * reconhecido pela trust store.
         *
         * Antes de producao devemos
         * implementar validacao/pinning.
         */

        rejectUnauthorized:
          false
      }
    )

  return {
    client,

    serial,

    accessCode,

    topics:
      getTopics(
        serial
      )
  }
}

// ======================================================
// AGUARDAR CONEXAO MQTT
// ======================================================

const waitForConnection = (
  client
) => {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let finished =
        false

      let timeout =
        null

      const cleanup = () => {
        if (timeout) {
          clearTimeout(
            timeout
          )
        }

        client.removeListener(
          'connect',
          onConnect
        )

        client.removeListener(
          'error',
          onError
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

        resolve(
          true
        )
      }

      const onConnect =
        () => {
          finish()
        }

      const onError =
        error => {
          finish(
            error
          )
        }

      client.once(
        'connect',
        onConnect
      )

      client.once(
        'error',
        onError
      )

      timeout =
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
    }
  )
}

// ======================================================
// ASSINAR TELEMETRIA
// ======================================================

const subscribeReport = (
  client,
  topic
) => {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      client.subscribe(
        topic,
        {
          qos: 0
        },
        error => {
          if (error) {
            reject(
              error
            )

            return
          }

          resolve(
            true
          )
        }
      )
    }
  )
}

// ======================================================
// PUBLICAR JSON
// ======================================================

const publishJson = (
  client,
  topic,
  payload,
  qos = 0
) => {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      if (
        !client ||
        !client.connected
      ) {
        reject(
          new Error(
            'Cliente MQTT nao esta conectado.'
          )
        )

        return
      }

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
            reject(
              error
            )

            return
          }

          resolve(
            true
          )
        }
      )
    }
  )
}

// ======================================================
// SOLICITAR STATUS COMPLETO
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
          String(
            Date.now()
          ),

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

// ======================================================
// AGUARDAR STATUS
// ======================================================

const waitForStatus = (
  connection
) => {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let finished =
        false

      let timeout =
        null

      const cleanup = () => {
        if (timeout) {
          clearTimeout(
            timeout
          )
        }

        connection.client
          .removeListener(
            'message',
            onMessage
          )
      }

      const finish = (
        error,
        result = null
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

        resolve(
          result
        )
      }

      const onMessage = (
        topic,
        buffer
      ) => {
        if (
          topic !==
          connection
            .topics
            .report
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
            connection.printer
          )
        )
      }

      connection.client.on(
        'message',
        onMessage
      )

      timeout =
        setTimeout(
          () => {
            finish(
              new Error(
                'Bambu conectou, mas nao enviou telemetria dentro do tempo esperado.'
              )
            )
          },
          STATUS_TIMEOUT
        )
    }
  )
}

// ======================================================
// ENCERRAR MQTT
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
// VALIDAR CONEXAO ATIVA
// ======================================================

const requireConnection = (
  connection
) => {
  if (
    !connection?.client ||
    !connection.connected ||
    !connection.client.connected
  ) {
    throw new Error(
      'Bambu nao esta conectada.'
    )
  }
}

// ======================================================
// ADAPTER BAMBU
// ======================================================

export const bambuAdapter = {
  protocol:
    'bambu',

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
      true,

    startPrint:
      true
  },

  // ====================================================
  // CONECTAR
  // ====================================================

  async connect(
    printer,
    options = {}
  ) {
    if (
      isMockPrinter(
        printer
      )
    ) {
      console.log('')
      console.log(
        '================================='
      )
      console.log(
        '       BAMBU MOCK CONNECTION'
      )
      console.log(
        '================================='
      )
      console.log(
        '[Bambu Mock] Conexao simulada ativa.'
      )

      return createMockBambuConnection(
        printer,
        options
      )
    }

    let connection =
      null

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

        printer: {
          ...printer,

          serial:
            created.serial
        },

        connected:
          false,

        protocol:
          'bambu',

        connectedAt:
          null,

        accessCode:
          created.accessCode
      }

      console.log(
        '[Bambu] Conectando via MQTT TLS...'
      )

      await waitForConnection(
        connection.client
      )

      connection.connected =
        true

      connection.connectedAt =
        new Date()

      console.log(
        '[Bambu] MQTT conectado'
      )

      console.log(
        `[Bambu] Assinando ${connection.topics.report}`
      )

      await subscribeReport(
        connection.client,
        connection.topics.report
      )

      console.log(
        '[Bambu] Canal de telemetria assinado'
      )

      /*
       * Se o socket MQTT cair depois
       * que ja conectou, atualizamos o
       * estado da conexao.
       */

      connection.client.on(
        'close',
        () => {
          connection.connected =
            false

          console.log(
            `[Bambu] Conexao MQTT encerrada: ${connection.serial}`
          )
        }
      )

      connection.client.on(
        'offline',
        () => {
          connection.connected =
            false

          console.log(
            `[Bambu] Impressora ficou offline: ${connection.serial}`
          )
        }
      )

      /*
       * Nao imprimimos error.message
       * indefinidamente aqui.
       *
       * O erro inicial ja e tratado
       * pelo try/catch da conexao.
       */

      connection.client.on(
        'error',
        error => {
          console.log(
            `[Bambu] Erro MQTT (${connection.serial}): ${error.message}`
          )
        }
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
        '[Bambu] Nao foi possivel conectar.'
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
  //
  // printerManager chama:
  //
  // adapter.disconnect(connection)
  // ====================================================

  async disconnect(
    connection
  ) {
    if (
      connection?.mock ===
      true
    ) {
      connection.connected =
        false

      return {
        disconnected:
          true,

        alreadyDisconnected:
          false,

        mock:
          true
      }
    }

    if (
      !connection?.client
    ) {
      return {
        disconnected:
          true,

        alreadyDisconnected:
          true
      }
    }

    console.log(
      `[Bambu] Desconectando ${connection.printer?.ip || connection.serial || ''}...`
    )

    await closeClient(
      connection.client
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

  // ====================================================
  // STATUS
  //
  // printerManager chama:
  //
  // adapter.getStatus(connection)
  // ====================================================

  async getStatus(
    connection
  ) {
    if (
      connection?.mock ===
      true
    ) {
      return getMockBambuStatus(
        connection
      )
    }

    requireConnection(
      connection
    )

    const statusPromise =
      waitForStatus(
        connection
      )

    await requestFullStatus(
      connection
    )

    return await statusPromise
  },

  // ====================================================
  // PAUSAR
  //
  // printerManager chama:
  //
  // adapter.pause(connection)
  // ====================================================

  async pause(
    connection
  ) {
    if (
      connection?.mock ===
      true
    ) {
      connection.printState =
        'PAUSE'

      return {
        success:
          true,

        mock:
          true
      }
    }

    requireConnection(
      connection
    )

    await publishJson(
      connection.client,
      connection.topics.request,
      {
        print: {
          sequence_id:
            String(
              Date.now()
            ),

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

  async resume(
    connection
  ) {
    if (
      connection?.mock ===
      true
    ) {
      connection.printState =
        'RUNNING'

      return {
        success:
          true,

        mock:
          true
      }
    }

    requireConnection(
      connection
    )

    await publishJson(
      connection.client,
      connection.topics.request,
      {
        print: {
          sequence_id:
            String(
              Date.now()
            ),

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

  async cancel(
    connection
  ) {
    if (
      connection?.mock ===
      true
    ) {
      connection.printState =
        'CANCELLED'

      return {
        success:
          true,

        mock:
          true
      }
    }

    requireConnection(
      connection
    )

    await publishJson(
      connection.client,
      connection.topics.request,
      {
        print: {
          sequence_id:
            String(
              Date.now()
            ),

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
  // INICIAR IMPRESSAO
  // ====================================================

  async startPrint(
    connection,
    job
  ) {
    if (
      connection?.mock ===
      true
    ) {
      connection.printState =
        'RUNNING'

      connection.currentJob =
        {
          ...(job || {}),

          startedAt:
            new Date()
              .toISOString()
        }

      connection.connectedAt =
        new Date()

      return {
        success:
          true,

        mock:
          true,

        job:
          connection.currentJob
      }
    }

    requireConnection(
      connection
    )

    const printFile =
      getPrintFile(
        job
      )

    const remoteName =
      sanitizeRemoteName(
        printFile.name
      )

    const remotePath =
      joinRemotePath(
        job?.printProfile
          ?.bambuRemoteDirectory ||
          connection.printer
            ?.bambuRemoteDirectory ||
          '/cache',
        remoteName
      )

    console.log(
      `[Bambu] Enviando arquivo para ${remotePath}`
    )

    await uploadBambuPrintFile(
      connection,
      printFile,
      remotePath
    )

    const payload =
      stripUndefined(
        buildProjectFilePayload(
          connection,
          job,
          remotePath,
          remoteName
        )
      )

    await publishJson(
      connection.client,
      connection.topics.request,
      payload,
      1
    )

    connection.currentJob = {
      ...(job || {}),
      remotePath,
      startedAt:
        new Date()
          .toISOString()
    }

    return {
      success:
        true,

      started:
        true,

      uploaded:
        true,

      remotePath,

      command:
        'project_file'
    }
  }
}
