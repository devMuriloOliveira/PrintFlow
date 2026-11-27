const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function createNotifications(failRead) {
  const source = fs.readFileSync(path.join(__dirname, '../app/composables/useOperationalNotifications.ts'), 'utf8')
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const states = new Map()
  const calls = []
  const context = {
    exports: {}, process: { client: true }, AbortController, Date,
    useRuntimeConfig: () => ({ public: { apiBase: 'http://example.invalid' } }),
    useAuth: () => ({ ready: { value: true }, authHeaders: { value: { Authorization: 'test' } } }),
    useAppData: () => ({ settings: { value: { preferences: {} } } }),
    useState: (key, initial) => { if (!states.has(key)) states.set(key, { value: initial() }); return states.get(key) },
    computed: get => ({ get value() { return get() } }),
    $fetch: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' })
      if (options.method === 'POST') { if (failRead) throw new Error('offline'); return { read: true } }
      return [{ id: 'n1', type: 'test', severity: 'info', title: 'Teste', message: 'Aviso', readAt: null }]
    }
  }
  vm.runInNewContext(javascript, context)
  return { api: context.exports.useOperationalNotifications(), calls }
}

test('marcar como lida preserva a notificação e atualiza o contador após sucesso', async () => {
  const { api, calls } = createNotifications(false)
  await api.refreshNotifications()
  assert.equal(api.unreadCount.value, 1)
  assert.equal(await api.markNotificationRead('n1'), true)
  assert.equal(api.unreadCount.value, 0)
  assert.ok(api.notifications.value[0].readAt)
  assert.equal(calls[1].method, 'POST')
})

test('falha ao marcar como lida mantém a notificação não lida', async () => {
  const { api } = createNotifications(true)
  await api.refreshNotifications()
  assert.equal(await api.markNotificationRead('n1'), false)
  assert.equal(api.unreadCount.value, 1)
  assert.equal(api.notifications.value[0].readAt, null)
})
