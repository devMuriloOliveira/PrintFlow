import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import FormData from 'form-data'

const buildBaseUrl = (
  printer
) =>
  `http://${printer.ip}:${printer.port || 80}`

const headers = (
  connection
) => ({
  'X-Api-Key':
    connection.apiKey
})

const requireConnection = (
  connection
) => {
  if (
    !connection?.connected
  ) {
    throw new Error(
      'OctoPrint nao esta conectado.'
    )
  }
}

const getPrintFile = (
  job
) => {
  const localPath =
    job?.printFile
      ?.localPath

  if (
    !localPath
  ) {
    throw new Error(
      'Arquivo local nao encontrado para envio ao OctoPrint.'
    )
  }

  return {
    localPath,
    name:
      job?.printFile
        ?.name ||
      path.basename(
        localPath
      )
  }
}

const normalizeStatus = (
  payload,
  printer
) => {
  const printerState =
    payload?.state ||
    {}

  const temperatures =
    payload?.temperature ||
    {}

  return {
    connected:
      true,
    protocol:
      'octoprint',
    manufacturer:
      printer?.manufacturer ||
      null,
    name:
      printer?.name ||
      'OctoPrint',
    ip:
      printer?.ip,
    port:
      printer?.port,
    state:
      printerState.text ||
      'unknown',
    progress:
      payload?.progress
        ?.completion ??
      null,
    remainingMinutes:
      payload?.progress
        ?.printTimeLeft
        ? Math.ceil(
            payload.progress.printTimeLeft / 60
          )
        : null,
    nozzleTemperature:
      temperatures.tool0
        ?.actual ??
      null,
    nozzleTargetTemperature:
      temperatures.tool0
        ?.target ??
      null,
    bedTemperature:
      temperatures.bed
        ?.actual ??
      null,
    bedTargetTemperature:
      temperatures.bed
        ?.target ??
      null,
    file:
      payload?.job
        ?.file
        ?.name ||
      null,
    raw:
      payload
  }
}

export const octoprintAdapter = {
  protocol:
    'octoprint',

  capabilities: {
    status: true,
    pause: true,
    resume: true,
    cancel: true,
    disconnect: true,
    upload: true,
    startPrint: true
  },

  async connect(
    printer,
    options = {}
  ) {
    const baseUrl =
      buildBaseUrl(
        printer
      )

    const apiKey =
      String(
        options.apiKey ||
          ''
      ).trim()

    console.log(
      `[OctoPrint] Conectando em ${baseUrl}...`
    )

    const response =
      await axios.get(
        `${baseUrl}/api/version`,
        {
          timeout: 8000,
          headers: {
            'X-Api-Key':
              apiKey
          }
        }
      )

    return {
      connected:
        true,
      protocol:
        'octoprint',
      printer,
      baseUrl,
      apiKey,
      version:
        response.data,
      connectedAt:
        new Date()
    }
  },

  async disconnect(
    connection
  ) {
    if (connection) {
      connection.connected =
        false
    }

    return {
      disconnected:
        true
    }
  },

  async getStatus(
    connection
  ) {
    requireConnection(
      connection
    )

    const response =
      await axios.get(
        `${connection.baseUrl}/api/job`,
        {
          timeout: 8000,
          headers:
            headers(
              connection
            )
        }
      )

    const temperature =
      await axios.get(
        `${connection.baseUrl}/api/printer`,
        {
          timeout: 8000,
          headers:
            headers(
              connection
            )
        }
      )

    return normalizeStatus(
      {
        ...response.data,
        temperature:
          temperature.data
            ?.temperature
      },
      connection.printer
    )
  },

  async startPrint(
    connection,
    job
  ) {
    requireConnection(
      connection
    )

    const printFile =
      getPrintFile(
        job
      )

    const form =
      new FormData()

    form.append(
      'file',
      fs.createReadStream(
        printFile.localPath
      ),
      printFile.name
    )

    form.append(
      'select',
      'true'
    )

    form.append(
      'print',
      'true'
    )

    const response =
      await axios.post(
        `${connection.baseUrl}/api/files/local`,
        form,
        {
          timeout: 120_000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: {
            ...headers(
              connection
            ),
            ...form.getHeaders()
          }
        }
      )

    return {
      success:
        true,
      uploaded:
        true,
      started:
        true,
      file:
        printFile.name,
      response:
        response.data
    }
  },

  async pause(
    connection
  ) {
    requireConnection(
      connection
    )

    await axios.post(
      `${connection.baseUrl}/api/job`,
      {
        command:
          'pause',
        action:
          'pause'
      },
      {
        timeout: 8000,
        headers:
          headers(
            connection
          )
      }
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

    await axios.post(
      `${connection.baseUrl}/api/job`,
      {
        command:
          'pause',
        action:
          'resume'
      },
      {
        timeout: 8000,
        headers:
          headers(
            connection
          )
      }
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

    await axios.post(
      `${connection.baseUrl}/api/job`,
      {
        command:
          'cancel'
      },
      {
        timeout: 8000,
        headers:
          headers(
            connection
          )
      }
    )

    return {
      success:
        true
    }
  }
}
