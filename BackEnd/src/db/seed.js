import { pool, query, withTenant } from './pool.js'
import { migrate } from './migrate.js'
import { blindIndex, encryptField } from '../security/crypto.js'
import { hashPassword } from '../auth/password.js'
import { env } from '../config/env.js'

const TENANT_ID = 'demo'
const DEMO_MARKER = '[DEMO]'
const DEMO_USER_EMAIL = 'demo.local@printflow.test'
const DEMO_USER_PASSWORD = 'DemoLocal#2026'
const today = new Date()
const pad = (value) => String(value).padStart(2, '0')
const dateOnly = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const daysAgo = (days) => {
  const date = new Date(today)
  date.setDate(date.getDate() - days)
  return dateOnly(date)
}
const monthsAgo = (months, day = 15) => {
  const date = new Date(today.getFullYear(), today.getMonth() - months, day)
  return dateOnly(date)
}
const money = (value) => Number(value.toFixed(2))
const pick = (items, index) => items[index % items.length]

const assertDemoSeedAllowed = () => {
  if (!pool) throw new Error('DATABASE_URL nao configurada. Configure um banco local de desenvolvimento antes do seed.')
  if (env.isProduction || process.env.NODE_ENV === 'production') throw new Error('Seed demo bloqueado em NODE_ENV=production.')
  let hostname = ''
  try { hostname = new URL(env.databaseUrl).hostname.toLowerCase() } catch { throw new Error('Seed demo bloqueado: DATABASE_URL invalida.') }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) throw new Error('Seed demo bloqueado: o banco precisa estar em localhost, 127.0.0.1 ou ::1.')
}

const insertEncryptedClient = async (client, data) => {
  const result = await client.query(`
    insert into clients (
      tenant_id, name, name_hash, email, phone, client_type, document, document_hash,
      zip, address, address_number, complement, district, city, state, origin, notes, tags, status, created_at, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20
    ) returning id
  `, [
    TENANT_ID,
    encryptField(`${DEMO_MARKER} ${data.name}`),
    blindIndex(`${DEMO_MARKER} ${data.name}`),
    encryptField(data.email),
    encryptField(data.phone),
    data.type,
    encryptField(data.document),
    blindIndex(data.document),
    encryptField(data.zip),
    encryptField(data.address),
    encryptField(data.number),
    encryptField(data.complement || ''),
    encryptField(data.district),
    encryptField(data.city),
    encryptField(data.state),
    data.origin,
    encryptField(data.notes),
    data.tags,
    data.status,
    data.createdAt
  ])
  return result.rows[0].id
}

