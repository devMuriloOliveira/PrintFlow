import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidCnpj, isValidCpf, validCompanyDocument } from '../src/services/companyDocument.js'

test('valida CPF e CNPJ pelos digitos verificadores e gera identificador sem expor o numero', () => {
  assert.equal(isValidCpf('529.982.247-25'), true)
  assert.equal(isValidCpf('111.111.111-11'), false)
  assert.equal(isValidCnpj('11.222.333/0001-81'), true)
  assert.equal(isValidCnpj('11.222.333/0001-80'), false)
  const identity = validCompanyDocument('11.222.333/0001-81')
  assert.equal(identity?.type, 'cnpj')
  assert.equal(identity?.digits, '11222333000181')
  assert.ok(identity?.hash)
  assert.notEqual(identity?.hash, identity?.digits)
})
