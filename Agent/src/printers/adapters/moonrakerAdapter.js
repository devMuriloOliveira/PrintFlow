import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import FormData from 'form-data'

const buildBaseUrl = (
  printer
) =>
  `http://${printer.ip}:${printer.port || 7125}`

const headers = (
  connection
) => {
  if (
    !connection.apiKey
  ) {
    return {}
  }

  return {
    Authorization:
      `Bearer ${connection.apiKey}`
  }
}

const requireConnection = (
  connection
) => {
  if (
    !connection?.connected
  ) {
    throw new Error(
      'Moonraker nao esta conectado.'
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
      'Arquivo local nao encontrado para envio ao Moonraker.'
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

const getObject = (
  payload,
  name
) =>
  payload?.result
    ?.status
    ?.[name] ||
  {}

const normalizeStatus = (
  payload,
  printer
) => {
  const printStats =
    getObject(
      payload,
      'print_stats'
    )

  const displayStatus =
    getObject(
      payload,
      'display_status'
    )

  const extruder =
    getObject(
      payload,
      'extruder'
    )

  const heaterBed =
    getObject(
      payload,
      'heater_bed'
    )

  return {
    connected:
      true,
    protocol:
      'moonraker',
    manufacturer:
      printer?.manufacturer ||
      null,
    name:
      printer?.name ||
      'Moonraker / Klipper',
    ip:
      printer?.ip,
    port:
      printer?.port,
    state:
      printStats.state ||
      'unknown',
    progress:
      Number.isFinite(
        Number(displayStatus.progress)
      )
        ? Math.round(
            Number(displayStatus.progress) * 100
          )
        : null,
    remainingMinutes:
      null,
    nozzleTemperature:
      extruder.temperature ??
      null,
    nozzleTargetTemperature:
      extruder.target ??
      null,
    bedTemperature:
      heaterBed.temperature ??
      null,
    bedTargetTemperature:
      heaterBed.target ??
      null,
    file:
      printStats.filename ||
      null,
    raw:
      payload
  }
}

export const moonrakerAdapter = {
  protocol:
    'moonraker',

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
      `[Moonraker] Conectando em ${baseUrl}...`
    )

    const response =
      await axios.get(
        `${baseUrl}/server/info`,
        {
          timeout: 8000,
          headers:
            apiKey
              ? {
                  Authorization:
                    `Bearer ${apiKey}`
                }
              : {}
        }
      )

    return {
      connected:
        true,
      protocol:
        'moonraker',
      printer,
      baseUrl,
      apiKey,
      info:
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
        `${connection.baseUrl}/printer/objects/query?print_stats&display_status&extruder&heater_bed`,
        {
          timeout: 8000,
          headers:
            headers(
              connection
            )
        }
      )

    return normalizeStatus(
      response.data,
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
      'root',
      'gcodes'
    )

    form.append(
      'path',
      printFile.name
    )

    form.append(
      'print',
      'true'
    )

    if (
      job?.printFile
        ?.hash
    ) {
      form.append(
        'checksum',
        job.printFile.hash
      )
    }

    form.append(
      'file',
      fs.createReadStream(
        printFile.localPath
      ),
      printFile.name
    )

    const response =
      await axios.post(
        `${connection.baseUrl}/server/files/upload`,
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
      `${connection.baseUrl}/printer/print/pause`,
      {},
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
      `${connection.baseUrl}/printer/print/resume`,
      {},
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
      `${connection.baseUrl}/printer/print/cancel`,
      {},
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
