import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(import.meta.url)
    ),
    '..'
  )
const agentRoot =
  path.join(root, 'Agent')
const packageJsonPath =
  path.join(agentRoot, 'package.json')
const lockPath =
  path.join(agentRoot, 'package-lock.json')

const errors = []

const readJson = async filePath => {
  try {
    return JSON.parse(
      await fs.readFile(filePath, 'utf8')
    )
  } catch (error) {
    errors.push(
      `${path.relative(root, filePath)}: ${error.message}`
    )
    return null
  }
}

const packageJson =
  await readJson(packageJsonPath)
const lockJson =
  await readJson(lockPath)

if (packageJson && lockJson) {
  if (
    packageJson.name !==
    lockJson.name ||
    packageJson.version !==
    lockJson.version
  ) {
    errors.push(
      'package.json e package-lock.json divergem em nome/versao.'
    )
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(packageJson.version || ''))) {
    errors.push('versao do Agent nao segue Semantic Versioning.')
  }

  for (const script of [
    'build:windows',
    'build:windows:dev-signed',
    'start:tray'
  ]) {
    if (!packageJson.scripts?.[script]) {
      errors.push(
        `script obrigatorio ausente: ${script}`
      )
    }
  }
}

for (const relativePath of [
  'scripts/build-windows-package.ps1',
  'scripts/start-windows-agent-tray.ps1',
  'scripts/install-windows-agent.ps1',
  'src/index.js',
  'src/config/agentVersion.js',
  'src/cloud/productionJobMetrics.js',
  'src/cloud/productionJobSlicing.js',
  'src/printing/productionJobMonitor.js',
  'src/slicing/prepareProductionJob.js',
  'src/updates/releaseVerifier.js',
  'src/storage/localOperationsDb.js'
]) {
  try {
    await fs.access(
      path.join(agentRoot, relativePath)
    )
  } catch {
    errors.push(
      `arquivo obrigatorio ausente: Agent/${relativePath}`
    )
  }
}

try {
  const installer =
    await fs.readFile(
      path.join(
        agentRoot,
        'scripts/install-windows-agent.ps1'
      ),
      'utf8'
    )

  if (!installer.includes('Stop-ExistingAgentInstall')) {
    errors.push(
      'installer não interrompe explicitamente a instalação anterior.'
    )
  }

  if (
    /Remove-Item[\s\S]{0,160}\$installRoot/i.test(
      installer
    )
  ) {
    errors.push(
      'installer contém remoção ampla do diretório de instalação.'
    )
  }

  const trayLauncher = await fs.readFile(
    path.join(agentRoot, 'scripts/start-windows-agent-tray.ps1'),
    'utf8'
  )
  if (!trayLauncher.includes('PRINTFLOW_ENVIRONMENT')) {
    errors.push('launcher de Production nao define PRINTFLOW_ENVIRONMENT.')
  }

  const packageBuilder = await fs.readFile(
    path.join(agentRoot, 'scripts/build-windows-package.ps1'),
    'utf8'
  )
  if (!packageBuilder.includes('apiUri.Scheme -ne "https"') || !packageBuilder.includes('localhost')) {
    errors.push('builder do pacote nao bloqueia endpoint local/inseguro em Production.')
  }

  const devSigner = await fs.readFile(
    path.join(agentRoot, 'scripts/sign-windows-agent-dev.ps1'),
    'utf8'
  )
  if (/TrustedPublisher|X509Store\s*\(\s*["']Root/i.test(devSigner)) {
    errors.push('assinatura DEV instala certificado silenciosamente como confiavel.')
  }
  if (
    !devSigner.includes('https://timestamp.digicert.com') &&
    !devSigner.includes('http://timestamp.digicert.com')
  ) {
    errors.push('assinatura DEV deve usar timestamp DigiCert RFC 3161.')
  }

  const copyItems =
    installer.match(
      /\$items\s*=\s*@\(([^)]*)\)/i
    )?.[1] || ''

  if (
    /\b(?:data|agent\.json|agent-operations\.sqlite|cache|logs)\b/i.test(
      copyItems
    )
  ) {
    errors.push(
      'installer tenta copiar/sobrescrever dados locais do Agent.'
    )
  }

  const updater = await fs.readFile(
    path.join(agentRoot, 'scripts/update-windows-agent.ps1'),
    'utf8'
  )
  if (
    !updater.includes('Save-AgentBinaryBackup') ||
    !updater.includes('Restore-AgentBinaryBackup') ||
    !updater.includes('Rollback dos binarios concluido')
  ) {
    errors.push('atualizador nao possui rollback explicito dos binarios.')
  }
} catch (error) {
  errors.push(
    `falha ao validar política do installer: ${error.message}`
  )
}

const forbiddenNames =
  /(^|\/)(?:agent\.json|printer-credentials\.json|.*\.(?:sqlite|sqlite3|db))(?:$|\/)/i
const ignoredDirectories =
  new Set([
    'node_modules',
    'dist',
    '.git',
    'data',
    'certs'
  ])

const walk = async directory => {
  let entries
  try {
    entries = await fs.readdir(
      directory,
      {
        withFileTypes: true
      }
    )
  } catch {
    return
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      ignoredDirectories.has(entry.name)
    ) {
      continue
    }

    const absolutePath =
      path.join(directory, entry.name)
    const relativePath =
      path.relative(
        agentRoot,
        absolutePath
      ).replace(/\\/g, '/')

    if (
      entry.name === '.env' ||
      entry.name.startsWith('.env.') ||
      /\.(?:pfx|p12|pem|key)$/i.test(entry.name)
    ) {
      continue
    }

    if (forbiddenNames.test(relativePath)) {
      errors.push(
        `arquivo proibido no pacote: Agent/${relativePath}`
      )
      continue
    }

    if (entry.isDirectory()) {
      await walk(absolutePath)
    }
  }
}

await walk(agentRoot)

const sourceFiles = []
const collectSourceFiles = async directory => {
  const entries = await fs.readdir(
    directory,
    {
      withFileTypes: true
    }
  )
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      ignoredDirectories.has(entry.name)
    ) {
      continue
    }
    const absolutePath =
      path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectSourceFiles(absolutePath)
    } else if (/\.(?:js|mjs|cjs|json|ps1|md)$/i.test(entry.name)) {
      sourceFiles.push(absolutePath)
    }
  }
}

await collectSourceFiles(agentRoot)

for (const filePath of sourceFiles) {
  const content =
    await fs.readFile(filePath, 'utf8')
  if (/\bDATABASE_URL\b/i.test(content)) {
    errors.push(
      `DATABASE_URL proibida no Agent: Agent/${path.relative(agentRoot, filePath)}`
    )
  }
}

if (errors.length) {
  console.error(
    errors.map(error => `- ${error}`).join('\n')
  )
  process.exitCode = 1
} else {
  console.log(
    `Agent package validation passed (${packageJson?.version || 'unknown'}).`
  )
}
