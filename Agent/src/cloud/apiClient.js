import axios from 'axios'

// ======================================================
// HEARTBEAT
// ======================================================

export const sendHeartbeat = async (
  apiUrl,
  credentials
) => {
  const response = await axios.post(
    `${apiUrl}/api/agents/heartbeat`,
    null,
    {
      headers: {
        'x-agent-id': credentials.agentId,
        'x-agent-secret': credentials.agentSecret
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
  const response = await axios.get(
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
  const response = await axios.post(
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