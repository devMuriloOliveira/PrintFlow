import { cloudHttp } from './httpClient.js'
export { reportPrintJobMetrics } from './productionJobMetrics.js'
export { uploadSlicedPrintArtifact } from './productionJobSlicing.js'

// ======================================================
// HEARTBEAT
// ======================================================

export const sendHeartbeat = async (
  apiUrl,
  credentials,
  runtimeInfo = {}
) => {
  const response = await cloudHttp.post(
    `${apiUrl}/api/agents/heartbeat`,
    runtimeInfo,
    {
      headers: {
        'x-agent-id': credentials.agentId,
        'x-agent-secret': credentials.agentSecret,
        'Content-Type': 'application/json'
      }
    }
  )

  return response.data
}

// ======================================================
// BUSCAR COMANDO PENDENTE
// ======================================================

export const getPendingCommand = async (
  apiUrl,
  credentials
) => {
  const response = await cloudHttp.get(
    `${apiUrl}/api/agents/commands/pending`,
    {
      headers: {
        'x-agent-id': credentials.agentId,
        'x-agent-secret': credentials.agentSecret
      }
    }
  )

  return response.data.command
}

export const completeCommand = async (
  apiUrl,
  credentials,
  commandId,
  result
) => {
  const response = await cloudHttp.post(
    `${apiUrl}/api/agents/commands/${commandId}/complete`,
    {
      success: result.success !== false,

      result
    },
    {
      headers: {
        'x-agent-id': credentials.agentId,
        'x-agent-secret': credentials.agentSecret,
        'Content-Type': 'application/json'
      }
    }
  )

  return response.data
}

export const reportCommandProgress = async (apiUrl, credentials, commandId, progress) => {
  const response = await cloudHttp.post(
    `${apiUrl}/api/agents/commands/${commandId}/progress`,
    { progress },
    {
      headers: {
        'x-agent-id': credentials.agentId,
        'x-agent-secret': credentials.agentSecret,
        'Content-Type': 'application/json'
      }
    }
  )
  return response.data
}

export const syncAgentEvents = async (
  apiUrl,
  credentials,
  events = []
) => {
  if (!events.length) {
    return {
      accepted:
        0
    }
  }

  const response =
    await cloudHttp.post(
      `${apiUrl}/api/agents/sync-events`,
      {
        events
      },
      {
        headers: {
          'x-agent-id':
            credentials.agentId,
          'x-agent-secret':
            credentials.agentSecret,
          'Content-Type':
            'application/json'
        }
      }
    )

  return response.data
}

export const rotateAgentCredential = async (apiUrl, credentials) => {
  const response = await cloudHttp.post(`${apiUrl}/api/agents/credential/rotate`, {}, { headers: { 'x-agent-id': credentials.agentId, 'x-agent-secret': credentials.agentSecret } })
  return response.data
}

export const confirmAgentCredentialRotation = async (apiUrl, credentials) => {
  const response = await cloudHttp.post(`${apiUrl}/api/agents/credential/rotate/confirm`, {}, { headers: { 'x-agent-id': credentials.agentId, 'x-agent-secret': credentials.agentSecret } })
  return response.data
}
