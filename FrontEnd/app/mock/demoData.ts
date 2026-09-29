import type {
  AppData,
  BackupStatus,
  CalculatorSimulation,
  FinancialHistoryPage,
  IntegrationsOverview,
  InventoryOverview,
  MarketplaceOrder,
  OrdersPage,
  PendingProductionMaterial,
  SupportRequest
} from '~/composables/useAppData'

const now = new Date()
const pad = (value: number) => String(value).padStart(2, '0')
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const brDate = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
const daysAgo = (days: number) => {
  const date = new Date(now)
  date.setDate(date.getDate() - days)
  return date
}
const dateInMonth = (monthIndex: number, day: number) => new Date(now.getFullYear(), monthIndex, day)
const money = (value: number) => Number(value.toFixed(2))

const monthRevenue = [7200, 8450, 7980, 10500, 9300, 12750, 11400, 14800, 18450.7]
const monthExpenses = [3100, 3500, 4200, 3900, 4800, 5200, 5000, 5900, 6780.25]

export const mockProducts: AppData['products'] = [
  ['1', 'Suporte para Headset', 'Organizacao gamer com encaixe reforcado', 'SUP-HEAD-001', 'Organizacao', 129.9, 41.2, 88.7, 68.3, 'stand'],
  ['2', 'Organizador de Mesa Modular', 'Texto longo para validar quebra em cards, tabelas e detalhes sem estourar o layout responsivo', 'ORG-MOD-002', 'Organizacao', 89.9, 28.4, 61.5, 68.4, 'organizer'],
  ['3', 'Mascara Cosplay Premium', 'Acabamento alto para pintura e lixamento', 'COS-MSK-003', 'Cosplay', 350, 138.5, 211.5, 60.4, 'mask'],
  ['4', 'Vaso Decorativo Geometrico', 'Decoracao parametrica', 'VAS-GEO-004', 'Decoracao', 75, 21.6, 53.4, 71.2, 'vase'],
  ['5', 'Suporte para Controle', 'Compatibilidade multi-console', 'SUP-CTRL-005', 'Games', 95, 32.8, 62.2, 65.5, 'stand'],
  ['6', 'Miniatura Dragao Flexivel', 'Articulado em PLA silk', 'MIN-DRG-006', 'Presentes', 149.9, 54.2, 95.7, 63.8, 'dragon'],
  ['7', 'Porta-canetas Hexagonal', 'Linha escritorio', 'PCT-HEX-007', 'Escritorio', 55, 18.9, 36.1, 65.6, 'box'],
  ['8', 'Suporte para Celular Ajustavel', 'Base ajustavel para mesa', 'SUP-CEL-008', 'Acessorios', 69.9, 23.1, 46.8, 67, 'phone'],
  ['9', 'Prototipo tecnico com nome extremamente longo para testar overflow horizontal em tabelas e filtros', 'PRT-LONG-009', 'Prototipagem', 1450, 740, 710, 49, 'part'],
  ['10', 'Lote corporativo demonstrativo valor alto', 'B2B-128K-010', 'B2B', 128945.37, 98450, 30495.37, 23.65, 'box']
].map(([id, name, subtitle, sku, category, price, cost, profit, margin, thumb], index) => ({
  id: String(id), name: String(name), subtitle: String(subtitle), sku: String(sku), category: String(category),
  price: Number(price), weight: 35 + index * 38, description: 'Produto ficticio para review visual final.',
  printerId: String((index % 4) + 1), printer: ['Bambu Lab A1 Mini', 'Ender 3 V3', 'Prusa MK4', 'K1 Max'][index % 4],
  time: ['1h 20m', '2h 45m', '6h 30m', '3h 10m'][index % 4], layer: 0.2, infill: 35 + index * 3,
  dimensions: '120x80x60 mm', filamentId: String((index % 6) + 1), filament: ['PLA Preto', 'PLA Branco', 'PLA Azul', 'PETG Preto'][index % 4],
  filamentColor: ['#111827', '#f8fafc', '#2563eb', '#27272a'][index % 4], packaging: 4.5, materials: 8 + index,
  labor: 12 + index * 1.5, energy: true, marketplaceFee: 12, desiredMargin: 35, cost: Number(cost), profit: Number(profit),
  margin: Number(margin), status: index === 8 ? 'Em revisao' : 'Ativo', thumb: String(thumb), validationStatus: 'validated',
  createdAt: isoDate(daysAgo(120 - index * 6)), updatedAt: isoDate(daysAgo(index + 1))
}))

