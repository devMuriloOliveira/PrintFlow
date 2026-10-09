import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = await fs.readFile(path.join(root, '.github', 'workflows', 'agent-release.yml'), 'utf8')
const releaseTool = await fs.readFile(path.join(root, 'Agent', 'windows-release-tool', 'Program.cs'), 'utf8')
const releaseVerifier = await fs.readFile(path.join(root, 'Agent', 'src', 'updates', 'releaseVerifier.js'), 'utf8')
const requiredWorkflow = [
  "- 'agent-v*'",
  'FILA_AGENT_API_URL',
  "FILA_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.10'",
  'npm test',
  'windows-release-tool\\FilaAgent.ReleaseTool.csproj',
  '--sign-dev',
  '--require-persisted-certificate',
  '--output-dir dist',
  'export-dev-certificate',
  'working-directory: Agent',
  'prepare-release',
  'publish-release',
  'FILA_AGENT_DEV_CERT_PFX_BASE64',
  'FILA_AGENT_DEV_CERT_PASSWORD',
  'PRINTFLOW_AGENT_DEV_CERT_PFX_BASE64',
  'PRINTFLOW_AGENT_DEV_CERT_PASSWORD',
  'shell: cmd'
]
const requiredReleaseTool = [
  'ValidateTagAndMinimum',
  'SHA256SUMS.txt',
  'RELEASE-METADATA.json',
  'certificateSha256',
  'ExportDevCertificateAsync',
  'ExportVerifiedSignerCertificateAsync',
  'VerifyPackagedHostMatchesSignedBuildAsync',
  'validate-agent-release-artifacts.mjs',
  'PrintFlow-Agent-Transition-Setup.exe',
  '"release", "create"',
  '"--verify-tag"'
]

const missing = [
  ...requiredWorkflow.filter(fragment => !workflow.includes(fragment)),
  ...requiredReleaseTool.filter(fragment => !releaseTool.includes(fragment))
]
if (!releaseVerifier.includes('DEV_SELF_SIGNED') || !releaseVerifier.includes('PRODUCTION_TRUSTED')) {
  missing.push('modos de assinatura DEV_SELF_SIGNED/PRODUCTION_TRUSTED no verificador')
}
if (/shell:\s*(?:pwsh|powershell)|\.ps1|\.psm1|\.vbs|iexpress/i.test(workflow)) {
  missing.push('workflow ainda depende de PowerShell/IExpress')
}
const signedHostAt = releaseTool.indexOf('await SignAsync(agentRoot, options.CertificatePfx, certificatePath!, [hostExecutable])')
const zipCreationAt = releaseTool.indexOf('ZipFile.CreateFromDirectory(stageRoot, zipPath')
if (signedHostAt < 0 || zipCreationAt < 0 || signedHostAt > zipCreationAt) {
  missing.push('host precisa ser assinado antes de entrar no ZIP distribuido')
}
const windowsRunSteps = workflow.match(/^\s{8}run:/gm)?.length ?? 0
const explicitCmdSteps = workflow.match(/^\s{8}shell:\s*cmd\s*$/gm)?.length ?? 0
if (windowsRunSteps === 0 || windowsRunSteps !== explicitCmdSteps) {
  missing.push('cada passo run do workflow Windows precisa declarar shell: cmd')
}
for (const name of ['Build package and prepare Early Access release', 'Publish Early Access release']) {
  const stepStart = workflow.indexOf(`      - name: ${name}`)
  const nextStep = stepStart < 0 ? -1 : workflow.indexOf('\n      - name:', stepStart + 1)
  const step = stepStart < 0 ? '' : workflow.slice(stepStart, nextStep < 0 ? undefined : nextStep)
  if (!/^        working-directory:\s*Agent\s*$/m.test(step)) {
    missing.push(`passo ${name} precisa executar na mesma pasta Agent`)
  }
}
const packageAndMetadataStart = workflow.indexOf('      - name: Build package and prepare Early Access release')
const packageAndMetadataEnd = packageAndMetadataStart < 0 ? -1 : workflow.indexOf('\n      - name:', packageAndMetadataStart + 1)
const packageAndMetadataStep = packageAndMetadataStart < 0 ? '' : workflow.slice(packageAndMetadataStart, packageAndMetadataEnd < 0 ? undefined : packageAndMetadataEnd)
const packageCommandAt = packageAndMetadataStep.indexOf('FilaAgent.ReleaseTool.dll package')
const certificateExportAt = packageAndMetadataStep.indexOf('FilaAgent.ReleaseTool.dll export-dev-certificate')
const certificateGuardAt = packageAndMetadataStep.indexOf('dist\\Fila-Agent-Dev-Certificate.cer')
const metadataCommandAt = packageAndMetadataStep.indexOf('FilaAgent.ReleaseTool.dll prepare-release')
if (packageCommandAt < 0 || certificateExportAt < packageCommandAt || certificateGuardAt < certificateExportAt || metadataCommandAt < certificateGuardAt) {
  missing.push('pacote assinado deve reexportar/verificar o certificado antes de preparar metadados no mesmo passo')
}
if (workflow.includes('dotnet run --project') || !workflow.includes('dotnet build Agent\\windows-release-tool\\FilaAgent.ReleaseTool.csproj')) {
  missing.push('release deve compilar uma vez e executar o DLL C# com argumentos diretos')
}
if (missing.length) {
  console.error(`Agent release contract invalido; ausentes: ${missing.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`Agent release contract valid (${requiredWorkflow.length + requiredReleaseTool.length + 2} checks; C# release tool).`)
}
