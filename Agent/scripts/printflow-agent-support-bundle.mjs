import { writeSupportBundle } from '../src/runtime/supportBundle.js'
import { readDiagnosticsToken } from '../src/storage/diagnosticsToken.js'

const outputPath = process.argv[2]
if (!outputPath) {
  throw new Error('Uso: node scripts/printflow-agent-support-bundle.mjs <arquivo.json>')
}

const port = Number(process.env.PRINTFLOW_AGENT_LOCAL_PORT || 17873)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PRINTFLOW_AGENT_LOCAL_PORT invalida.')
}

const token = await readDiagnosticsToken()
const response = await fetch(`http://127.0.0.1:${port}/diagnostics`, {
  headers: { 'x-printflow-diagnostics-token': token },
  signal: AbortSignal.timeout(5_000)
})

if (!response.ok) {
  const body = await response.json().catch(() => ({}))
  throw new Error(body.error || `Diagnostico local indisponivel (${response.status}).`)
}

const result = await writeSupportBundle(outputPath, await response.json())
console.log(`Pacote de suporte criado: ${result.path} (${result.bytes} bytes).`)
