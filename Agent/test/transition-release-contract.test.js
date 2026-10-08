import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('ReleaseTool mantém o asset de transição para agentes antigos', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const releaseTool = await fs.readFile(path.join(root, 'Agent', 'windows-release-tool', 'Program.cs'), 'utf8')

  assert.match(releaseTool, /File\.Copy\(setupPath, legacySetupPath, overwrite: true\)/)
  assert.match(releaseTool, /File\.Copy\(setupPath, transitionPath, overwrite: true\)/)
  assert.match(releaseTool, /Fila-Agent-Setup\.exe/)
  assert.match(releaseTool, /Fila-Agent-Transition-Setup\.exe/)
  assert.match(releaseTool, /Fila-Agent-Dev-Certificate\.cer/)
  assert.match(releaseTool, /PrintFlow-Agent-Setup\.exe/)
  assert.match(releaseTool, /PrintFlow-Agent-Dev-Certificate\.cer/)
  assert.match(releaseTool, /PrintFlow-Agent-Transition-Setup\.exe/)
  assert.match(releaseTool, /VerifySignedFileAsync\(transitionPath, certificate, repositoryRoot\)/)
  assert.match(releaseTool, /"PrintFlow-Agent-Transition-Setup\.exe"/)
  assert.match(releaseTool, /"Fila-Agent-Windows\.zip"/)
  assert.match(releaseTool, /"Fila-Agent-Setup\.exe"/)
  assert.match(releaseTool, /LegacyReleaseAssetNames\(\)/)
  assert.match(releaseTool, /currentAssets\.All\(names\.Contains\)/)
  assert.match(releaseTool, /SHA256SUMS\.txt/)

  const artifactValidator = await fs.readFile(path.join(root, 'scripts', 'validate-agent-release-artifacts.mjs'), 'utf8')
  assert.match(artifactValidator, /Fila-Agent-Windows\.zip/)
  assert.match(artifactValidator, /PrintFlow-Agent-Transition-Setup\.exe/)
  assert.match(artifactValidator, /Alias legado diverge/)
})
