import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const readScript = name =>
  fs.readFile(
    path.join(process.cwd(), 'scripts', name),
    'utf8'
  )

test('build e instalador exigem fatiamento real antes de empacotar ou parar o Agent', async () => {
  const build = await readScript('build-windows-package.ps1')
  const install = await readScript('install-windows-agent.ps1')
  const verifier = await readScript('verify-orca-runtime.mjs')
  const runtimeCheck = await readScript('test-windows-orca-runtime.ps1')
  assert.ok(build.indexOf('scripts/verify-orca-runtime.mjs') < build.indexOf('Compress-Archive'))
  assert.ok(install.indexOf('scripts\\test-windows-orca-runtime.ps1') < install.indexOf('\nStop-ExistingAgentInstall'))
  assert.match(runtimeCheck, /Instalacao cancelada: OrcaSlicer nao conseguiu gerar G-code/)
  assert.match(verifier, /discoverStoreOrcaPath\(\)/)
  assert.ok(install.indexOf('scripts\\ensure-orca-slicer.ps1') < install.indexOf('\nStop-ExistingAgentInstall'))
  assert.match(verifier, /sliceWithOrcaSlicer\(/)
})

test('setup nativo instala o Node empacotado e usa a versao do pacote', async () => {
  const build = await readScript('build-windows-package.ps1')
  const setup = await fs.readFile(path.join(process.cwd(), 'windows-setup', 'Program.cs'), 'utf8')

  assert.match(build, /AppLaunched=\$appLaunched/)
  assert.match(setup, /GetVersion\(Path\.Combine\(root, "package\.json"\)\)/)
  assert.match(setup, /Validador OrcaSlicer ausente no pacote/)
  assert.match(setup, /PrintFlowAgentSetup\.exe/)
  assert.ok(setup.indexOf('Run(node, [verifier], required: false)') < setup.indexOf('Run("winget.exe"'))
})

test('desinstalador preserva dados por padrao e exige escolha explicita para apagar', async () => {
  const uninstall = await readScript('uninstall-windows-agent.ps1')

  assert.match(uninstall, /\[switch\]\$RemoveUserData/)
  assert.match(uninstall, /-DeleteUserData:\$RemoveUserData/)
  assert.match(uninstall, /if \(\$DeleteUserData\)/)
  assert.match(uninstall, /Remover todos os dados locais\?/)
  assert.match(uninstall, /Pareamento e dados locais foram preservados/)
})

test('cadastro do Windows inclui informacoes de versao e instalacao', async () => {
  const install = await readScript('install-windows-agent.ps1')

  for (const property of [
    'DisplayVersion',
    'Publisher',
    'InstallLocation',
    'InstallDate',
    'Comments',
    'VersionMajor',
    'VersionMinor'
  ]) {
    assert.match(install, new RegExp(`"${property}"`))
  }
})

test('inicializacao do Windows tenta recuperar a tarefa e instalador confirma healthz local', async () => {
  const startup = await readScript('install-windows-startup.ps1')
  const install = await readScript('install-windows-agent.ps1')

  assert.match(startup, /-StartWhenAvailable/)
  assert.match(startup, /-RestartCount 5/)
  assert.match(startup, /-RestartInterval \(New-TimeSpan -Minutes 1\)/)
  assert.match(install, /Wait-ForLocalAgent/)
  assert.match(install, /127\.0\.0\.1:17873\/healthz/)
  assert.match(install, /O Agent foi instalado, mas o healthz local ainda nao respondeu/)
})

test('verificacao de atualizacao nao bloqueia a bandeja e possui timeouts', async () => {
  const updater = await readScript('check-and-update-windows-agent.ps1')
  const tray = await readScript('start-windows-agent-tray.ps1')

  assert.match(updater, /-TimeoutSec \$ReleaseTimeoutSec/)
  assert.match(updater, /-TimeoutSec \$ArtifactTimeoutSec/)
  assert.match(updater, /Voce ja esta usando a versao mais recente/)
  assert.match(updater, /'print_connection_lost'/)
  assert.match(updater, /A comunicacao com uma impressora em atividade foi perdida/)
  assert.match(tray, /Start-Process `\r?\n\s+-FilePath 'powershell\.exe'/)
  assert.match(tray, /Verificando atualiza.{0,20}em segundo plano/)
  assert.match(tray, /A verifica.{0,30}atualiza.{0,20}em andamento/)
  assert.doesNotMatch(tray, /\$result\s*=\s*&\s*\$updateScript/)
  assert.match(tray, /Start-InteractiveUpdateCheck/)
})

test('atualizador fixa a identidade do certificado Early Access', async () => {
  const updater = await readScript('check-and-update-windows-agent.ps1')
  const validator = await fs.readFile(
    path.join(process.cwd(), '..', 'scripts', 'validate-agent-release-artifacts.mjs'),
    'utf8'
  )
  const fingerprint = 'AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB'

  assert.match(updater, new RegExp(fingerprint))
  assert.match(updater, /\$certificateHash -ne \$trustedReleaseCertificateSha256/)
  assert.match(validator, new RegExp(fingerprint))
})

test('instalador Early Access fixa e confia somente no certificado empacotado', async () => {
  const build = await readScript('build-windows-package.ps1')
  const setup = await fs.readFile(path.join(process.cwd(), 'windows-setup', 'Program.cs'), 'utf8')
  const signer = await readScript('sign-windows-agent-dev.ps1')

  assert.match(build, /Get-FileHash -LiteralPath \$devCertificatePath -Algorithm SHA256/)
  assert.match(setup, /Certificado Early Access nao corresponde ao pacote/)
  assert.match(setup, /1\.3\.6\.1\.5\.5\.7\.3\.3/)
  assert.match(setup, /StoreName\.Root, StoreName\.TrustedPublisher/)
  assert.match(setup, /StoreLocation\.CurrentUser/)
  assert.match(signer, /PRINTFLOW_AGENT_DEV_CERT_PASSWORD/)
  assert.doesNotMatch(signer, /printflow-agent-local-dev-only/)
})

test('atualizador C# valida o release assinado antes de instalar e confirma o runtime atualizado', async () => {
  const updater = await fs.readFile(path.join(process.cwd(), 'windows-setup', 'SignedUpdateService.cs'), 'utf8')
  const certificatePin = 'AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB'

  assert.match(updater, /api\.github\.com\/repos\/devMuriloOliveira\/PrintFlow\/releases\/latest/)
  assert.match(updater, /uri\.Scheme != Uri\.UriSchemeHttps/)
  assert.match(updater, new RegExp(certificatePin))
  assert.match(updater, /CryptographicOperations\.FixedTimeEquals/)
  assert.match(updater, /X509Certificate\.CreateFromSignedFile/)
  assert.match(updater, /AuthenticodeTrust\.Verify/)

  const validation = updater.indexOf('ValidatePackage(updatesRoot, latest.ToString())')
  const launch = updater.indexOf('Process.Start(new ProcessStartInfo(installer)')
  const health = updater.indexOf('WaitForHealthAsync(latest.ToString(), requirePaired: true')
  const success = updater.indexOf('WriteHistory(currentVersion, latest.ToString(), "succeeded", "health_verified")')
  assert.ok(validation >= 0 && validation < launch)
  assert.ok(launch < health && health < success)
})

test('host single-file localiza o pacote pelo executavel publicado', async () => {
  const host = await fs.readFile(path.join(process.cwd(), 'windows-host', 'Program.cs'), 'utf8')
  const processJob = await fs.readFile(path.join(process.cwd(), 'windows-host', 'AgentProcessJob.cs'), 'utf8')

  assert.match(host, /Environment\.ProcessPath/)
  assert.match(host, /SelectMany\(GetAncestors\)/)
  assert.match(host, /File\.Exists\(Path\.Combine\(candidate, "src", "index\.js"\)\)/)
  assert.match(host, /AgentProcessJob\.Attach\(_agentProcess\)/)
  assert.match(processJob, /KillProcessesWhenJobCloses = 0x00002000/)
})

test('instalacao e remocao nativas elevam antes de criar ou excluir a tarefa', async () => {
  const setup = await fs.readFile(path.join(process.cwd(), 'windows-setup', 'Program.cs'), 'utf8')

  assert.match(setup, /RelaunchElevatedWhenRequired\(args\)/)
  assert.match(setup, /string\.Equals\(argument, "--install-package"/)
  assert.match(setup, /string\.Equals\(argument, "--uninstall"/)
  assert.match(setup, /Verb = "runas"/)
  assert.match(setup, /process\.WaitForExit\(\)/)
  assert.match(setup, /process\.StandardError\.ReadToEndAsync\(\)/)
  assert.match(setup, /private static void StartTask\(string taskName\) => Run\("schtasks\.exe", \["\/Run", "\/TN", taskName\]\);/)
})

test('tarefa nativa inicia no logon mesmo quando o notebook usa bateria', async () => {
  const setup = await fs.readFile(path.join(process.cwd(), 'windows-setup', 'Program.cs'), 'utf8')

  assert.match(setup, /LogonTrigger/)
  assert.match(setup, /DisallowStartIfOnBatteries", "false"/)
  assert.match(setup, /StopIfGoingOnBatteries", "false"/)
  assert.match(setup, /StartWhenAvailable", "true"/)
  assert.match(setup, /Encoding = Encoding\.Unicode/)
})

test('runtime do release nao chama PowerShell e o ZIP remove scripts de cliente antigos', async () => {
  const host = await fs.readFile(path.join(process.cwd(), 'windows-host', 'Program.cs'), 'utf8')
  const credentials = await fs.readFile(path.join(process.cwd(), 'src', 'storage', 'credentials.js'), 'utf8')
  const scanner = await fs.readFile(path.join(process.cwd(), 'src', 'discovery', 'usbScanner.js'), 'utf8')
  const orca = await fs.readFile(path.join(process.cwd(), 'src', 'slicing', 'orcaRuntime.js'), 'utf8')
  const build = await readScript('build-windows-package.ps1')

  for (const source of [host, credentials, scanner, orca]) assert.doesNotMatch(source, /powershell\.exe|powershell/i)
  assert.match(host, /--check-updates/)
  assert.match(host, /--dpapi-/)
  assert.match(build, /@\('\.ps1', '\.psm1', '\.vbs'\)/)
  assert.doesNotMatch(build, /powershell\.exe.*install-windows-agent-from-package/)
})

test('interface e instalador nao exibem o endereco interno da API', async () => {
  const tray = await readScript('start-windows-agent-tray.ps1')
  const bootstrap = await readScript('install-windows-agent-from-package.ps1')
  const install = await readScript('install-windows-agent.ps1')
  const startup = await readScript('install-windows-startup.ps1')

  assert.doesNotMatch(tray, /API:\s*\$ApiUrl/)
  assert.doesNotMatch(bootstrap, /Comunica-se com:\s*\$ApiUrl/)
  assert.doesNotMatch(install, /Write-Host\s+"API:\s*\$ApiUrl"/)
  assert.doesNotMatch(startup, /Write-Host\s+"API:\s*\$ApiUrl"/)
  assert.match(bootstrap, /Conecta-se ao PrintFlow Cloud por HTTPS/)
})
