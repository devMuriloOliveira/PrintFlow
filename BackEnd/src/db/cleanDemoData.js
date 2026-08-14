import { pool, query } from './pool.js'

const demoTenantIds = ['demo']
const demoProductSkus = ['VGE-001', 'SUP-CEL-002', 'ORG-CAB-003', 'KEY-ART-004', 'MINI-PLANT-005']

try {
  if (!pool) {
    console.log('DATABASE_URL nao configurada. Nenhuma limpeza executada.')
    process.exit(0)
  }

  for (const tenantId of demoTenantIds) {
    await query('delete from tenants where id = $1', [tenantId])
  }

  await query('delete from products where sku = any($1)', [demoProductSkus])
  await query("delete from company_settings where name = 'Empresa Demo' or document = 'documento-demo'")
  await query("delete from goals where name in ('Faturamento mensal', 'Lucro liquido', 'Quantidade de pedidos', 'Reducao de despesas')")

  console.log('Dados de demonstracao removidos sem apagar usuarios ou estrutura.')
} catch (error) {
  console.error('Falha ao limpar dados de demonstracao.', error)
  process.exitCode = 1
} finally {
  await pool?.end()
}
