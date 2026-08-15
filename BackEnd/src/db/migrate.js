import { hasDatabase, query } from './pool.js'

const tenantTables = [
  'products', 'orders', 'expenses', 'filaments', 'printers', 'marketplaces',
  'clients', 'goals', 'company_settings', 'calculator_simulations', 'export_history',
  'tracked_sales', 'marketplace_webhook_events'
]

const enableTenantIsolation = async (table) => {
  await query(`alter table ${table} enable row level security`)
  await query(`alter table ${table} force row level security`)
  await query(`drop policy if exists ${table}_tenant_isolation on ${table}`)
  await query(`
    create policy ${table}_tenant_isolation on ${table}
    using (tenant_id = current_setting('app.tenant_id', true))
    with check (tenant_id = current_setting('app.tenant_id', true))
  `)
}

export const migrate = async () => {
  if (!hasDatabase) return

  await query(`
    create table if not exists tenants (
      id text primary key,
      name text not null,
      is_initialized boolean not null default false,
      created_at timestamptz not null default now()
    )
  `)
  await query('alter table tenants add column if not exists is_initialized boolean not null default false')
  await query('alter table tenants add column if not exists document text')
  await query('alter table tenants add column if not exists email text')
  await query('alter table tenants add column if not exists phone text')
  await query("alter table tenants add column if not exists kwh_cost numeric(12,4) not null default 0.68")
  await query("alter table tenants add column if not exists currency text not null default 'BRL'")
  await query("alter table tenants add column if not exists timezone text not null default 'America/Sao_Paulo'")

  await query(`
    create table if not exists users (
      id bigserial primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      email text not null,
      password_hash text not null default '',
      role text not null default 'admin',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, email),
      unique (email)
    )
  `)
  await query("alter table users add column if not exists password_hash text not null default ''")
  await query("alter table users add column if not exists status text not null default 'active'")
  await query("alter table users add column if not exists email_hash text")
  await query('create index if not exists users_tenant_id_idx on users (tenant_id)')
  await query('create unique index if not exists users_email_hash_unique on users (email_hash) where email_hash is not null')

  await query(`
    create table if not exists products (
      id bigserial primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null, subtitle text, sku text not null, category text, description text,
      printer text, price numeric(12,2) not null default 0, weight numeric(12,2) not null default 0,
      print_time text, layer_height numeric(6,3) not null default 0, infill numeric(6,2) not null default 0,
      dimensions text, filament text, filament_color text,
      packaging_cost numeric(12,2) not null default 0, additional_materials_cost numeric(12,2) not null default 0,
      labor_cost numeric(12,2) not null default 0, energy_enabled boolean not null default true,
      marketplace_fee numeric(8,2) not null default 0, desired_margin numeric(8,2) not null default 0,
      cost numeric(12,2) not null default 0, profit numeric(12,2) not null default 0,
      margin numeric(12,2) not null default 0, status text not null default 'Ativo',
      thumb text not null default 'vase', created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), unique (tenant_id, sku)
    )
  `)
  const productColumns = [
    'description text', 'printer text', 'layer_height numeric(6,3) not null default 0',
    'infill numeric(6,2) not null default 0', 'dimensions text',
    'printer_id bigint',
    'filament_id bigint',
    'packaging_cost numeric(12,2) not null default 0',
    'additional_materials_cost numeric(12,2) not null default 0',
    'labor_cost numeric(12,2) not null default 0', 'energy_enabled boolean not null default true',
    'marketplace_fee numeric(8,2) not null default 0', 'desired_margin numeric(8,2) not null default 0'
  ]
  for (const column of productColumns) await query(`alter table products add column if not exists ${column}`)

  await query(`
    create table if not exists clients (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      name text not null, email text not null default 'nao-informado',
      phone text not null default 'nao-informado', created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await query("alter table clients add column if not exists name_hash text")
  await query('create index if not exists clients_tenant_name_hash_idx on clients (tenant_id, name_hash)')
  await query(`
    create table if not exists marketplaces (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      name text not null, short text not null default '', color text not null default '#1768f2',
      commission numeric(8,2) not null default 0, fixed numeric(12,2) not null default 0,
      financial numeric(8,2) not null default 0, ads numeric(8,2) not null default 0,
      others numeric(8,2) not null default 0, active boolean not null default true,
      created_at timestamptz not null default now(), unique (tenant_id, name)
    )
  `)
  await query("alter table marketplaces add column if not exists platform text not null default 'custom'")
  await query("alter table marketplaces add column if not exists connection_status text not null default 'manual'")
  await query(`
    create table if not exists marketplace_integrations (
      id bigserial primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      marketplace_id bigint references marketplaces(id) on delete set null,
      platform text not null,
      connection_name text not null default '',
      account_external_id text not null default '',
      account_external_id_hash text not null default '',
      access_token text not null default '',
      refresh_token text not null default '',
      token_expires_at timestamptz,
      status text not null default 'pending',
      scopes text not null default '',
      last_sync_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, platform, account_external_id_hash)
    )
  `)
  await query('create index if not exists marketplace_integrations_lookup_idx on marketplace_integrations (platform, account_external_id_hash)')
  await query(`
    create table if not exists tracked_sales (
      id bigserial primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      integration_id bigint references marketplace_integrations(id) on delete set null,
      marketplace_id bigint references marketplaces(id) on delete set null,
      platform text not null,
      external_order_id text not null default '',
      external_order_hash text not null default '',
      gross numeric(12,2) not null default 0,
      marketplace_fee numeric(12,2) not null default 0,
      shipping numeric(12,2) not null default 0,
      net numeric(12,2) not null default 0,
      cost numeric(12,2) not null default 0,
      profit numeric(12,2) not null default 0,
      status text not null default 'received',
      sold_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, platform, external_order_hash)
    )
  `)
  await query(`
    create table if not exists marketplace_webhook_events (
      id bigserial primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      integration_id bigint references marketplace_integrations(id) on delete set null,
      platform text not null,
      event_type text not null default '',
      external_order_id text not null default '',
      payload text not null default '',
      status text not null default 'received',
      created_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists orders (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      external_id text not null, order_date date not null, client_id bigint references clients(id) on delete set null,
      marketplace_id bigint references marketplaces(id) on delete set null, product_id bigint references products(id) on delete set null,
      product_name text not null default '', quantity integer not null default 1,
      gross numeric(12,2) not null default 0, fee numeric(12,2) not null default 0,
      shipping numeric(12,2) not null default 0, net numeric(12,2) not null default 0,
      profit numeric(12,2) not null default 0, status text not null default 'Novo',
      created_at timestamptz not null default now(), unique (tenant_id, external_id)
    )
  `)
  await query(`
    create table if not exists expenses (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      description text not null, category text not null default 'Outros', supplier text not null default '',
      amount numeric(12,2) not null default 0, expense_date date not null, payment text not null default '',
      recurrence text not null default 'Nao recorrente', status text not null default 'Pago', next_due_date date,
      created_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists filaments (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      name text not null, maker text not null default '', material text not null default '', type text not null default '',
      color text not null default '', color_hex text not null default '#ccd3df',
      initial_weight numeric(12,2) not null default 0, remaining_weight numeric(12,2) not null default 0,
      cost numeric(12,2) not null default 0, supplier text not null default '', purchase_date date,
      status text not null default 'Em estoque', created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), unique (tenant_id, name)
    )
  `)
  await query(`
    create table if not exists printers (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      name text not null, code text not null, maker text not null default '', model text not null default '',
      acquired_at date, power_w numeric(12,2) not null default 0, accumulated_hours numeric(12,2) not null default 0,
      status text not null default 'Disponivel', last_maintenance_at date, serial text not null default '',
      location text not null default '', volume text not null default '', default_filament text not null default '',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, code)
    )
  `)
  await query(`
    create table if not exists goals (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      name text not null, current_value numeric(12,2) not null default 0, target_value numeric(12,2) not null default 0,
      color text not null default '#1768f2', icon text not null default 'target', period_start date not null,
      period_end date not null, status text not null default 'Ativa', created_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists company_settings (
      tenant_id text primary key references tenants(id) on delete cascade, name text not null default '',
      document text not null default '', phone text not null default '', email text not null default '',
      address text not null default '', district text not null default '', city text not null default '',
      state text not null default '', zip text not null default '', country text not null default 'Brasil',
      currency text not null default 'Real (R$)', timezone text not null default '(GMT-03:00) Brasilia',
      kwh numeric(12,4) not null default 0, updated_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists calculator_simulations (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      name text not null default 'Simulacao sem nome', price_per_kg numeric(12,2) not null default 0,
      weight numeric(12,2) not null default 0, duration_minutes integer not null default 0,
      energy_enabled boolean not null default true, energy_rate numeric(12,4) not null default 0,
      watts numeric(12,2) not null default 0, margin numeric(12,2) not null default 0,
      direct_cost numeric(12,2) not null default 0, suggested_price numeric(12,2) not null default 0,
      created_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists export_history (
      id bigserial primary key, tenant_id text not null references tenants(id) on delete cascade,
      file_name text not null, export_type text not null, file_format text not null,
      period_start date, period_end date, record_count integer not null default 0,
      status text not null default 'Concluido', created_at timestamptz not null default now()
    )
  `)

  for (const table of tenantTables) {
    await query(`create index if not exists ${table}_tenant_id_idx on ${table} (tenant_id)`)
    await enableTenantIsolation(table)
  }
}
