import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, '.github', 'workflows', 'agent-release.yml')
const workflow = await fs.readFile(workflowPath, 'utf8')
const required = [
  "- 'agent-v*'",
  'PRINTFLOW_API_URL',
  "PRINTFLOW_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.10'",
  'npm test',
  'build-windows-package.ps1',
  'Get-FileHash',
  'SHA256SUMS.txt',
  'RELEASE-METADATA.json',
  'certificateSha256',
  'validate-agent-release-artifacts.mjs',
  'DEV_SELF_SIGNED',
  'PRODUCTION_TRUSTED',
  'gh release create',
  'PrintFlow-Agent-Transition-Setup.exe',
  'Copy-Item',
  'install-windows-agent-from-package.ps1'
]

const missing = required.filter(fragment => !workflow.includes(fragment))
if (missing.length) {
  console.error(`Agent release contract invalido; ausentes: ${missing.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`Agent release contract valid (${required.length} checks; estatico).`)
}
