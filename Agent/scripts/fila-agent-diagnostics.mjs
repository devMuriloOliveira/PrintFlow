import { readDiagnosticsToken } from '../src/storage/diagnosticsToken.js'

const port = Number(process.env.FILA_AGENT_LOCAL_PORT || process.env.PRINTFLOW_AGENT_LOCAL_PORT || 17873)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PRINTFLOW_AGENT_LOCAL_PORT invalida.')
}

const token = await readDiagnosticsToken()
const response = await fetch(`http://127.0.0.1:${port}/diagnostics`, {
  headers: {
    'x-fila-agent-diagnostics-token': token
  },
  signal: AbortSignal.timeout(5_000)
})

if (!response.ok) {
  const body = await response.json().catch(() => ({}))
  throw new Error(body.error || `Diagnostico local indisponivel (${response.status}).`)
}

console.log(JSON.stringify(await response.json(), null, 2))
