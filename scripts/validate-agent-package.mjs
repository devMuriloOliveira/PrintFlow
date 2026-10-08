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
    'start',
    'start:tray',
    'dev',
    'install:agent',
    'uninstall:agent'
  ]) {
    if (!packageJson.scripts?.[script]) {
      errors.push(
        `script obrigatorio ausente: ${script}`
      )
    }
  }

  for (const script of ['start', 'start:tray', 'dev', 'build:windows', 'build:windows:dev-signed', 'install:agent', 'uninstall:agent']) {
    if (/powershell|\.ps1/i.test(packageJson.scripts?.[script] || '')) {
      errors.push(`script ${script} ainda depende de PowerShell.`)
    }
  }

  for (const script of ['start', 'start:tray', 'dev', 'build:windows', 'build:windows:dev-signed']) {
    if (!packageJson.scripts?.[script]?.includes('dotnet')) {
      errors.push(`script ${script} nao inicia o runtime/ferramentas C#.`)
    }
  }

  if (!packageJson.scripts?.['install:agent']?.includes('npm run build:windows') ||
      !packageJson.scripts?.['install:agent']?.includes('Fila-Agent-Setup.exe')) {
    errors.push('install:agent deve reconstruir o instalador C# antes de executa-lo.')
  }
  if (!packageJson.scripts?.['uninstall:agent']?.includes('%LOCALAPPDATA%') ||
      !packageJson.scripts?.['uninstall:agent']?.includes('PrintFlowAgent\\FilaAgentSetup.exe') ||
      !packageJson.scripts?.['uninstall:agent']?.includes('--uninstall')) {
    errors.push('uninstall:agent deve usar o setup C# da instalacao atual, nao um binario antigo em dist.')
  }

  const agentVersionSource = await fs.readFile(
    path.join(agentRoot, 'src/config/agentVersion.js'),
    'utf8'
  )
  const declaredVersion = agentVersionSource.match(
    /AGENT_VERSION\s*=\s*['"]([^'"]+)['"]/i
  )?.[1]
  if (declaredVersion !== packageJson.version) {
    errors.push(
      `agentVersion.js e package.json divergem (${declaredVersion || 'ausente'} vs ${packageJson.version}).`
    )
  }
}

