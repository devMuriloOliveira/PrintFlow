import { hasDatabase, query } from './pool.js'

export const migrate = async () => {
  if (!hasDatabase) {
    return
  }

  await query(`
    create extension if not exists pgcrypto;
  `)

  await query(`
    create table if not exists tenants (
      id text primary key,
      name text not null,
      document text,
      email text,
      phone text,
      kwh_cost numeric(12, 4) not null default 0.68,
      currency text not null default 'BRL',
      timezone text not null default 'America/Sao_Paulo',
      created_at timestamptz not null default now()
    );
  `)

  await query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      email text not null,
      password_hash text,
      role text not null default 'admin',
      status text not null default 'Ativo',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, email)
    );
  `)

  await query(`
    create table if not exists categories (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      type text not null,
      name text not null,
      color text,
      created_at timestamptz not null default now(),
      unique (tenant_id, type, name)
    );
  `)

  await query(`
    create table if not exists suppliers (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      document text,
      email text,
      phone text,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, name)
    );
  `)

  await query(`
    create table if not exists clients (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      type text not null default 'Pessoa Fisica',
      document text,
      phone text,
      email text,
      zip text,
      address text,
      number text,
      complement text,
      district text,
      city text,
      state text,
      origin text,
      tags text[] not null default '{}',
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await query(`
    create table if not exists products (
      id bigserial primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      subtitle text,
      sku text not null,
      category text,
      price numeric(12, 2) not null default 0,
      weight numeric(12, 2) not null default 0,
      print_time text,
      filament text,
      filament_color text,
      cost numeric(12, 2) not null default 0,
      profit numeric(12, 2) not null default 0,
      margin numeric(12, 2) not null default 0,
      status text not null default 'Ativo',
      thumb text not null default 'vase',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, sku)
    );
  `)

  await query(`
    create table if not exists filaments (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      maker text not null,
      material text not null,
      diameter text not null,
      color text not null,
      color_hex text not null default '#1768f2',
      initial_weight_g numeric(12, 2) not null default 0,
      remaining_weight_g numeric(12, 2) not null default 0,
      minimum_stock_g numeric(12, 2) not null default 0,
      roll_cost numeric(12, 2) not null default 0,
      supplier_id uuid references suppliers(id) on delete set null,
      supplier_name text,
      purchase_date date,
      status text not null default 'Em estoque',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, name, maker, color)
    );
  `)

  await query(`
    create table if not exists printers (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      code text not null,
      maker text not null,
      model text not null,
      serial text,
      acquired_at date,
      purchase_price numeric(12, 2) not null default 0,
      power_w numeric(12, 2) not null default 0,
      average_consumption_kwh numeric(12, 4) not null default 0,
      volume_x_mm numeric(12, 2),
      volume_y_mm numeric(12, 2),
      volume_z_mm numeric(12, 2),
      nozzle_mm numeric(12, 2),
      firmware text,
      accumulated_hours numeric(12, 2) not null default 0,
      status text not null default 'Disponivel',
      location text,
      default_filament_id uuid references filaments(id) on delete set null,
      last_maintenance_at date,
      next_maintenance_at date,
      maintenance_interval_hours numeric(12, 2),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, code)
    );
  `)

  await query(`
    create table if not exists marketplaces (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      short text not null,
      color text not null default '#1768f2',
      logo_url text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, name)
    );
  `)

  await query(`
    create table if not exists marketplace_fee_versions (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      marketplace_id uuid not null references marketplaces(id) on delete cascade,
      commission_percent numeric(12, 4) not null default 0,
      fixed_fee numeric(12, 2) not null default 0,
      financial_percent numeric(12, 4) not null default 0,
      ads_percent numeric(12, 4) not null default 0,
      other_percent numeric(12, 4) not null default 0,
      starts_at date not null,
      created_at timestamptz not null default now(),
      unique (tenant_id, marketplace_id, starts_at)
    );
  `)

  await query(`
    create table if not exists expenses (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      description text not null,
      value numeric(12, 2) not null default 0,
      category text not null,
      supplier_id uuid references suppliers(id) on delete set null,
      supplier_name text,
      expense_date date not null,
      payment_method text not null,
      is_recurring boolean not null default false,
      recurrence_frequency text,
      next_due_date date,
      receipt_url text,
      notes text,
      status text not null default 'Pago',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await query(`
    create table if not exists orders (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      external_code text not null,
      order_date date not null,
      client_id uuid references clients(id) on delete set null,
      client_name text not null,
      marketplace_id uuid references marketplaces(id) on delete set null,
      marketplace_name text not null,
      gross numeric(12, 2) not null default 0,
      fee numeric(12, 2) not null default 0,
      shipping numeric(12, 2) not null default 0,
      net numeric(12, 2) not null default 0,
      profit numeric(12, 2) not null default 0,
      status text not null default 'Novo',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, external_code)
    );
  `)

  await query(`
    create table if not exists order_items (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      order_id uuid not null references orders(id) on delete cascade,
      product_id bigint references products(id) on delete set null,
      product_name text not null,
      quantity integer not null default 1,
      unit_price numeric(12, 2) not null default 0,
      unit_cost numeric(12, 2) not null default 0,
      created_at timestamptz not null default now()
    );
  `)

  await query(`
    create table if not exists goals (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      type text not null,
      name text not null,
      target numeric(12, 2) not null default 0,
      current_value numeric(12, 2) not null default 0,
      starts_at date not null,
      ends_at date not null,
      compare_previous boolean not null default false,
      previous_value numeric(12, 2) not null default 0,
      color text not null default '#1768f2',
      icon text not null default 'target',
      status text not null default 'Ativa',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)

  await query(`
    create table if not exists settings (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      key text not null,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      unique (tenant_id, key)
    );
  `)

  await query('create index if not exists products_tenant_id_idx on products (tenant_id);')
  await query('create index if not exists users_tenant_id_idx on users (tenant_id);')
  await query('create index if not exists clients_tenant_id_idx on clients (tenant_id);')
  await query('create index if not exists expenses_tenant_id_idx on expenses (tenant_id);')
  await query('create index if not exists filaments_tenant_id_idx on filaments (tenant_id);')
  await query('create index if not exists printers_tenant_id_idx on printers (tenant_id);')
  await query('create index if not exists marketplaces_tenant_id_idx on marketplaces (tenant_id);')
  await query('create index if not exists marketplace_fee_versions_tenant_marketplace_idx on marketplace_fee_versions (tenant_id, marketplace_id);')
  await query('create index if not exists orders_tenant_id_idx on orders (tenant_id);')
  await query('create index if not exists order_items_tenant_order_idx on order_items (tenant_id, order_id);')
  await query('create index if not exists goals_tenant_id_idx on goals (tenant_id);')
}
