import { cloudHttp } from './httpClient.js'

export const reportPrintJobMetrics = async (apiUrl, credentials, printJobId, metrics) => {
  const response = await cloudHttp.post(
    `${apiUrl}/api/agents/print-jobs/${encodeURIComponent(printJobId)}/metrics`,
    metrics,
    { headers: { 'x-agent-id': credentials.agentId, 'x-agent-secret': credentials.agentSecret, 'Content-Type': 'application/json' } }
  )
  return response.data
}
