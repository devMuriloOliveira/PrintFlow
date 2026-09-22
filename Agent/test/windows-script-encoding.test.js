import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const scripts = [
  'start-windows-agent-tray.ps1',
  'check-and-update-windows-agent.ps1',
  'sign-windows-agent-dev.ps1'
]

test('scripts Windows com texto Unicode usam UTF-8 BOM', async () => {
  for (const name of scripts) {
    const filePath = path.join(
      process.cwd(),
      'scripts',
      name
    )
    const content = await fs.readFile(filePath)

    assert.deepEqual(
      [...content.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${name} precisa de UTF-8 BOM para o Windows PowerShell 5`
    )

    assert.equal(
      content.toString('utf8').includes('Ã'),
      false,
      `${name} contem texto mojibake`
    )
  }
})
