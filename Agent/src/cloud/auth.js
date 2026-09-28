import { cloudHttp } from './httpClient.js'

export const verifyAgent = async (apiUrl, credentials) => {
  const response = await cloudHttp.post(
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

export const isInvalidAgentCredentialError = error => {
  const status = Number(error?.response?.status)
  const message = String(
    error?.response?.data?.error ||
      error?.message ||
      ''
  )

  return [401, 404].includes(status) ||
    /agent invalido/i.test(message)
}