export const mockClients: AppData['clients'] = [
  'Lucas Almeida', 'Mariana Costa', 'Rafael Oliveira', 'Fernanda Martins', 'Carlos Henrique',
  'Juliana Lima', 'Bruno Santos', 'Camila Rocha', 'Pedro Ferreira', 'Amanda Souza',
  'Oficina Beta 3D', 'Studio Arquitetura Norte'
].map((name, index) => ({
  id: String(index + 1), name, email: `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.')}@example.test`,
  phone: `(11) 9${pad(index)}00-${pad(index + 10)}${pad(index + 20)}`, type: index > 9 ? 'Pessoa Juridica' : 'Pessoa Fisica',
  city: ['Sao Paulo', 'Campinas', 'Curitiba', 'Rio de Janeiro'][index % 4], state: ['SP', 'SP', 'PR', 'RJ'][index % 4],
  origin: ['Instagram', 'Mercado Livre', 'Shopee', 'Indicacao'][index % 4], tags: index % 3 === 0 ? 'vip recorrente' : 'review visual',
  status: index === 8 ? 'inactive' : 'active', orders: 2 + (index % 8), revenue: money(480 + index * 365.7),
  ticket: money((480 + index * 365.7) / (2 + (index % 8))), last: brDate(daysAgo(index * 4 + 1))
}))

export const mockMarketplaces: AppData['marketplaces'] = [
  { id: '1', name: 'Mercado Livre', short: 'ML', color: '#ffe600', commission: 12, fixed: 5.5, financial: 2.2, ads: 4, others: 0.8, gross: 8200, net: 7320, fees: 880, orders: 34, active: true, platform: 'mercado_livre', connectionStatus: 'connected' },
  { id: '2', name: 'Shopee', short: 'SP', color: '#ee4d2d', commission: 14, fixed: 3.5, financial: 2, ads: 5.2, others: 1, gross: 4500, net: 3910, fees: 590, orders: 22, active: true, platform: 'shopee', connectionStatus: 'connected' },
  { id: '3', name: 'Venda Direta', short: 'VD', color: '#1768f2', commission: 0, fixed: 0, financial: 0, ads: 0, others: 0, gross: 5750.7, net: 5750.7, fees: 0, orders: 31, active: true, platform: 'custom', connectionStatus: 'manual' },
  { id: '4', name: 'Amazon', short: 'AM', color: '#232f3e', commission: 15, fixed: 4.9, financial: 1.8, ads: 3.5, others: 1.2, gross: 9.9, net: 7.42, fees: 2.48, orders: 1, active: false, platform: 'amazon', connectionStatus: 'disconnected' }
]

export const mockOrders: AppData['orders'] = Array.from({ length: 87 }, (_, index) => {
  const product = mockProducts[index % 8]
  const marketplace = mockMarketplaces[index % 3]
  const gross = money([129.9, 350, 89.9, 75, 95, 149.9, 55, 69.9][index % 8] * (index % 5 === 0 ? 2 : 1))
  const fee = marketplace.platform === 'custom' ? 0 : money(gross * (0.09 + (index % 4) * 0.015))
  const shipping = marketplace.platform === 'custom' ? 0 : money(8.9 + (index % 3) * 5)
  const net = money(gross - fee - shipping)
  const status = ['Concluido', 'Producao', 'Envio', 'Concluido', 'Aguardando', 'Concluido', 'Cancelado'][index % 7]
  return {
    dbId: String(index + 1), id: `#${1048 + index}`, productId: product.id, clientId: mockClients[index % mockClients.length].id,
    date: brDate(index < 31 ? daysAgo(index) : dateInMonth(index % 9, (index % 25) + 1)),
    client: mockClients[index % mockClients.length].name, marketplace: marketplace.name, product: product.name,
    qty: index % 5 === 0 ? 2 : 1, gross, fee, shipping, net, profit: status === 'Cancelado' ? 0 : money(net - product.cost),
    status, trackingCode: ['Envio', 'Concluido'].includes(status) ? `BRMOCK${1000 + index}` : '',
    marketplaceOrder: marketplace.platform !== 'custom', salesChannel: marketplace.platform === 'custom' ? 'direct' : 'marketplace'
  }
})

