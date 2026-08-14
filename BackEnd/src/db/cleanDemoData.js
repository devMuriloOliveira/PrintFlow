import { pool, query } from './pool.js'

const demoTenantIds = ['demo']
const demoProductSkus = ['VGE-001', 'SUP-002', 'DIN-003', 'PTM-004', 'CHV-005']
const demoOrderIds = ['#10845', '#10844', '#10843', '#10842', '#10841', '#10840', '#10839', '#10838', '#10837', '#10836']
const demoPrinterSerials = ['SERIAL-DEMO-001', 'SERIAL-DEMO-002', 'SERIAL-DEMO-003', 'SERIAL-DEMO-004', 'SERIAL-DEMO-005', 'SERIAL-DEMO-006']
const demoClientNames = ['Cliente 001', 'Cliente 002', 'Cliente 003', 'Cliente 004', 'Cliente 005', 'Cliente 006', 'Cliente 007', 'Cliente 008', 'Cliente 009', 'Cliente 010']
const demoExpenseDescriptions = [
  'Filamento PLA Preto 1kg',
  'Conta de Energia',
  'Caixa de Papelao 30x20x10',
  'Impressora Creality Ender 3',
  'Manutencao Impressora',
  'Assinatura Fusion 360',
  'Taxa Mercado Livre',
  'Anuncios Google Ads',
  'Impostos Simples Nacional',
  'Frete Correios'
]
const demoFilamentNames = ['PLA Preto', 'PLA Branco', 'PETG Cinza', 'TPU Azul', 'ASA Preto']

try {
  if (!pool) {
    console.log('DATABASE_URL nao configurada. Nenhuma limpeza executada.')
    process.exit(0)
  }

  for (const tenantId of demoTenantIds) {
    await query('delete from tenants where id = $1', [tenantId])
  }

  await query('delete from products where sku = any($1)', [demoProductSkus])
  await query('delete from orders where external_id = any($1)', [demoOrderIds])
  await query('delete from printers where serial = any($1)', [demoPrinterSerials])
  await query('delete from expenses where description = any($1)', [demoExpenseDescriptions])
  await query('delete from filaments where name = any($1)', [demoFilamentNames])
  await query('delete from clients where name = any($1)', [demoClientNames])
  await query("delete from company_settings where name = 'Empresa Demo' or document = 'documento-demo'")
  await query("delete from goals where name in ('Faturamento mensal', 'Lucro liquido', 'Quantidade de pedidos', 'Reducao de despesas')")

  console.log('Dados de demonstracao removidos sem apagar usuarios ou estrutura.')
} catch (error) {
  console.error('Falha ao limpar dados de demonstracao.', error)
  process.exitCode = 1
} finally {
  await pool?.end()
}
