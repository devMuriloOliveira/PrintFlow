import axios from 'axios'

export const verifyAgent = async (apiUrl, credentials) => {
  const response = await axios.post(
    `${apiUrl}/api/agents/verify`,
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