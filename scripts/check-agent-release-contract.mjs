import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, '.github', 'workflows', 'agent-release.yml')
const workflow = await fs.readFile(workflowPath, 'utf8')
const releaseVerifier = await fs.readFile(
  path.join(root, 'Agent', 'src', 'updates', 'releaseVerifier.js'),
  'utf8'
)
const releasePublisher = await fs.readFile(
  path.join(root, 'Agent', 'scripts', 'publish-windows-agent-release.ps1'),
  'utf8'
)
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
  'PrintFlow-Agent-Transition-Setup.exe',
  'Copy-Item',
  'install-windows-agent-from-package.ps1'
]

const missing = required.filter(fragment => !workflow.includes(fragment))
if (!releaseVerifier.includes('DEV_SELF_SIGNED') || !releaseVerifier.includes('PRODUCTION_TRUSTED')) {
  missing.push('modos de assinatura DEV_SELF_SIGNED/PRODUCTION_TRUSTED no verificador')
}
if (!releasePublisher.includes('gh release create')) {
  missing.push('gh release create no publicador de releases')
}
if (missing.length) {
  console.error(`Agent release contract invalido; ausentes: ${missing.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`Agent release contract valid (${required.length} checks; estatico).`)
}
