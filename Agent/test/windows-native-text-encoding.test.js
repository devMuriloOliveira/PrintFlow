import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

test('UI nativa e termos preservam texto português em UTF-8', async () => {
  const files = [
    'windows-setup/Program.cs',
    'windows-setup/SetupConsentForm.cs',
    'windows-setup/SignedUpdateService.cs',
    'legal/TERMOS-DE-USO-FILA-AGENT.txt'
  ]

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8')
    assert.doesNotMatch(content, /\u00c3\u0192/, `${file} contém mojibake`)
  }

  const consent = await fs.readFile('windows-setup/SetupConsentForm.cs', 'utf8')
  assert.match(consent, /versão/)
  assert.match(consent, /Aceitar/)
})
