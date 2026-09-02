export const ensureTenantData = async (client, tenantId) => {
  await client.query(`
    insert into tenants (id, name, is_initialized) values ($1, $1, false)
    on conflict (id) do nothing
  `, [tenantId])

  const result = await client.query('select is_initialized from tenants where id = $1 for update', [tenantId])
  if (result.rows[0]?.is_initialized) return

  await client.query(`
    insert into company_settings (tenant_id, name, currency, timezone, kwh)
    values ($1, '', 'Real (R$)', '(GMT-03:00) Brasilia', 0)
    on conflict (tenant_id) do nothing
  `, [tenantId])
  await client.query('update tenants set is_initialized = true where id = $1', [tenantId])
}
