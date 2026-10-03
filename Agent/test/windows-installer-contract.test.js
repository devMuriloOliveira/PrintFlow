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
  assert.ok(build.indexOf('scripts/verify-orca-runtime.mjs') < build.indexOf('Compress-Archive'))
  assert.ok(install.indexOf('scripts\\verify-orca-runtime.mjs') < install.indexOf('\nStop-ExistingAgentInstall'))
  assert.match(install, /Instalacao cancelada: OrcaSlicer nao conseguiu gerar G-code/)
  assert.match(verifier, /discoverStoreOrcaPath\(\)/)
  assert.ok(install.indexOf('scripts\\ensure-orca-slicer.ps1') < install.indexOf('\nStop-ExistingAgentInstall'))
  assert.match(verifier, /sliceWithOrcaSlicer\(/)
})

test('instalador exibe versao e informa que o runtime esta incluido', async () => {
  const build = await readScript('build-windows-package.ps1')
  const bootstrap = await readScript('install-windows-agent-from-package.ps1')

  assert.match(build, /-PackageVersion ""\$packageVersion""/)
  assert.match(bootstrap, /Versao atual: \$currentVersionText/)
  assert.match(bootstrap, /Versao a instalar: \$targetVersionText/)
  assert.match(bootstrap, /nao exige Node\.js instalado separadamente/)
  assert.match(bootstrap, /Mantem pareamento, credenciais protegidas e historico local durante atualizacoes/)
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
  const bootstrap = await readScript('install-windows-agent-from-package.ps1')

  assert.match(build, /-CertificateSha256 ""\$devCertificateSha256""/)
  assert.match(build, /Get-FileHash -LiteralPath \$devCertificatePath -Algorithm SHA256/)
  assert.match(bootstrap, /Certificado Early Access nao corresponde ao pacote/)
  assert.match(bootstrap, /1\.3\.6\.1\.5\.5\.7\.3\.3/)
  assert.match(bootstrap, /@\('Root', 'TrustedPublisher'\)/)
  assert.match(bootstrap, /X509Store.*CurrentUser/)
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
