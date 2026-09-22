import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('release publica alias de transicao para Agents antigos', async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
  )
  const workflow = await fs.readFile(
    path.join(root, '.github', 'workflows', 'agent-release.yml'),
    'utf8'
  )
  const installer = await fs.readFile(
    path.join(root, 'Agent', 'scripts', 'install-windows-agent-from-package.ps1'),
    'utf8'
  )

  assert.match(workflow, /Copy-Item[\s\S]*PrintFlow-Agent-Transition-Setup\.exe/)
  assert.match(workflow, /PrintFlow-Agent-Transition-Setup\.exe/)
  assert.match(workflow, /install-windows-agent-from-package\.ps1/)
  assert.match(installer, /install-windows-agent\.ps1/)
  assert.doesNotMatch(installer, /Remove-Item[\s\S]{0,180}\$installRoot/i)
})
