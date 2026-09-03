import assert from 'node:assert/strict'
import test from 'node:test'
import { canAccessRequest, requiredPermissionForRequest } from '../src/auth/authorization.js'

test('a politica exige permissao explicita para novas rotas protegidas', () => {
  assert.equal(requiredPermissionForRequest('POST', '/api/nova-rota'), 'tenant.manage')
  assert.equal(canAccessRequest({ role: 'usuario' }, 'POST', '/api/nova-rota'), false)
  assert.equal(canAccessRequest({ role: 'owner' }, 'POST', '/api/nova-rota'), true)
})

test('financeiro nao pode operar producao e producao nao pode alterar financeiro', () => {
  assert.equal(canAccessRequest({ role: 'financeiro' }, 'POST', '/api/print-jobs/enqueue'), false)
  assert.equal(canAccessRequest({ role: 'producao' }, 'POST', '/api/expenses'), false)
  assert.equal(canAccessRequest({ role: 'financeiro' }, 'PUT', '/api/expenses/10'), true)
  assert.equal(canAccessRequest({ role: 'producao' }, 'POST', '/api/print-jobs/enqueue'), true)
})

test('dados agregados e auditoria ficam restritos a administracao do tenant', () => {
  assert.equal(canAccessRequest({ role: 'financeiro' }, 'GET', '/api/app-data'), false)
  assert.equal(canAccessRequest({ role: 'admin' }, 'GET', '/api/app-data'), true)
  assert.equal(canAccessRequest({ role: 'producao' }, 'GET', '/api/operational-audit-events'), false)
  assert.equal(canAccessRequest({ role: 'owner' }, 'GET', '/api/operational-audit-events'), true)
})

test('admin administra membros sem receber poderes reservados ao owner', () => {
  assert.equal(canAccessRequest({ role: 'admin' }, 'GET', '/api/members'), true)
  assert.equal(canAccessRequest({ role: 'admin' }, 'PATCH', '/api/members/10'), true)
  assert.equal(canAccessRequest({ role: 'financeiro' }, 'GET', '/api/members'), false)
  assert.equal(canAccessRequest({ role: 'admin' }, 'POST', '/api/nova-rota'), false)
  assert.equal(canAccessRequest({ role: 'owner' }, 'POST', '/api/nova-rota'), true)
})