const seed = async () => {
  assertDemoSeedAllowed()
  await migrate()
  await query('delete from tenants where id = $1', [TENANT_ID])

  await query(`
    insert into tenants (id, name, email, is_initialized, account_status, billing_status, billing_enforcement_exempt)
    values ($1, $2, $3, true, 'active', 'active', true)
  `, [TENANT_ID, encryptField(`${DEMO_MARKER} Filamind Studio`), encryptField('contato@example.test')])

  await withTenant(TENANT_ID, async (client) => {
    const demoUser = await client.query(`
      insert into users (tenant_id, name, email, email_hash, password_hash, role, status, token_version, email_verified_at)
      values ($1, $2, $3, $4, $5, 'admin', 'active', 0, now())
      returning id
    `, [
      TENANT_ID,
      encryptField(`${DEMO_MARKER} Usuário Local`),
      encryptField(DEMO_USER_EMAIL),
      blindIndex(DEMO_USER_EMAIL),
      hashPassword(DEMO_USER_PASSWORD)
    ])
    await client.query(`
      insert into tenant_memberships (tenant_id, user_id, role, status)
      values ($1, $2, 'owner', 'active')
    `, [TENANT_ID, demoUser.rows[0].id])

    await client.query(`
      insert into company_settings (
        tenant_id, name, document, phone, email, address, district, city, state, zip, country, currency, timezone, kwh, preferences
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Brasil','Real (R$)','(GMT-03:00) Brasilia',0.92,$11::jsonb)
    `, [
      TENANT_ID,
      encryptField(`${DEMO_MARKER} Filamind Studio`),
      encryptField('00.000.000/0001-00'),
      encryptField('(11) 4000-0000'),
      encryptField('contato@example.test'),
      encryptField('Rua das Impressoras'),
      encryptField('Vila Maker'),
      encryptField('Sao Paulo'),
      encryptField('SP'),
      encryptField('01000-000'),
      JSON.stringify({ demoData: true, generatedAt: today.toISOString() })
    ])

    const marketplaces = [
      ['Mercado Livre', 'ML', '#ffe600', 'mercado_livre', 'connected', 12, 5.5, 2.2, 4, 0.8],
      ['Shopee', 'SP', '#ee4d2d', 'shopee', 'connected', 14, 3.5, 2, 5.2, 1],
      ['Amazon', 'AM', '#232f3e', 'amazon', 'connected', 15, 4.9, 1.8, 3.5, 1.2],
      ['Venda direta', 'VD', '#1768f2', 'custom', 'manual', 0, 0, 0, 0, 0]
    ]
    const marketplaceIds = {}
    for (const item of marketplaces) {
      const result = await client.query(`
        insert into marketplaces (tenant_id, name, short, color, platform, connection_status, commission, fixed, financial, ads, others, active)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) returning id
      `, [TENANT_ID, item[0], item[1], item[2], item[3], item[4], item[5], item[6], item[7], item[8], item[9]])
      marketplaceIds[item[3]] = result.rows[0].id
    }

    const integrations = []
    for (const platform of ['mercado_livre', 'shopee', 'amazon']) {
      const result = await client.query(`
        insert into marketplace_integrations (
          tenant_id, marketplace_id, platform, connection_name, account_external_id, account_external_id_hash,
          access_token, refresh_token, token_expires_at, status, scopes, last_sync_at
        ) values ($1,$2,$3,$4,$5,$6,'','',null,'connected','orders products inventory', now() - interval '2 hours')
        returning id, marketplace_id, platform
      `, [
        TENANT_ID,
        marketplaceIds[platform],
        platform,
        `${DEMO_MARKER} ${platform.replace('_', ' ')}`,
        encryptField(`demo-${platform}@example.test`),
        blindIndex(`demo-${platform}@example.test`)
      ])
      integrations.push(result.rows[0])
    }

    const clients = [
      ['Ana Carvalho', 'ana.carvalho@example.test', '(11) 90000-1001', 'Mooca', 'Sao Paulo', 'SP', 'Instagram', 'vip maker'],
      ['Bruno Martins', 'bruno.martins@example.test', '(21) 90000-1002', 'Botafogo', 'Rio de Janeiro', 'RJ', 'Mercado Livre', 'recorrente'],
      ['Camila Rocha', 'camila.rocha@example.test', '(31) 90000-1003', 'Savassi', 'Belo Horizonte', 'MG', 'Indicacao', 'decoracao'],
      ['Diego Almeida', 'diego.almeida@example.test', '(41) 90000-1004', 'Batel', 'Curitiba', 'PR', 'Shopee', 'rapido'],
      ['Escola Maker Alfa', 'compras.alfa@example.test', '(51) 90000-1005', 'Moinhos', 'Porto Alegre', 'RS', 'Site', 'b2b escola'],
      ['Fabiana Costa', 'fabiana.costa@example.test', '(61) 90000-1006', 'Asa Sul', 'Brasilia', 'DF', 'Amazon', 'presentes'],
      ['Gustavo Lima', 'gustavo.lima@example.test', '(71) 90000-1007', 'Pituba', 'Salvador', 'BA', 'Mercado Livre', 'miniaturas'],
      ['Helena Nunes', 'helena.nunes@example.test', '(81) 90000-1008', 'Boa Viagem', 'Recife', 'PE', 'Instagram', 'arquitetura'],
      ['Igor Pereira', 'igor.pereira@example.test', '(85) 90000-1009', 'Meireles', 'Fortaleza', 'CE', 'Shopee', 'gamer'],
      ['Julia Campos', 'julia.campos@example.test', '(48) 90000-1010', 'Centro', 'Florianopolis', 'SC', 'Site', 'organizacao'],
      ['Kauai Tech Lab', 'financeiro.kauai@example.test', '(19) 90000-1011', 'Cambuí', 'Campinas', 'SP', 'Indicacao', 'b2b prototipos'],
      ['Lara Moreira', 'lara.moreira@example.test', '(27) 90000-1012', 'Praia do Canto', 'Vitoria', 'ES', 'Amazon', 'casa'],
      ['Marcos Vieira', 'marcos.vieira@example.test', '(62) 90000-1013', 'Setor Bueno', 'Goiania', 'GO', 'Mercado Livre', 'cosplay'],
      ['Nina Freitas', 'nina.freitas@example.test', '(92) 90000-1014', 'Adrianopolis', 'Manaus', 'AM', 'Shopee', 'kids'],
      ['Oficina Beta', 'oficina.beta@example.test', '(16) 90000-1015', 'Centro', 'Ribeirao Preto', 'SP', 'Site', 'b2b reposicao'],
      ['Paulo Henrique', 'paulo.h@example.test', '(98) 90000-1016', 'Renascenca', 'Sao Luis', 'MA', 'Instagram', 'hobby']
    ]
    const clientIds = []
    for (const [index, item] of clients.entries()) {
      clientIds.push(await insertEncryptedClient(client, {
        name: item[0], email: item[1], phone: item[2], type: index % 5 === 4 ? 'Pessoa Juridica' : 'Pessoa Fisica',
        document: index % 5 === 4 ? `00.000.${pad(index)}0/0001-00` : `000.000.000-${pad(index)}`,
        zip: `0${pad(index + 10)}00-000`, address: 'Rua Demo', number: String(100 + index), district: item[3],
        city: item[4], state: item[5], origin: item[6], notes: 'Cliente ficticio para review de interface.', tags: item[7],
        status: index === 13 ? 'inactive' : 'active', createdAt: monthsAgo(10 - (index % 8), 8)
      }))
    }

    const filamentSeed = [
      ['PLA Preto Fosco', '3D Fila', 'PLA', '1.75mm', 'Preto', '#111827', 1000, 640, 250, 82, 'PrintParts'],
      ['PLA Branco Neve', 'Voolt', 'PLA', '1.75mm', 'Branco', '#f8fafc', 1000, 780, 300, 78, 'Voolt'],
      ['PETG Cristal', '3D Lab', 'PETG', '1.75mm', 'Transparente', '#bfdbfe', 1000, 420, 250, 96, '3D Lab'],
      ['TPU Azul Flex', 'FlexMaker', 'TPU', '1.75mm', 'Azul', '#2563eb', 500, 180, 150, 118, 'FlexMaker'],
      ['ASA Grafite', 'TechFil', 'ASA', '1.75mm', 'Grafite', '#374151', 1000, 920, 250, 132, 'TechFil'],
      ['PLA Madeira', '3D Fila', 'PLA', '1.75mm', 'Madeira', '#b45309', 1000, 260, 250, 105, 'PrintParts'],
      ['PETG Vermelho', 'Voolt', 'PETG', '1.75mm', 'Vermelho', '#dc2626', 1000, 70, 250, 94, 'Voolt']
    ]
    const filamentIds = []
    for (const [index, item] of filamentSeed.entries()) {
      const result = await client.query(`
        insert into filaments (tenant_id, name, maker, material, type, color, color_hex, initial_weight, remaining_weight, min_stock_weight, cost, supplier, purchase_date, status)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          case when $9::numeric = 0 then 'Esgotado' when $9::numeric <= $10::numeric then 'Baixo estoque' else 'Em estoque' end)
        returning id
      `, [TENANT_ID, `${DEMO_MARKER} ${item[0]}`, item[1], item[2], item[3], item[4], item[5], item[6], item[7], item[8], item[9], item[10], daysAgo(210 - index * 18)])
      filamentIds.push(result.rows[0].id)
    }

    const printerSeed = [
      ['Ender V3 SE', 'PF-01', 'Creality', 'Ender-3 V3 SE', 350, 1260, 'Imprimindo', 'Bancada A', '220x220x250'],
      ['Bambu Lab P1S', 'PF-02', 'Bambu Lab', 'P1S', 1000, 840, 'Disponivel', 'Bancada B', '256x256x256'],
      ['Prusa MK4', 'PF-03', 'Prusa', 'MK4', 240, 1560, 'Manutencao', 'Bancada C', '250x210x220'],
      ['K1 Max', 'PF-04', 'Creality', 'K1 Max', 1000, 430, 'Disponivel', 'Bancada A', '300x300x300'],
      ['Anycubic Photon', 'PF-05', 'Anycubic', 'Photon Mono X', 120, 290, 'Pausada', 'Resina', '192x120x245']
    ]
    const printerIds = []
    for (const [index, item] of printerSeed.entries()) {
      const result = await client.query(`
        insert into printers (tenant_id, name, code, maker, model, acquired_at, power_w, accumulated_hours, status, last_maintenance_at, serial, location, volume, default_filament, nozzle_mm, supported_materials, min_layer_height, max_layer_height)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PLA',0.4,'PLA, PETG, TPU',0.12,0.28)
        returning id
      `, [TENANT_ID, `${DEMO_MARKER} ${item[0]}`, item[1], item[2], item[3], daysAgo(520 - index * 55), item[4], item[5], item[6], daysAgo(35 + index * 9), `SERIAL-DEMO-${pad(index + 1)}`, item[7], item[8]])
      printerIds.push(result.rows[0].id)
    }

    const products = [
      ['Vaso geometrico modular', 'VGE-DEMO-001', 'Decoracao', 89.9, 115, '4h 20m', 34, 52, 'vase'],
      ['Suporte articulado para headset', 'SUP-DEMO-002', 'Organizacao', 69.9, 82, '3h 10m', 27, 50, 'stand'],
      ['Mini dragao flexivel', 'DRG-DEMO-003', 'Presentes', 54.9, 64, '2h 45m', 19, 65, 'dragon'],
      ['Kit porta temperos', 'KIT-DEMO-004', 'Casa', 119.9, 210, '6h 05m', 48, 45, 'box'],
      ['Chaveiro personalizado', 'CHV-DEMO-005', 'Personalizados', 24.9, 18, '45m', 7, 30, 'keychain'],
      ['Organizador de mesa hex', 'ORG-DEMO-006', 'Organizacao', 79.9, 130, '4h 55m', 36, 40, 'organizer'],
      ['Case Raspberry Pi ventilado', 'RPI-DEMO-007', 'Tecnologia', 49.9, 55, '2h 05m', 16, 35, 'case'],
      ['Luminaria lua suporte', 'LUA-DEMO-008', 'Decoracao', 139.9, 170, '7h 30m', 62, 50, 'lamp'],
      ['Peca reposicao dobradica', 'REP-DEMO-009', 'Reposicao', 39.9, 42, '1h 50m', 13, 30, 'part'],
      ['Torre dados RPG', 'RPG-DEMO-010', 'Games', 94.9, 124, '5h 15m', 41, 55, 'tower']
    ]
    const productIds = []
    for (const [index, item] of products.entries()) {
      const cost = item[6] + 7.5 + (index % 3) * 4
      const profit = item[3] - cost
      const result = await client.query(`
        insert into products (
          tenant_id, name, subtitle, sku, category, description, printer_id, printer, price, weight, print_time,
          layer_height, infill, dimensions, filament_id, filament, filament_color, packaging_cost,
          additional_materials_cost, labor_cost, marketplace_fee, desired_margin, cost, profit, margin, status, thumb, validation_status, cost_breakdown, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0.2,$12,$13,$14,$15,$16,4.5,$17,$18,12,35,$19,$20,$21,'Ativo',$22,'validated',$23::jsonb,$24,$24)
        returning id
      `, [
        TENANT_ID, `${DEMO_MARKER} ${item[0]}`, 'Produto demonstrativo para review', item[1], item[2],
        'Cadastro ficticio com parametros realistas de impressao 3D.', pick(printerIds, index), pick(printerSeed, index)[0],
        item[3], item[4], item[5], item[7], '120x80x60 mm', pick(filamentIds, index), filamentSeed[index % filamentSeed.length][0],
        filamentSeed[index % filamentSeed.length][5], 3 + (index % 4), item[6], cost, profit, money(profit / item[3] * 100), item[8],
        JSON.stringify({ material: item[6], packaging: 4.5, labor: 7.5, demoData: true }), monthsAgo(9 - (index % 6), 10)
      ])
      productIds.push(result.rows[0].id)

      const stock = 8 + (index * 3) % 22
      await client.query(`
        insert into product_inventory (tenant_id, product_id, quantity, reserved_quantity, status)
        values ($1,$2,$3,$4,case when $3::numeric = 0 then 'Esgotado' when $4::numeric >= $3::numeric then 'Reservado' else 'Disponivel' end)
      `, [TENANT_ID, result.rows[0].id, stock, index % 4])
    }

    for (const [index, productId] of productIds.entries()) {
      await client.query(`
        insert into inventory_movements (tenant_id, resource, resource_id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_at)
        values ($1,'products',$2,'in',$3,0,$3,$4,$5), ($1,'products',$2,'out',$6,$3,$7,$8,$9)
      `, [TENANT_ID, productId, 20 + index * 2, `${DEMO_MARKER} producao inicial`, monthsAgo(5, 4 + index), 4 + (index % 5), 16 + index * 2 - (index % 5), `${DEMO_MARKER} separacao de pedidos`, daysAgo(22 + index)])
    }
    for (const [index, filamentId] of filamentIds.entries()) {
      await client.query(`
        insert into inventory_movements (tenant_id, resource, resource_id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_at)
        values ($1,'filaments',$2,'in',$3,0,$3,$4,$5), ($1,'filaments',$2,'out',$6,$3,$7,$8,$9)
      `, [TENANT_ID, filamentId, 1000, `${DEMO_MARKER} compra de reposicao`, monthsAgo(6, 6 + index), 120 + index * 25, 880 - index * 25, `${DEMO_MARKER} consumo em producao`, daysAgo(30 + index * 3)])
    }

    const statuses = ['Novo', 'Em producao', 'Enviado', 'Concluido', 'Concluido', 'Concluido', 'Cancelado']
    let orderCounter = 12800
    for (let index = 0; index < 96; index += 1) {
      const productIndex = index % productIds.length
      const quantity = 1 + (index % 4 === 0 ? 1 : 0)
      const price = Number(products[productIndex][3])
      const gross = money(price * quantity)
      const direct = index % 5 === 0
      const marketplaceKey = direct ? 'custom' : pick(['mercado_livre', 'shopee', 'amazon'], index)
      const fee = direct ? 0 : money(gross * (0.11 + (index % 4) * 0.012))
      const shipping = direct ? 0 : money(9.9 + (index % 3) * 4)
      const cost = Number(products[productIndex][6]) * quantity
      const net = money(gross - fee - shipping)
      const status = pick(statuses, index)
      await client.query(`
        insert into orders (
          tenant_id, external_id, order_date, client_id, marketplace_id, product_id, product_name, quantity,
          gross, fee, shipping, net, profit, status, delivery_tracking_code, packed_at, shipped_at, delivered_at, sales_channel, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$3::date)
      `, [
        TENANT_ID, `DEMO-${orderCounter + index}`, daysAgo(12 + index * 2), pick(clientIds, index), marketplaceIds[marketplaceKey],
        productIds[productIndex], products[productIndex][0], quantity, gross, fee, shipping, net,
        status === 'Cancelado' ? 0 : money(net - cost), status, status === 'Enviado' || status === 'Concluido' ? `BRDEMO${orderCounter + index}` : '',
        ['Enviado', 'Concluido'].includes(status) ? `${daysAgo(11 + index * 2)}T10:00:00Z` : null,
        ['Enviado', 'Concluido'].includes(status) ? `${daysAgo(10 + index * 2)}T14:00:00Z` : null,
        status === 'Concluido' ? `${daysAgo(7 + index * 2)}T16:00:00Z` : null,
        direct ? 'direct' : 'marketplace'
      ])
    }

    for (let index = 0; index < 42; index += 1) {
      const integration = pick(integrations, index)
      const productIndex = (index * 2) % products.length
      const quantity = 1 + (index % 3 === 0 ? 2 : 0)
      const gross = money(Number(products[productIndex][3]) * quantity)
      const fee = money(gross * 0.145)
      const shipping = money(8.9 + (index % 4) * 3)
      const net = money(gross - fee - shipping)
      await client.query(`
        insert into tracked_sales (
          tenant_id, integration_id, marketplace_id, platform, external_order_id, external_order_hash, line_key,
          external_sku, external_sku_hash, product_name, quantity, gross, marketplace_fee, shipping, net, cost, profit,
          status, requires_review, review_reason, last_synced_at, sold_at, fee_breakdown
        ) values ($1,$2,$3,$4,$5,$6,'default',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),$20,$21::jsonb)
      `, [
        TENANT_ID, integration.id, integration.marketplace_id, integration.platform,
        encryptField(`MKT-DEMO-${15000 + index}`), blindIndex(`MKT-DEMO-${15000 + index}`),
        products[productIndex][1], blindIndex(products[productIndex][1]), products[productIndex][0], quantity, gross, fee, shipping, net,
        Number(products[productIndex][6]) * quantity, money(net - Number(products[productIndex][6]) * quantity),
        pick(['received', 'paid', 'shipped', 'delivered', 'delivered'], index), index % 13 === 0,
        index % 13 === 0 ? 'SKU aguardando vinculo manual' : '', `${daysAgo(8 + index * 3)}T12:00:00Z`,
        JSON.stringify({ demoData: true, commission: fee })
      ])
    }

    const expenseRows = [
      ['Filamento e resina', 'Materiais', 'PrintParts', 1840, 'Pix'],
      ['Energia eletrica', 'Operacional', 'Companhia de Energia', 720, 'Boleto'],
      ['Embalagens e etiquetas', 'Logistica', 'PackBox', 390, 'Cartao'],
      ['Manutencao preventiva', 'Manutencao', 'TechFix', 560, 'Pix'],
      ['Assinatura software CAD', 'Software', 'Autodesk', 280, 'Cartao'],
      ['Anuncios marketplaces', 'Marketing', 'Ads Manager', 640, 'Cartao'],
      ['Fretes complementares', 'Logistica', 'Correios', 430, 'Boleto'],
      ['Impostos Simples Nacional', 'Tributos', 'Receita Federal', 1120, 'Debito automatico']
    ]
    for (let month = 0; month < 8; month += 1) {
      for (const [index, item] of expenseRows.entries()) {
        const amount = money(item[3] * (0.82 + ((month + index) % 5) * 0.07))
        await client.query(`
          insert into expenses (tenant_id, description, category, supplier, amount, expense_date, payment, recurrence, status, next_due_date, notes)
          values ($1,$2,$3,$4,$5,$6,$7,$8,'Pago',$9,$10)
        `, [TENANT_ID, `${DEMO_MARKER} ${item[0]}`, item[1], item[2], amount, monthsAgo(month, 8 + (index % 16)), item[4], index < 2 ? 'Mensal' : 'Nao recorrente', monthsAgo(month - 1, 8 + (index % 16)), 'Despesa ficticia para review financeiro.'])
      }
    }

    const currentStart = dateOnly(new Date(today.getFullYear(), today.getMonth(), 1))
    const currentEnd = dateOnly(new Date(today.getFullYear(), today.getMonth() + 1, 0))
    const goals = [
      ['Faturamento mensal demo', 'revenue', 28000, '#1768f2', 'target'],
      ['Lucro liquido demo', 'profit', 11800, '#16a34a', 'trending-up'],
      ['Quantidade de pedidos demo', 'orders', 48, '#f59e0b', 'shopping-cart'],
      ['Ticket medio demo', 'average_ticket', 155, '#7c3aed', 'receipt']
    ]
    for (const item of goals) {
      await client.query(`
        insert into goals (tenant_id, name, goal_type, current_value, target_value, color, icon, period_start, period_end, status)
        values ($1,$2,$3,0,$4,$5,$6,$7,$8,'Ativa')
      `, [TENANT_ID, `${DEMO_MARKER} ${item[0]}`, item[1], item[2], item[3], item[4], currentStart, currentEnd])
    }

    for (const productId of productIds) {
      await client.query(`
        insert into financial_history (tenant_id, resource, resource_id, snapshot, source, created_at)
        values ($1,'products',$2,$3::jsonb,'demo_seed',now() - interval '20 days')
      `, [TENANT_ID, String(productId), JSON.stringify({ demoData: true, event: 'price_review' })])
    }

    for (let index = 0; index < 12; index += 1) {
      const requestId = `demo-support-${pad(index + 1)}`
      await client.query(`
        insert into tenant_audit_requests (
          id, tenant_id, requested_by, reason, scope, status, subject, category, priority, requester_role,
          request_kind, due_at, support_status, support_tags, created_at, updated_at
        ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'admin','support',$10,$11,$12::jsonb,$13,$13)
      `, [
        requestId, TENANT_ID, 'demo-user', 'Solicitacao ficticia para review.', JSON.stringify({ demoData: true }),
        pick(['pending', 'under_review', 'closed'], index), `${DEMO_MARKER} Chamado ${index + 1}`,
        pick(['billing', 'technical', 'account'], index), pick(['normal', 'high', 'low'], index), daysAgo(index),
        pick(['new', 'in_progress', 'resolved'], index), JSON.stringify(['demo', pick(['financeiro', 'impressoras', 'integracoes'], index)]), daysAgo(18 - index)
      ])
      await client.query(`
        insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body, created_at, visibility)
        values ($1,$2,'owner','demo-user',$3,$4,'public')
      `, [TENANT_ID, requestId, 'Mensagem ficticia para validar a tela de ajuda e suporte.', daysAgo(18 - index)])
    }
  })

  console.log('Seed demo concluido.')
  console.log('Tenant: demo')
  console.log('Login local: demo.local@printflow.test')
  console.log('Dados: 16 clientes, 10 produtos, 7 filamentos, 5 impressoras, 138 vendas, 64 despesas, 4 metas, 12 chamados.')
}

try {
  await seed()
} catch (error) {
  console.error('Falha ao executar seed demo.', error)
  process.exitCode = 1
} finally {
  await pool?.end()
}
