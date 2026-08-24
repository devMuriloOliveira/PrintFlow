import axios from 'axios'
import fs from 'node:fs/promises'
import path from 'node:path'

const buildBaseUrl = (
  printer
) =>
  `http://${printer.ip}:${printer.port || 80}`

const requireConnection = (
  connection
) => {
  if (
    !connection?.connected
  ) {
    throw new Error(
      'PrusaLink nao esta conectado.'
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
      'Arquivo local nao encontrado para envio ao PrusaLink.'
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

const getJobId = (
  payload
) =>
  payload?.job
    ?.id ??
  payload?.id ??
  payload?.job_id ??
  null

const auth = (
  connection
) => ({
  username:
    connection.username,
  password:
    connection.password
})

const normalizeStatus = (
  payload,
  printer
) => {
  const printerData =
    payload?.printer ||
    payload ||
    {}

  const job =
    payload?.job ||
    {}

  return {
    connected:
      true,
    protocol:
      'prusalink',
    manufacturer:
      'Prusa',
    name:
      printer?.name ||
      'PrusaLink',
    ip:
      printer?.ip,
    port:
      printer?.port,
    state:
      printerData.state ||
      job.state ||
      'unknown',
    progress:
      job.progress ??
      null,
    remainingMinutes:
      job.time_remaining
        ? Math.ceil(
            job.time_remaining / 60
          )
        : null,
    nozzleTemperature:
      printerData.temp_nozzle ??
      printerData.temperature
        ?.tool0
        ?.actual ??
      null,
    nozzleTargetTemperature:
      printerData.target_nozzle ??
      printerData.temperature
        ?.tool0
        ?.target ??
      null,
    bedTemperature:
      printerData.temp_bed ??
      printerData.temperature
        ?.bed
        ?.actual ??
      null,
    bedTargetTemperature:
      printerData.target_bed ??
      printerData.temperature
        ?.bed
        ?.target ??
      null,
    file:
      job.file
        ?.name ||
      job.name ||
      null,
    raw:
      payload
  }
}

export const prusaLinkAdapter = {
  protocol:
    'prusalink',

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

    const username =
      String(
        options.username ||
          'maker'
      ).trim()

    const password =
      String(
        options.password ||
          ''
      ).trim()

    console.log(
      `[PrusaLink] Conectando em ${baseUrl}...`
    )

    const response =
      await axios.get(
        `${baseUrl}/api/version`,
        {
          timeout: 8000,
          auth: {
            username,
            password
          }
        }
      )

    return {
      connected:
        true,
      protocol:
        'prusalink',
      printer,
      baseUrl,
      username,
      password,
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

    const printer =
      await axios.get(
        `${connection.baseUrl}/api/printer`,
        {
          timeout: 8000,
          auth:
            auth(
              connection
            )
        }
      )

    let job = {}

    try {
      const response =
        await axios.get(
          `${connection.baseUrl}/api/job`,
          {
            timeout: 8000,
            auth:
              auth(
                connection
              )
          }
        )

      job =
        response.data
    } catch {
      job = {}
    }

    return normalizeStatus(
      {
        printer:
          printer.data,
        job
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

    const buffer =
      await fs.readFile(
        printFile.localPath
      )

    const encodedName =
      encodeURIComponent(
        printFile.name
      )

    const response =
      await axios.put(
        `${connection.baseUrl}/api/v1/files/local/${encodedName}`,
        buffer,
        {
          timeout: 120_000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          auth:
            auth(
              connection
            ),
          headers: {
            'Content-Type':
              'application/octet-stream',
            'Content-Length':
              buffer.length,
            'Print-After-Upload':
              '?1',
            Overwrite:
              '?1'
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
        response.data ||
        null
    }
  },

  async pause(
    connection
  ) {
    requireConnection(
      connection
    )

    const status =
      await this.getStatus(
        connection
      )

    const jobId =
      getJobId(
        status.raw
      )

    if (!jobId) {
      throw new Error(
        'Nao foi possivel identificar o job ativo no PrusaLink.'
      )
    }

    await axios.put(
      `${connection.baseUrl}/api/v1/job/${jobId}/pause`,
      null,
      {
        timeout: 8000,
        auth:
          auth(
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

    const status =
      await this.getStatus(
        connection
      )

    const jobId =
      getJobId(
        status.raw
      )

    if (!jobId) {
      throw new Error(
        'Nao foi possivel identificar o job ativo no PrusaLink.'
      )
    }

    await axios.put(
      `${connection.baseUrl}/api/v1/job/${jobId}/resume`,
      null,
      {
        timeout: 8000,
        auth:
          auth(
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

    const status =
      await this.getStatus(
        connection
      )

    const jobId =
      getJobId(
        status.raw
      )

    if (!jobId) {
      throw new Error(
        'Nao foi possivel identificar o job ativo no PrusaLink.'
      )
    }

    await axios.delete(
      `${connection.baseUrl}/api/v1/job/${jobId}`,
      {
        timeout: 8000,
        auth:
          auth(
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
