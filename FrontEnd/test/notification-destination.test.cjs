const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../node_modules/typescript')

const source = fs.readFileSync(path.join(__dirname, '../app/utils/notificationDestination.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const sandbox = { exports: {} }
vm.runInNewContext(compiled, sandbox)
const { notificationDestination } = sandbox.exports

test('tipos operacionais conhecidos abrem a área apropriada', () => {
  for (const [type, expected] of [
    ['print.started', '/impressoras'], ['print.start_timeout', '/impressoras'],
    ['agent.offline', '/impressoras'], ['agent.command_failed', '/impressoras'],
    ['production.printer_missing', '/produtos'],
    ['marketplace.sync_failed', '/marketplaces'], ['marketplace.product_link_missing', '/marketplaces'],
    ['marketplace.sale_received', '/marketplaces?secao=pedidos'],
    ['order.embalando', '/vendas'], ['order.entregue', '/vendas'],
    ['inventory.order_without_product', '/vendas'], ['inventory.filament_low_stock', '/filamentos'],
    ['inventory.product_out_of_stock', '/estoque'],
    ['inventory.production_recipe_missing', '/estoque'], ['inventory.production_consumption_pending', '/estoque'],
    ['subscription.status_changed', '/configuracoes/assinatura'], ['subscription.deadline_soon', '/configuracoes/assinatura'],
    ['privacy.request', '/configuracoes/privacidade']
  ]) assert.equal(notificationDestination(type), expected, type)
})

test('tipos desconhecidos ou entradas com aparência de rota não criam destinos', () => {
  for (const type of ['print.unknown', 'https://example.com', '/vendas', '__proto__', 'constructor', '']) {
    assert.equal(notificationDestination(type), null, type)
  }
})

for (const component of ['app/components/AppHeader.vue', 'app/pages/notificacoes/index.vue']) {
  test(`${component}: navega sem esperar a leitura e avisa se falhar`, async () => {
    const vue = fs.readFileSync(path.join(__dirname, '..', component), 'utf8')
    const body = vue.match(/const openNotification = \(notification: OperationalNotification\) => \{[\s\S]*?\n\}/)?.[0]
    assert.ok(body, 'ação de abertura encontrada')
    const code = ts.transpileModule(`${body}\nexports.openNotification = openNotification`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    let finishRead
    const destinations = []
    const messages = []
    const context = {
      exports: {}, notificationDestination,
      markNotificationRead: () => new Promise(resolve => { finishRead = resolve }),
      navigateTo: destination => destinations.push(destination),
      notify: message => messages.push(message),
      notificationsOpen: { value: true }
    }
    vm.runInNewContext(code, context)
    context.exports.openNotification({ id: '1', type: 'print.started' })
    assert.deepEqual(destinations, ['/impressoras'])
    assert.equal(messages.length, 0)
    finishRead(false)
    await Promise.resolve()
    assert.equal(messages.length, 1)

    context.exports.openNotification({ id: '2', type: 'unknown' })
    assert.deepEqual(destinations, ['/impressoras'])
    finishRead(true)
    await Promise.resolve()
    assert.equal(messages.length, 1)
  })
}