for (let month = 0; month < monthRevenue.length; month += 1) {
  mockOrders.push({
    dbId: `month-${month}`, id: `#M${pad(month + 1)}`, productId: '1', clientId: '1', date: brDate(dateInMonth(month, 12)),
    client: 'Cliente mensal mock', marketplace: mockMarketplaces[month % 3].name, product: 'Venda agregada mensal mock',
    qty: 1, gross: monthRevenue[month], fee: money(monthRevenue[month] * 0.08), shipping: 0,
    net: money(monthRevenue[month] * 0.92), profit: money(monthRevenue[month] * 0.58), status: 'Concluido',
    marketplaceOrder: month % 3 !== 2, salesChannel: month % 3 === 2 ? 'direct' : 'marketplace'
  })
}

export const mockExpenses: AppData['expenses'] = [
  ['Filamentos', 'Filamento PLA e PETG', 2150], ['Energia', 'Energia eletrica', 780],
  ['Embalagens', 'Caixas, etiquetas e protecao', 620], ['Manutencao', 'Manutencao impressora', 1100],
  ['Fretes', 'Fretes complementares', 900], ['Outros', 'Ferramentas e insumos diversos', 1230.25]
].flatMap(([category, description, base], categoryIndex) => [
  {
    id: `${categoryIndex + 1}`, description: String(description), category: String(category), supplier: ['PrintParts', 'Energia SP', 'PackBox', 'TechFix', 'Correios', 'Loja Maker'][categoryIndex],
    value: Number(base), date: brDate(daysAgo(categoryIndex * 3 + 2)), payment: ['Pix', 'Boleto', 'Cartao'][categoryIndex % 3],
    recurrence: categoryIndex < 2 ? 'Mensal' : 'Nao recorrente', status: 'Pago'
  },
  {
    id: `m-${categoryIndex + 1}`, description: `${description} recorrente`, category: String(category), supplier: 'Fornecedor mock',
    value: monthExpenses[categoryIndex], date: brDate(dateInMonth(categoryIndex + 1, 8)), payment: 'Cartao',
    recurrence: 'Nao recorrente', status: 'Pago'
  }
])

export const mockFilaments: AppData['filaments'] = [
  ['1', 'PLA Preto', '3D Fila', 'PLA', 'Preto', '#111827', 1800, 'Em estoque'],
  ['2', 'PLA Branco', 'Voolt', 'PLA', 'Branco', '#f8fafc', 400, 'Baixo estoque'],
  ['3', 'PLA Azul', '3D Lab', 'PLA', 'Azul', '#2563eb', 2300, 'Em estoque'],
  ['4', 'PETG Preto', 'TechFil', 'PETG', 'Preto', '#27272a', 1200, 'Em estoque'],
  ['5', 'PETG Transparente', 'Voolt', 'PETG', 'Transparente', '#bfdbfe', 200, 'Estoque critico'],
  ['6', 'TPU Vermelho Flex', 'FlexMaker', 'TPU', 'Vermelho', '#dc2626', 90, 'Estoque critico']
].map(([id, name, maker, material, color, colorHex, remaining, status], index) => ({
  id: String(id), name: String(name), maker: String(maker), material: String(material), type: '1.75mm', color: String(color),
  colorHex: String(colorHex), initial: 1000, remaining: Number(remaining), minStock: 450, cost: 78 + index * 14,
  supplier: String(maker), date: brDate(daysAgo(40 + index * 5)), status: String(status)
}))

export const mockPrinters: AppData['printers'] = [
  ['1', 'Bambu Lab A1 Mini', 'PF-01', 'Bambu Lab', 'A1 Mini', 90, 324, 'Imprimindo'],
  ['2', 'Ender 3 V3', 'PF-02', 'Creality', 'Ender 3 V3', 120, 186, 'Disponivel'],
  ['3', 'Impressora 03 - Nome longo para testar quebra dentro do card superior', 'PF-03', 'Prusa', 'MK4', 110, 273, 'Manutencao'],
  ['4', 'K1 Max', 'PF-04', 'Creality', 'K1 Max', 180, 412, 'Imprimindo']
].map(([id, name, code, maker, model, power, hours, status], index) => ({
  id: String(id), name: String(name), code: String(code), maker: String(maker), model: String(model), acquired: brDate(daysAgo(400 - index * 50)),
  power: Number(power), hours: Number(hours), status: String(status), maintenance: brDate(daysAgo(20 + index * 8)),
  serial: `MOCK-SERIAL-${pad(index + 1)}`, location: ['Bancada A', 'Bancada B', 'Manutencao', 'Bancada C'][index],
  volume: ['180x180x180', '220x220x250', '250x210x220', '300x300x300'][index], defaultFilament: 'PLA', nozzleMm: 0.4,
  supportedMaterials: 'PLA, PETG, TPU', minLayerHeight: 0.12, maxLayerHeight: 0.28
}))

