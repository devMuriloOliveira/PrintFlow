import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const readScript = name =>
  fs.readFile(
    path.join(process.cwd(), 'scripts', name),
    'utf8'
  )

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

test('verificacao de atualizacao nao bloqueia a bandeja e possui timeouts', async () => {
  const updater = await readScript('check-and-update-windows-agent.ps1')
  const tray = await readScript('start-windows-agent-tray.ps1')

  assert.match(updater, /-TimeoutSec \$ReleaseTimeoutSec/)
  assert.match(updater, /-TimeoutSec \$ArtifactTimeoutSec/)
  assert.match(updater, /Voce ja esta usando a versao mais recente/)
  assert.match(tray, /Start-Process `\r?\n\s+-FilePath 'powershell\.exe'/)
  assert.match(tray, /Verificando atualiza.{0,20}em segundo plano/)
  assert.match(tray, /A verifica.{0,30}atualiza.{0,20}em andamento/)
})
