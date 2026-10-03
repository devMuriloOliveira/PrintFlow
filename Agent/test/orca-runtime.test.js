import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOrcaSlicerPath } from '../src/slicing/orcaRuntime.js'

test('instalacao limpa resolve Orca oficial Store sem variavel de ambiente', () => {
  const storePath = 'store/orca-slicer.exe'
  assert.equal(resolveOrcaSlicerPath({ env: {}, discoverStore: () => storePath, exists: candidate => candidate === storePath }), storePath)
})

test('configuracao explicita prevalece e nao muda silenciosamente quando invalida', () => {
  assert.equal(resolveOrcaSlicerPath({ env: { PRINTFLOW_ORCA_SLICER_PATH: ' custom.exe ' }, exists: () => false }), 'custom.exe')
})

test('Store ausente ou executavel removido nao seleciona copia global nao validada', () => {
  const env = { ProgramFiles: 'programs' }
  assert.equal(resolveOrcaSlicerPath({ env, discoverStore: () => '', exists: () => true }), '')
  assert.equal(resolveOrcaSlicerPath({ env, discoverStore: () => 'removed.exe', exists: () => false }), '')
})

test('configuracao explicita nao executa descoberta da Store', () => {
  assert.equal(resolveOrcaSlicerPath({ env: { PRINTFLOW_ORCA_SLICER_PATH: 'custom.exe' }, discoverStore: () => { throw new Error('Unexpected discovery') } }), 'custom.exe')
})