export const mockPrintJobs: AppData['printJobs'] = [
  ['1', 'Suporte headset', 'printing', '1', '1'], ['2', 'Mascara cosplay', 'queued', '3', '1'],
  ['3', 'Organizador de mesa', 'queued', '2', '2'], ['4', 'Vaso decorativo', 'paused', '4', '3'],
  ['5', 'Miniatura dragao', 'awaiting_confirmation', '6', '4'], ['6', 'Porta-canetas', 'completed', '7', '2'],
  ['7', 'Suporte celular', 'failed', '8', '4']
].map(([id, title, status, productId, printerId], index) => ({
  id: String(id), productId: String(productId), productName: mockProducts[Number(productId) - 1]?.name || String(title),
  printerId: String(printerId), printerName: mockPrinters[Number(printerId) - 1]?.name || '', source: index % 3 === 0 ? 'marketplace' : 'manual',
  title: String(title), quantity: index % 2 ? 2 : 1, priority: 10 - index, status: String(status), notes: 'Fila mock para review visual',
  createdAt: daysAgo(index).toISOString(), scheduledAt: daysAgo(index - 1).toISOString()
}))

export const mockGoals: AppData['goals'] = [
  { id: '1', name: 'Meta de faturamento', goalType: 'revenue', current: 18450, target: 20000, color: '#1768f2', icon: 'target', periodStart: isoDate(dateInMonth(now.getMonth(), 1)), periodEnd: isoDate(dateInMonth(now.getMonth(), 28)), status: 'Ativa' },
  { id: '2', name: 'Meta de pedidos', goalType: 'orders', current: 87, target: 100, color: '#f59e0b', icon: 'shopping-cart', periodStart: isoDate(dateInMonth(now.getMonth(), 1)), periodEnd: isoDate(dateInMonth(now.getMonth(), 28)), status: 'Ativa' },
  { id: '3', name: 'Meta de lucro', goalType: 'profit', current: 11670, target: 12000, color: '#16a34a', icon: 'trending-up', periodStart: isoDate(dateInMonth(now.getMonth(), 1)), periodEnd: isoDate(dateInMonth(now.getMonth(), 28)), status: 'Ativa' },
  { id: '4', name: 'Meta conservadora em risco', goalType: 'average_ticket', current: 212, target: 320, color: '#b42318', icon: 'receipt', periodStart: isoDate(dateInMonth(now.getMonth(), 1)), periodEnd: isoDate(dateInMonth(now.getMonth(), 28)), status: 'Ativa' }
]

export const mockMarketplaceOrders: MarketplaceOrder[] = mockOrders.slice(0, 18).map((order, index) => ({
  id: String(index + 1), integrationId: String((index % 2) + 1), marketplaceId: String((index % 2) + 1),
  platform: index % 2 ? 'shopee' : 'mercado_livre', externalOrderId: `MKT-${2000 + index}`, externalSku: mockProducts[index % mockProducts.length].sku,
  productName: order.product, quantity: order.qty, gross: order.gross, marketplaceFee: order.fee, shipping: order.shipping,
  net: order.net, profit: order.profit, status: order.status, soldAt: daysAgo(index + 1).toISOString(),
  printJobStatus: index % 4 === 0 ? 'awaiting_confirmation' : 'queued', mappedProductId: order.productId, mappedProductName: order.product
}))

