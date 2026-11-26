import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

test('setup C# preserva stdout e stderr do Orca e informa falha antes de mover instalação', async () => {
  const setup = await fs.readFile('windows-setup/Program.cs', 'utf8')
  const install = setup.slice(setup.indexOf('private static int Run('), setup.indexOf('private static void RegisterProtocol('))
  const validation = setup.slice(setup.indexOf('private static void ValidateOrcaRuntime'), setup.indexOf('private static void DownloadAndExtractOrca'))

  assert.match(install, /RedirectStandardOutput = true/)
  assert.match(install, /RedirectStandardError = true/)
  assert.match(install, /ReadToEndAsync\(\)/)
  assert.match(install, /codigo \{process\.ExitCode\}.*\{details\}/)
  assert.match(validation, /SliceAsync/)
  assert.match(validation, /finally/)
  assert.match(setup, /Falha ao preparar o OrcaSlicer portátil oficial\. Verifique o download, a validação, a extração e o teste local de fatiamento\./)
  assert.doesNotMatch(setup, /Falha ao instalar OrcaSlicer pelo Windows Package Manager/)
  assert.ok(setup.indexOf('ValidateOrcaRuntime(temp, testMode)') < setup.indexOf('Directory.Move(root, backup)'))
})
