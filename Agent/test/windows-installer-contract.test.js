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