export const mockAppData: AppData = {
  products: mockProducts,
  orders: mockOrders,
  printJobs: mockPrintJobs,
  expenses: mockExpenses,
  filaments: mockFilaments,
  printers: mockPrinters,
  marketplaces: mockMarketplaces,
  marketplaceOrders: mockMarketplaceOrders,
  marketplaceIntegrations: [
    { id: '1', marketplaceId: '1', platform: 'mercado_livre', connectionName: 'Mercado Livre Mock', accountExternalId: 'ml***ock', status: 'connected', scopes: 'orders products', hasAccessToken: false, hasRefreshToken: false, lastSyncAt: daysAgo(0).toISOString() },
    { id: '2', marketplaceId: '2', platform: 'shopee', connectionName: 'Shopee Mock', accountExternalId: 'sp***ock', status: 'connected', scopes: 'orders products', hasAccessToken: false, hasRefreshToken: false, lastSyncAt: daysAgo(1).toISOString() }
  ],
  clients: mockClients,
  expenseSegments: [
    { label: 'Filamentos', value: 31.7, color: '#1768f2' },
    { label: 'Energia', value: 11.5, color: '#29b6c8' },
    { label: 'Embalagens', value: 9.1, color: '#f59e0b' },
    { label: 'Manutencao', value: 16.2, color: '#fb923c' },
    { label: 'Fretes', value: 13.3, color: '#c83bb7' },
    { label: 'Outros', value: 18.2, color: '#7d8799' }
  ],
  goals: mockGoals,
  settings: { name: 'PrintFlow 3D Mock', currency: 'Real (R$)', timezone: '(GMT-03:00) Brasilia', kwh: 0.92, preferences: { demoVisual: true } }
}

const movementRows: InventoryOverview['movements'] = [
  ['1', 'filaments', '1', 'in', 1000, 800, 1800, 'Entrada PLA Preto +1 kg'],
  ['2', 'filaments', '2', 'out', 320, 720, 400, 'Saida PLA Branco -320 g'],
  ['3', 'filaments', '4', 'out', 180, 1380, 1200, 'Consumo PETG Preto -180 g'],
  ['4', 'products', '1', 'in', 12, 0, 12, 'Producao Suporte Headset'],
  ['5', 'products', '2', 'in', 8, 0, 8, 'Producao Organizador'],
  ['6', 'products', '4', 'adjustment', 5, 6, 5, 'Ajuste inventario vaso'],
  ['7', 'products', '6', 'out', 3, 6, 3, 'Separacao Miniatura Dragao']
].map(([id, resource, resourceId, type, quantity, previousQuantity, resultingQuantity, reason], index) => {
  const resourceName = resource === 'filaments'
    ? mockFilaments.find(item => item.id === resourceId)?.name
    : mockProducts.find(item => item.id === resourceId)?.name
  const product = mockProducts.find(item => item.id === resourceId)
  return {
    id: String(id), resource: resource as 'filaments' | 'products', resourceId: String(resourceId), type: type as 'in' | 'out' | 'adjustment',
    quantity: Number(quantity), previousQuantity: Number(previousQuantity), resultingQuantity: Number(resultingQuantity),
    reason: String(reason), createdAt: daysAgo(index + 1).toISOString(), resourceName, productName: product?.name, sku: product?.sku
  }
})

export const getMockInventoryOverview = (options: { from?: string; to?: string; resource?: string; type?: string; search?: string; limit?: number; offset?: number } = {}): InventoryOverview => {
  const search = String(options.search || '').toLowerCase()
  const rows = movementRows.filter(item =>
    (!options.resource || item.resource === options.resource) &&
    (!options.type || item.type === options.type) &&
    (!search || `${item.resourceName || ''} ${item.reason}`.toLowerCase().includes(search))
  )
  const offset = Number(options.offset || 0)
  const limit = Number(options.limit || 100)
  return {
    products: mockProducts.slice(0, 8).map((item, index) => ({ id: item.id || '', name: item.name, sku: item.sku, price: item.price, cost: item.cost, weight: item.weight, quantity: [12, 8, 5, 3, 18, 4, 7, 2][index], reservedQuantity: index % 3, status: index === 7 ? 'Reservado' : 'Disponivel', updatedAt: daysAgo(index).toISOString() })),
    movements: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset
  }
}

export const getMockOrdersPage = (params: { limit?: number; offset?: number; status?: string; salesChannel?: string; search?: string; from?: string; to?: string; clientId?: string } = {}): OrdersPage => {
  const term = String(params.search || '').toLowerCase()
  const rows = mockOrders.filter(item =>
    (!params.status || item.status === params.status) &&
    (!params.salesChannel || item.salesChannel === params.salesChannel) &&
    (!params.clientId || item.clientId === params.clientId) &&
    (!term || `${item.id} ${item.client} ${item.product} ${item.marketplace}`.toLowerCase().includes(term))
  )
  const offset = Number(params.offset || 0)
  const limit = Number(params.limit || 25)
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }
}

