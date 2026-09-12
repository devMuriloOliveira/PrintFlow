import assert from 'node:assert/strict'
import test from 'node:test'
import { companyLookupFromBrasilApi, lookupCompanyByCnpj } from '../src/services/companyLookup.js'

test('mapeia somente dados cadastrais necessarios da consulta de CNPJ', () => {
  assert.deepEqual(companyLookupFromBrasilApi({
    razao_social: 'Empresa Exemplo LTDA', nome_fantasia: 'Exemplo 3D', ddd_telefone_1: '11999999999', email: 'contato@exemplo.test',
    logradouro: 'Rua Teste', numero: '123', complemento: 'Sala 4', bairro: 'Centro', municipio: 'Sao Paulo', uf: 'sp', cep: '01001000', descricao_situacao_cadastral: 'ATIVA', qsa: [{ nome_socio: 'Nao deve retornar' }]
  }), {
    name: 'Exemplo 3D', legalName: 'Empresa Exemplo LTDA', phone: '11999999999', email: 'contato@exemplo.test', address: 'Rua Teste, 123, Sala 4', district: 'Centro', city: 'Sao Paulo', state: 'SP', zip: '01001000', status: 'ATIVA'
  })
})

test('consulta complementar rejeita CPF antes de chamar o provedor', async () => {
  await assert.rejects(() => lookupCompanyByCnpj('52998224725', () => { throw new Error('nao deve chamar') }), /CNPJ valido/)
})