for (const relativePath of [
  'windows-release-tool/FilaAgent.ReleaseTool.csproj',
  'windows-release-tool/Program.cs',
  'windows-release-tool/AuthenticodeVerificationPolicy.cs',
  'windows-setup/Program.cs',
  'windows-setup/FilaAgentSetup.csproj',
  'windows-host/FilaAgent.csproj',
  'windows-host/Program.cs',
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
  const installer = await fs.readFile(path.join(agentRoot, 'windows-setup/Program.cs'), 'utf8')
  if (!installer.includes('EnsureNoActivePrintJobs(root, localPort)') || !installer.includes('Directory.Move(root, backup)')) {
    errors.push('setup C# nao verifica impressoes e cria backup antes de atualizar a instalacao.')
  }
  if (!installer.includes('removeUserData') ||
      !installer.includes('args.Contains("--remove-user-data"') ||
      !installer.includes('DeleteDirectory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)')) {
    errors.push('desinstalador C# nao limita a remocao de dados a escolha explicita do usuario.')
  }

  const setupProject = await fs.readFile(path.join(agentRoot, 'windows-setup/FilaAgentSetup.csproj'), 'utf8')
  const hostProject = await fs.readFile(path.join(agentRoot, 'windows-host/FilaAgent.csproj'), 'utf8')
  if (!hostProject.includes('<AssemblyName>FilaAgent</AssemblyName>') ||
      !setupProject.includes('<AssemblyName>FilaAgentSetup</AssemblyName>')) {
    errors.push('projetos C# ainda geram executaveis com os nomes antigos.')
  }
  const consent = await fs.readFile(path.join(agentRoot, 'windows-setup/SetupConsentForm.cs'), 'utf8')
  const terms = await fs.readFile(path.join(agentRoot, 'legal/TERMOS-DE-USO-FILA-AGENT.txt'), 'utf8')
  const notices = await fs.readFile(path.join(agentRoot, 'legal/THIRD-PARTY-NOTICES.txt'), 'utf8')
  if (!setupProject.includes('FilaAgentSetup.ThirdParty.00-Overview.txt') ||
      !setupProject.includes('legal\\third-party\\*.txt') ||
      !consent.includes('Licenças de terceiros') ||
      !consent.includes('ThirdPartyLicensesForm') ||
      !installer.includes('TermsVersion = "1.3"') ||
      !terms.includes('Versão 1.3')) {
    errors.push('setup nao mostra licencas de terceiros antes da instalacao ou nao versiona os termos atualizados.')
  }
  for (const file of [
    'LICENSE-APACHE-2.0.txt',
    'LICENSE-BouncyCastle.txt',
    'LICENSE-DotNet-MIT.txt',
    'LICENSE-DotNet-Runtime.txt',
    'DOTNET-THIRD-PARTY-NOTICES.txt',
    'LICENSE-FluentFTP.txt',
    'LICENSE-MQTTnet.txt',
    'NOTICE-SQLitePCLRaw.txt'
  ]) {
    try {
      await fs.access(path.join(agentRoot, 'legal/third-party', file))
    } catch {
      errors.push(`aviso/licenca de dependencias ausente: Agent/legal/third-party/${file}`)
    }
  }
  for (const component of ['BouncyCastle.Cryptography 2.7.0', 'FluentFTP 55.0.0', 'MQTTnet 5.2.0.1603', 'SQLitePCLRaw.lib.e_sqlite3 2.1.12', 'OrcaSlicer is not included']) {
    if (!notices.includes(component)) errors.push(`THIRD-PARTY-NOTICES.txt sem ${component}.`)
  }

  const packageBuilder = await fs.readFile(path.join(agentRoot, 'windows-release-tool/Program.cs'), 'utf8')
  const signaturePolicy = await fs.readFile(path.join(agentRoot, 'windows-release-tool/AuthenticodeVerificationPolicy.cs'), 'utf8')
  if (!packageBuilder.includes('uri.Scheme != Uri.UriSchemeHttps') || !packageBuilder.includes('uri.IsLoopback')) {
    errors.push('builder do pacote nao bloqueia endpoint local/inseguro em Production.')
  }
  if (
    !packageBuilder.includes('windows-runtime-live-smoke') ||
    !packageBuilder.includes('runtime = ".NET 8 self-contained"') ||
    !packageBuilder.includes('selfContained = true') ||
    !packageBuilder.includes('ValidateReleaseFiles') ||
    !packageBuilder.includes('--property:FilaAgentPackagePath=') ||
    !packageBuilder.includes('--validate-embedded-package')
  ) {
    errors.push('builder nao cria payload C# autocontido ou ainda empacota o runtime legado.')
  }
  if (!packageBuilder.includes('ExpectedCertificateSha256') || !packageBuilder.includes('TimestampUrl') ||
      !packageBuilder.includes('"/sha1"') || !packageBuilder.includes('"/fd", "SHA256"') ||
      !packageBuilder.includes('"/tr"') || !packageBuilder.includes('"/td", "SHA256"')) {
    errors.push('builder Early Access nao fixa certificado e timestamp da assinatura Authenticode.')
  }
  if (!packageBuilder.includes('AuthenticodeVerificationPolicy.IsAcceptable') ||
      !signaturePolicy.includes('exitCode != 1') ||
      !signaturePolicy.includes('ExpectedUntrustedRootMessage') ||
      !signaturePolicy.includes('hash mismatch')) {
    errors.push('builder nao limita falha tolerada de assinatura ao certificado Early Access sem raiz confiavel.')
  }
  if (/powershell|iexpress/i.test(packageBuilder)) {
    errors.push('builder C# ainda depende de PowerShell ou IExpress.')
  }
  for (const fragment of ['validate-release', 'prepare-release', 'publish-release', 'ValidateTagAndMinimum', 'SHA256SUMS.txt']) {
    if (!packageBuilder.includes(fragment)) errors.push(`ReleaseTool C# sem etapa ${fragment}.`)
  }

  const updater = await fs.readFile(
    path.join(agentRoot, 'windows-setup/SignedUpdateService.cs'),
    'utf8'
  )
  const host = await fs.readFile(path.join(agentRoot, 'windows-host/Program.cs'), 'utf8')
  if (!host.includes('"FilaAgentSetup.exe"') || !host.includes('"PrintFlowAgentSetup.exe"')) {
    errors.push('host deve preferir o setup Fila e manter fallback apenas para completar a transicao do instalador anterior.')
  }
  if (
    !updater.includes('ValidatePackage(updatesRoot, latest.ToString(), setupName, certificateName)') ||
    !updater.includes('AuthenticodeTrust.Verify') ||
    !updater.includes('.NET 8 self-contained') ||
    !updater.includes('WaitForHealthAsync(latest.ToString(), requirePaired: true')
  ) {
    errors.push('atualizador C# nao valida release assinada e health apos atualizar.')
  }

  const releaseWorkflow = await fs.readFile(
    path.join(root, '.github/workflows/agent-release.yml'),
    'utf8'
  )
  const releaseRunSteps = releaseWorkflow.match(/^\s{8}run:/gm)?.length ?? 0
  const releaseCmdSteps = releaseWorkflow.match(/^\s{8}shell:\s*cmd\s*$/gm)?.length ?? 0
  if (
    !releaseWorkflow.includes('FILA_AGENT_DEV_CERT_PFX_BASE64') ||
    !releaseWorkflow.includes('PRINTFLOW_AGENT_DEV_CERT_PFX_BASE64') ||
    !releaseWorkflow.includes("FILA_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.10'") ||
    !releaseWorkflow.includes('--sign-dev') ||
    !releaseWorkflow.includes('--require-persisted-certificate') ||
    !releaseWorkflow.includes('prepare-release') ||
    !releaseWorkflow.includes('publish-release') ||
    !releaseWorkflow.includes('FilaAgent.ReleaseTool.csproj') ||
    releaseRunSteps === 0 ||
    releaseRunSteps !== releaseCmdSteps ||
    /shell:\s*(?:pwsh|powershell)/i.test(releaseWorkflow) ||
    /\.ps1|\.psm1|\.vbs|iexpress/i.test(releaseWorkflow)
  ) {
    errors.push('workflow de release nao usa o ReleaseTool C# com assinatura e publicacao sem PowerShell.')
  }

  const ciWorkflow = await fs.readFile(
    path.join(root, '.github/workflows/ci.yml'),
    'utf8'
  )
  if (!ciWorkflow.includes('FilaAgent.ReleaseTool.csproj') ||
      !ciWorkflow.includes('FilaAgent.Runtime.ContractTests.csproj') ||
      !ciWorkflow.includes('Fila-Agent-Setup.exe --validate-embedded-package') ||
      !/^on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- '\*\*'/m.test(ciWorkflow) ||
      /shell:\s*(?:pwsh|powershell)/i.test(ciWorkflow) ||
      /\.ps1|\.psm1|\.vbs|iexpress/i.test(ciWorkflow)) {
    errors.push('CI do Agent nao compila o ReleaseTool, exercita contratos C# no Windows e empacota sem PowerShell.')
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
    'certs',
    'temp',
    'bin',
    'obj'
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

    if (entry.isFile() && /\.(?:ps1|psm1|vbs)$/i.test(entry.name)) {
      errors.push(`script PowerShell/WSH legado no Agent: Agent/${relativePath}`)
      continue
    }

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
    } else if (/\.(?:js|mjs|cjs|json|md)$/i.test(entry.name)) {
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