export const getMockFinancialHistory = (options: { resource?: string; limit?: number; offset?: number } = {}): FinancialHistoryPage => {
  const allItems = [
    ...mockProducts.slice(0, 5).map((item, index) => ({ id: `h-prod-${index}`, resource: 'products', resourceId: item.id || '', snapshot: { price: item.price, cost: item.cost, profit: item.profit, margin: item.margin }, source: index ? 'update' : 'create', createdAt: daysAgo(index + 2).toISOString() })),
    ...mockFilaments.slice(0, 3).map((item, index) => ({ id: `h-fil-${index}`, resource: 'filaments', resourceId: item.id || '', snapshot: { cost: item.cost, remaining_weight: item.remaining, initial_weight: item.initial }, source: 'resource', createdAt: daysAgo(index + 8).toISOString() })),
    ...mockMarketplaces.slice(0, 3).map((item, index) => ({ id: `h-mkt-${index}`, resource: 'marketplaces', resourceId: item.id || '', snapshot: { commission: item.commission, fixed: item.fixed, financial: item.financial, ads: item.ads, others: item.others }, source: 'update', createdAt: daysAgo(index + 12).toISOString() }))
  ]
  const filtered = options.resource ? allItems.filter(item => item.resource === options.resource) : allItems
  const offset = Number(options.offset || 0)
  const limit = Number(options.limit || 100)
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset }
}

export const getMockOrdersSummary = () => {
  const active = mockOrders.filter(item => item.status !== 'Cancelado')
  const cancelled = mockOrders.filter(item => item.status === 'Cancelado')
  return {
    orderCount: active.length,
    gross: active.reduce((sum, item) => sum + item.gross, 0),
    net: active.reduce((sum, item) => sum + item.net, 0),
    profit: active.reduce((sum, item) => sum + item.profit, 0),
    fees: active.reduce((sum, item) => sum + item.fee, 0),
    shipping: active.reduce((sum, item) => sum + item.shipping, 0),
    ticket: active.reduce((sum, item) => sum + item.gross, 0) / active.length,
    cancelledCount: cancelled.length,
    cancelledGross: cancelled.reduce((sum, item) => sum + item.gross, 0),
    byStatus: ['Aguardando', 'Producao', 'Envio', 'Concluido', 'Cancelado'].map(status => ({ status, count: mockOrders.filter(item => item.status === status).length }))
  }
}

export const mockSupportRequests: SupportRequest[] = [
  { id: 'mock-support-1', protocolNumber: '1000000000000001', status: 'pending', supportStatus: 'new', subject: 'Duvida sobre integracao mock', category: 'technical', priority: 'normal', requesterRole: 'owner', reason: 'Chamado visual mock.', scope: {}, createdAt: daysAgo(2).toISOString() },
  { id: 'mock-support-2', protocolNumber: '1000000000000002', status: 'under_review', supportStatus: 'in_progress', subject: 'Ajuste de assinatura mock', category: 'billing', priority: 'high', requesterRole: 'admin', reason: 'Chamado visual mock.', scope: {}, createdAt: daysAgo(5).toISOString() }
]

export const getMockBackupStatus = (): BackupStatus => ({ databaseAvailable: true, export: { enabled: true, format: 'json', excludes: ['tokens', 'secrets'] }, restore: { enabled: false, reason: 'Restore desativado no modo mock visual.' } })
export const getMockIntegrationsOverview = (): IntegrationsOverview => ({ marketplaces: mockAppData.marketplaceIntegrations || [], agents: [{ id: 'agent-1', name: 'Agent Mock Windows', machineName: 'printflow-review', platform: 'windows', status: 'online', lastSeenAt: daysAgo(0).toISOString() }], email: { provider: 'mock', status: 'connected' } })
export const getMockCalculatorSimulations = (): CalculatorSimulation[] => [{ id: 'calc-1', name: 'Simulacao suporte headset', pricePerKg: 82, weight: 74, durationMinutes: 165, energyEnabled: true, energyRate: 0.92, watts: 90, margin: 35, directCost: 31.4, suggestedPrice: 129.9, snapshot: { demoVisual: true }, createdAt: daysAgo(3).toISOString() }]
export const getMockPendingProductionMaterial = (): PendingProductionMaterial[] => [{ printJobId: '2', filamentId: '2', filamentName: 'PLA Branco', title: 'Mascara cosplay', reservedGrams: 320, consumptionGrams: 280, lastError: '', updatedAt: daysAgo(1).toISOString() }]
