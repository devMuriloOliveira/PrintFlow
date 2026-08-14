import { hasDatabase, query } from './pool.js'

export const migrate = async () => {
  if (!hasDatabase) {
    return
  }

  await query(`
    create table if not exists tenants (
      id text primary key,
      name text not null,
      created_at timestamptz not null default now()
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

  await query('create index if not exists products_tenant_id_idx on products (tenant_id);')
}
