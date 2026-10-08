import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const script = path.resolve('scripts/test-windows-orca-runtime.ps1')

for (const scenario of ['success', 'stderr_failure', 'stdout_failure']) {
  test(`diagnostico do instalador preserva saida real: ${scenario}`, { skip: process.platform !== 'win32' }, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'printflow diagnostic '))
    try {
      const payload = path.join(root, 'payload com espacos')
      mkdirSync(path.join(payload, 'runtime'), { recursive: true })
      mkdirSync(path.join(payload, 'scripts'))
      copyFileSync(process.execPath, path.join(payload, 'runtime/node.exe'))
      const content = scenario === 'success'
        ? "console.log('GCODE_VERIFIED');"
        : scenario === 'stderr_failure'
          ? "console.error('Falha DLL: código 4551'); process.exitCode = 7;"
          : "console.log('Loader failed 4551'); process.exitCode = 8;"
      writeFileSync(path.join(payload, 'scripts/verify-orca-runtime.mjs'), content)
      const log = path.join(root, 'logs com espacos', 'check.log')
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-SourceRoot', payload, '-DiagnosticLogPath', log], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
      const diagnostic = readFileSync(log, 'utf8')
      if (scenario === 'success') {
        assert.equal(result.status, 0, result.stderr)
        assert.match(diagnostic, /Exit code: 0[\s\S]*GCODE_VERIFIED/)
      } else {
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /instalacao existente foi preservada/)
        assert.match(diagnostic, scenario === 'stderr_failure' ? /Exit code: 7[\s\S]*Falha DLL: código 4551/ : /Exit code: 8[\s\S]*Loader failed 4551/)
      }
      rmSync(payload, { recursive: true })
      assert.equal(readFileSync(log, 'utf8'), diagnostic, 'log sobrevive a limpeza do payload')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
