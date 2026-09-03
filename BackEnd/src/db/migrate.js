import {
  hasDatabase,
  query
} from './pool.js'

// ======================================================
// TABELAS COM ISOLAMENTO POR TENANT
// ======================================================

const tenantTables = [
  'products',
  'orders',
  'print_jobs',
  'expenses',
  'filaments',
  'printers',

  'agents',
  'agent_pairing_codes',
  'agent_commands',
  'agent_printers',

  'marketplaces',
  'clients',
  'goals',
  'company_settings',
  'calculator_simulations',
  'export_history',
  'marketplace_integrations',
  'marketplace_oauth_attempts',
  'marketplace_product_links',
  'tracked_sales',
  'marketplace_webhook_events',
  'operational_notifications',
  'operational_audit_events',
  'tenant_memberships',
  'tenant_invitations'
]

// ======================================================
// HABILITAR RLS POR TENANT
// ======================================================

const enableTenantIsolation =
  async (
    table
  ) => {
    await query(
      `
        alter table ${table}
        enable row level security
      `
    )

    await query(
      `
        alter table ${table}
        force row level security
      `
    )

    await query(
      `
        drop policy if exists
          ${table}_tenant_isolation
        on ${table}
      `
    )

    await query(
      `
        create policy
          ${table}_tenant_isolation
        on ${table}

        using (
          tenant_id =
          current_setting(
            'app.tenant_id',
            true
          )
        )

        with check (
          tenant_id =
          current_setting(
            'app.tenant_id',
            true
          )
        )
      `
    )
  }

// ======================================================
// MIGRAÇÕES
// ======================================================

export const migrate =
  async () => {
    if (!hasDatabase) {
      return
    }

    // ==================================================
    // TENANTS
    // ==================================================

    await query(
      `
        create table if not exists tenants (
          id text primary key,

          name text not null,

          is_initialized
            boolean
            not null
            default false,

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          is_initialized
          boolean
          not null
          default false
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          document text
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          email text
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          phone text
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          kwh_cost
          numeric(12,4)
          not null
          default 0.68
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          currency
          text
          not null
          default 'BRL'
      `
    )

    await query(
      `
        alter table tenants
        add column if not exists
          timezone
          text
          not null
          default 'America/Sao_Paulo'
      `
    )

    await query(`alter table tenants add column if not exists account_status text not null default 'active'`)
    await query(`alter table tenants add column if not exists billing_status text not null default 'not_configured'`)
    await query(`alter table tenants add column if not exists billing_due_at timestamptz`)

    // ==================================================
    // USERS
    // ==================================================

    await query(
      `
        create table if not exists users (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name text not null,

          email text not null,

          password_hash
            text
            not null
            default '',

          role
            text
            not null
            default 'admin',

          status
            text
            not null
            default 'active',

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            email
          ),

          unique (
            email
          )
        )
      `
    )

    await query(
      `
        alter table users
        add column if not exists
          password_hash
          text
          not null
          default ''
      `
    )

    await query(
      `
        alter table users
        add column if not exists
          status
          text
          not null
          default 'active'
      `
    )

    await query(
      `
        alter table users
        add column if not exists
          email_hash text
      `
    )

    await query(
      `
        alter table users
        add column if not exists
          token_version
          integer
          not null
          default 0
      `
    )

    await query(
      `
        create index if not exists
          users_tenant_id_idx
        on users (
          tenant_id
        )
      `
    )

    await query(
      `
        create table if not exists marketplace_oauth_attempts (
          id text primary key,
          tenant_id text not null references tenants(id) on delete cascade,
          platform text not null,
          code_verifier text not null default '',
          expires_at timestamptz not null,
          consumed_at timestamptz,
          created_at timestamptz not null default now()
        )
      `
    )

    await query(
      `
        create index if not exists marketplace_oauth_attempts_active_idx
        on marketplace_oauth_attempts (tenant_id, platform, expires_at)
        where consumed_at is null
      `
    )

    await query(
      `
        create unique index if not exists
          users_email_hash_unique
        on users (
          email_hash
        )
        where email_hash is not null
      `
    )

    // ==================================================
    // ADMINISTRACAO DA PLATAFORMA
    // ==================================================

    // Instancias antigas usam UUID para users.id, enquanto instalacoes novas
    // desta base ainda criam bigint. A FK deve acompanhar o banco existente.
    const userIdTypeResult = await query(`
      select format_type(a.atttypid, a.atttypmod) as type
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where c.relname = 'users'
         and a.attname = 'id'
         and a.attnum > 0
         and not a.attisdropped
       limit 1
    `)
    const platformAdminUserIdType = userIdTypeResult.rows[0]?.type === 'uuid' ? 'uuid' : 'bigint'

    await query(`
      create table if not exists tenant_memberships (
        id bigserial primary key,
        tenant_id text not null references tenants(id) on delete cascade,
        user_id ${platformAdminUserIdType} not null references users(id) on delete cascade,
        role text not null check (role in ('owner', 'admin', 'financeiro', 'producao', 'usuario')),
        status text not null default 'active' check (status in ('active', 'suspended')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, user_id)
      )
    `)

    await query(`
      insert into tenant_memberships (tenant_id, user_id, role, status)
      select tenant_id,
             id,
             case when role in ('admin', 'platform_super_admin') then 'owner' else 'usuario' end,
             case when status = 'active' then 'active' else 'suspended' end
        from users
      on conflict (tenant_id, user_id) do nothing
    `)

    await query(`create index if not exists tenant_memberships_user_id_idx on tenant_memberships (user_id)`)

    await query(`
      create table if not exists tenant_invitations (
        id text primary key,
        tenant_id text not null references tenants(id) on delete cascade,
        email text not null,
        email_hash text not null,
        role text not null check (role in ('admin', 'financeiro', 'producao', 'usuario')),
        token_hash text not null unique,
        invited_by ${platformAdminUserIdType} not null references users(id) on delete restrict,
        expires_at timestamptz not null,
        accepted_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `)
    await query(`create index if not exists tenant_invitations_tenant_id_idx on tenant_invitations (tenant_id)`)
    await query(`create index if not exists tenant_invitations_email_hash_idx on tenant_invitations (email_hash)`)

    await query(`
      create table if not exists platform_super_admins (
        user_id ${platformAdminUserIdType} primary key references users(id) on delete cascade,
        email_hash text not null unique,
        status text not null default 'active',
        granted_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `)

    await query(`
      create table if not exists platform_admin_audit_events (
        id bigserial primary key,
        actor_user_id ${platformAdminUserIdType} references users(id) on delete set null,
        action text not null,
        target_tenant_id text references tenants(id) on delete set null,
        target_resource text not null default '',
        target_resource_id text not null default '',
        reason text not null default '',
        ip_hash text not null default '',
        user_agent text not null default '',
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `)

    await query(`create index if not exists platform_admin_audit_events_created_at_idx on platform_admin_audit_events (created_at desc)`)
    await query(`create index if not exists platform_admin_audit_events_target_tenant_idx on platform_admin_audit_events (target_tenant_id, created_at desc)`)

    await query(`
      create table if not exists platform_data_access_requests (
        id text primary key,
        tenant_id text not null references tenants(id) on delete cascade,
        requested_by ${platformAdminUserIdType} not null references users(id) on delete restrict,
        reason text not null,
        scope text not null default 'user_audit',
        status text not null default 'pending' check (status in ('pending', 'approved', 'expired', 'rejected')),
        verified_at timestamptz,
        expires_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `)
    await query(`create index if not exists platform_data_access_requests_tenant_idx on platform_data_access_requests (tenant_id, created_at desc)`)

    // ==================================================
    // REFRESH TOKENS
    // ==================================================

    await query(
      `
        create table if not exists refresh_tokens (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          user_id
            text
            not null,

          session_id
            text
            not null,

          token_hash
            text
            not null
            unique,

          expires_at
            timestamptz
            not null,

          revoked_at
            timestamptz,

          replaced_by_hash
            text,

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    await query(
      `
        create index if not exists
          refresh_tokens_session_idx
        on refresh_tokens (
          session_id
        )
      `
    )

    await query(
      `
        create index if not exists
          refresh_tokens_user_id_idx
        on refresh_tokens (
          user_id
        )
      `
    )

    // ==================================================
    // PRODUCTS
    // ==================================================

    await query(
      `
        create table if not exists products (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name text not null,

          subtitle text,

          sku text not null,

          category text,

          description text,

          printer text,

          price
            numeric(12,2)
            not null
            default 0,

          weight
            numeric(12,2)
            not null
            default 0,

          print_time text,

          layer_height
            numeric(6,3)
            not null
            default 0,

          infill
            numeric(6,2)
            not null
            default 0,

          dimensions text,

          print_file_name
            text
            not null
            default '',

          print_file_format
            text
            not null
            default '',

          print_file_hash
            text
            not null
            default '',

          print_file_size_bytes
            bigint
            not null
            default 0,

          print_file_storage_key
            text
            not null
            default '',

          print_profile
            jsonb
            not null
            default '{}'::jsonb,

          compatibility
            jsonb
            not null
            default '{}'::jsonb,

          validation_status
            text
            not null
            default 'needs_validation',

          validation_message
            text
            not null
            default '',

          filament text,

          filament_color text,

          packaging_cost
            numeric(12,2)
            not null
            default 0,

          additional_materials_cost
            numeric(12,2)
            not null
            default 0,

          labor_cost
            numeric(12,2)
            not null
            default 0,

          energy_enabled
            boolean
            not null
            default true,

          marketplace_fee
            numeric(8,2)
            not null
            default 0,

          desired_margin
            numeric(8,2)
            not null
            default 0,

          cost
            numeric(12,2)
            not null
            default 0,

          profit
            numeric(12,2)
            not null
            default 0,

          margin
            numeric(12,2)
            not null
            default 0,

          status
            text
            not null
            default 'Ativo',

          thumb
            text
            not null
            default 'vase',

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            sku
          )
        )
      `
    )

    const productColumns = [
      'description text',

      'printer text',

      'layer_height numeric(6,3) not null default 0',

      'infill numeric(6,2) not null default 0',

      'dimensions text',

      "print_file_name text not null default ''",

      "print_file_format text not null default ''",

      "print_file_hash text not null default ''",

      'print_file_size_bytes bigint not null default 0',

      "print_file_storage_key text not null default ''",

      "print_profile jsonb not null default '{}'::jsonb",

      "compatibility jsonb not null default '{}'::jsonb",

      "validation_status text not null default 'needs_validation'",

      "validation_message text not null default ''",

      'printer_id bigint',

      'filament_id bigint',

      'packaging_cost numeric(12,2) not null default 0',

      'additional_materials_cost numeric(12,2) not null default 0',

      'labor_cost numeric(12,2) not null default 0',

      'energy_enabled boolean not null default true',

      'marketplace_fee numeric(8,2) not null default 0',

      'desired_margin numeric(8,2) not null default 0',

      "cost_breakdown jsonb not null default '{}'::jsonb"
    ]

    for (
      const column
      of productColumns
    ) {
      await query(
        `
          alter table products
          add column if not exists
            ${column}
        `
      )
    }

    // ==================================================
    // CLIENTS
    // ==================================================

    await query(
      `
        create table if not exists clients (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null,

          email
            text
            not null
            default 'nao-informado',

          phone
            text
            not null
            default 'nao-informado',

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now()
        )
      `
    )

    await query(
      `
        alter table clients
        add column if not exists
          name_hash text
      `
    )

    await query(
      `
        create index if not exists
          clients_tenant_name_hash_idx
        on clients (
          tenant_id,
          name_hash
        )
      `
    )

    // ==================================================
    // MARKETPLACES
    // ==================================================

    await query(
      `
        create table if not exists marketplaces (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null,

          short
            text
            not null
            default '',

          color
            text
            not null
            default '#1768f2',

          commission
            numeric(8,2)
            not null
            default 0,

          fixed
            numeric(12,2)
            not null
            default 0,

          financial
            numeric(8,2)
            not null
            default 0,

          ads
            numeric(8,2)
            not null
            default 0,

          others
            numeric(8,2)
            not null
            default 0,

          active
            boolean
            not null
            default true,

          created_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            name
          )
        )
      `
    )

    await query(
      `
        alter table marketplaces
        add column if not exists
          platform
          text
          not null
          default 'custom'
      `
    )

    await query(
      `
        alter table marketplaces
        add column if not exists
          connection_status
          text
          not null
          default 'manual'
      `
    )

    // ==================================================
    // MARKETPLACE INTEGRATIONS
    // ==================================================

    await query(
      `
        create table if not exists marketplace_integrations (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          marketplace_id
            bigint
            references marketplaces(id)
            on delete set null,

          platform
            text
            not null,

          connection_name
            text
            not null
            default '',

          account_external_id
            text
            not null
            default '',

          account_external_id_hash
            text
            not null
            default '',

          access_token
            text
            not null
            default '',

          refresh_token
            text
            not null
            default '',

          token_expires_at
            timestamptz,

          status
            text
            not null
            default 'pending',

          scopes
            text
            not null
            default '',

          last_sync_at
            timestamptz,

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            platform,
            account_external_id_hash
          )
        )
      `
    )

    await query(
      `
        create index if not exists
          marketplace_integrations_lookup_idx

        on marketplace_integrations (
          platform,
          account_external_id_hash
        )
      `
    )

    // ==================================================
    // TRACKED SALES
    // ==================================================

    await query(
      `
        create table if not exists tracked_sales (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          integration_id
            bigint
            references marketplace_integrations(id)
            on delete set null,

          marketplace_id
            bigint
            references marketplaces(id)
            on delete set null,

          platform
            text
            not null,

          external_order_id
            text
            not null
            default '',

          external_order_hash
            text
            not null
            default '',

          external_sku
            text
            not null
            default '',

          external_sku_hash
            text
            not null
            default '',

          product_name
            text
            not null
            default '',

          quantity
            integer
            not null
            default 1,

          gross
            numeric(12,2)
            not null
            default 0,

          marketplace_fee
            numeric(12,2)
            not null
            default 0,

          shipping
            numeric(12,2)
            not null
            default 0,

          net
            numeric(12,2)
            not null
            default 0,

          cost
            numeric(12,2)
            not null
            default 0,

          profit
            numeric(12,2)
            not null
            default 0,

          status
            text
            not null
            default 'received',

          sold_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            platform,
            external_order_hash
          )
        )
      `
    )

    for (
      const columnDefinition of [
        "external_sku text not null default ''",
        "external_sku_hash text not null default ''",
        "product_name text not null default ''",
        'quantity integer not null default 1'
      ]
    ) {
      await query(
        `
          alter table tracked_sales
          add column if not exists ${columnDefinition}
        `
      )
    }

    // ==================================================
    // MARKETPLACE PRODUCT LINKS
    // ==================================================

    await query(
      `
        create table if not exists marketplace_product_links (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          integration_id
            bigint
            references marketplace_integrations(id)
            on delete cascade,

          marketplace_id
            bigint
            references marketplaces(id)
            on delete cascade,

          platform
            text
            not null
            default '',

          external_sku
            text
            not null
            default '',

          external_sku_hash
            text
            not null
            default '',

          external_name
            text
            not null
            default '',

          product_id
            bigint
            not null
            references products(id)
            on delete cascade,

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            platform,
            external_sku_hash
          )
        )
      `
    )

    // ==================================================
    // MARKETPLACE WEBHOOK EVENTS
    // ==================================================

    await query(
      `
        create table if not exists marketplace_webhook_events (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          integration_id
            bigint
            references marketplace_integrations(id)
            on delete set null,

          platform
            text
            not null,

          event_type
            text
            not null
            default '',

          external_order_id
            text
            not null
            default '',

          payload
            text
            not null
            default '',

          status
            text
            not null
            default 'received',

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // ORDERS
    // ==================================================

    await query(
      `
        create table if not exists orders (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          external_id
            text
            not null,

          order_date
            date
            not null,

          client_id
            bigint
            references clients(id)
            on delete set null,

          marketplace_id
            bigint
            references marketplaces(id)
            on delete set null,

          product_id
            bigint
            references products(id)
            on delete set null,

          product_name
            text
            not null
            default '',

          quantity
            integer
            not null
            default 1,

          gross
            numeric(12,2)
            not null
            default 0,

          fee
            numeric(12,2)
            not null
            default 0,

          shipping
            numeric(12,2)
            not null
            default 0,

          net
            numeric(12,2)
            not null
            default 0,

          profit
            numeric(12,2)
            not null
            default 0,

          status
            text
            not null
            default 'Novo',

          created_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            external_id
          )
        )
      `
    )

    // ==================================================
    // PRINT JOBS / FILA DE IMPRESSAO
    // ==================================================

    await query(
      `
        create table if not exists print_jobs (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          order_id
            bigint
            references orders(id)
            on delete cascade,

          tracked_sale_id
            bigint
            references tracked_sales(id)
            on delete set null,

          product_id
            bigint
            references products(id)
            on delete set null,

          printer_id
            bigint
            references printers(id)
            on delete set null,

          agent_printer_id
            bigint
            references agent_printers(id)
            on delete set null,

          source
            text
            not null
            default 'manual',

          title
            text
            not null
            default '',

          quantity
            integer
            not null
            default 1,

          priority
            integer
            not null
            default 0,

          status
            text
            not null
            default 'queued',

          notes
            text
            not null
            default '',

          scheduled_at
            timestamptz,

          started_at
            timestamptz,

          completed_at
            timestamptz,

          cancelled_at
            timestamptz,

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now()
        )
      `
    )

    await query(
      `
        create index if not exists
          print_jobs_printer_queue_idx

        on print_jobs (
          tenant_id,
          printer_id,
          status,
          priority desc,
          created_at asc
        )
      `
    )

    await query(
      `
        create index if not exists
          print_jobs_order_idx

        on print_jobs (
          tenant_id,
          order_id
        )
      `
    )

    await query(
      `
        create unique index if not exists
          print_jobs_tracked_sale_unique_idx

        on print_jobs (
          tenant_id,
          tracked_sale_id
        )

        where tracked_sale_id is not null
      `
    )

    // ==================================================
    // EXPENSES
    // ==================================================

    await query(
      `
        create table if not exists expenses (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          description
            text
            not null,

          category
            text
            not null
            default 'Outros',

          supplier
            text
            not null
            default '',

          amount
            numeric(12,2)
            not null
            default 0,

          expense_date
            date
            not null,

          payment
            text
            not null
            default '',

          recurrence
            text
            not null
            default 'Nao recorrente',

          status
            text
            not null
            default 'Pago',

          next_due_date
            date,

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // FILAMENTS
    // ==================================================

    await query(
      `
        create table if not exists filaments (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null,

          maker
            text
            not null
            default '',

          material
            text
            not null
            default '',

          type
            text
            not null
            default '',

          color
            text
            not null
            default '',

          color_hex
            text
            not null
            default '#ccd3df',

          initial_weight
            numeric(12,2)
            not null
            default 0,

          remaining_weight
            numeric(12,2)
            not null
            default 0,

          cost
            numeric(12,2)
            not null
            default 0,

          supplier
            text
            not null
            default '',

          purchase_date
            date,

          status
            text
            not null
            default 'Em estoque',

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            name
          )
        )
      `
    )

    // ==================================================
    // PRINTERS
    // ==================================================
    //
    // Esta tabela representa o cadastro da impressora
    // dentro do PrintFlow.
    //
    // Ela NÃO guarda credenciais técnicas.
    // ==================================================

    await query(
      `
        create table if not exists printers (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null,

          code
            text
            not null,

          maker
            text
            not null
            default '',

          model
            text
            not null
            default '',

          acquired_at
            date,

          power_w
            numeric(12,2)
            not null
            default 0,

          accumulated_hours
            numeric(12,2)
            not null
            default 0,

          status
            text
            not null
            default 'Disponivel',

          last_maintenance_at
            date,

          serial
            text
            not null
            default '',

          location
            text
            not null
            default '',

          volume
            text
            not null
            default '',

          default_filament
            text
            not null
            default '',

          nozzle_mm
            numeric(6,3)
            not null
            default 0,

          supported_materials
            text
            not null
            default '',

          min_layer_height
            numeric(6,3)
            not null
            default 0,

          max_layer_height
            numeric(6,3)
            not null
            default 0,

          agent_id
            bigint,

          agent_printer_id
            bigint,

          agent_connection_key
            text
            not null
            default '',

          agent_protocol
            text
            not null
            default '',

          agent_connection_type
            text
            not null
            default '',

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            code
          )
        )
      `
    )

    const printerAgentColumns = [
      'agent_id bigint',

      'agent_printer_id bigint',

      "agent_connection_key text not null default ''",

      "agent_protocol text not null default ''",

      "agent_connection_type text not null default ''",

      'nozzle_mm numeric(6,3) not null default 0',

      "supported_materials text not null default ''",

      'min_layer_height numeric(6,3) not null default 0',

      'max_layer_height numeric(6,3) not null default 0'
    ]

    for (
      const column
      of printerAgentColumns
    ) {
      await query(
        `
          alter table printers
          add column if not exists
            ${column}
        `
      )
    }

    // ==================================================
    // AGENTS
    // ==================================================

    await query(
      `
        create table if not exists agents (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null
            default '',

          machine_name
            text
            not null,

          platform
            text
            not null
            default '',

          architecture
            text
            not null
            default '',

          agent_version
            text
            not null
            default '',

          status
            text
            not null
            default 'offline',

          last_seen_at
            timestamptz,

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            machine_name
          )
        )
      `
    )

    await query(
      `
        alter table agents
        add column if not exists
          secret_hash text
      `
    )

    // ==================================================
    // AGENT PAIRING CODES
    // ==================================================

    await query(
      `
        create table if not exists agent_pairing_codes (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          code_hash
            text
            not null,

          expires_at
            timestamptz
            not null,

          used_at
            timestamptz,

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // AGENT COMMANDS
    // ==================================================

    await query(
      `
        create table if not exists agent_commands (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          agent_id
            bigint
            not null
            references agents(id)
            on delete cascade,

          command
            text
            not null,

          payload
            jsonb
            not null
            default '{}'::jsonb,

          status
            text
            not null
            default 'pending',

          result
            jsonb,

          created_at
            timestamptz
            not null
            default now(),

          started_at
            timestamptz,

          completed_at
            timestamptz
        )
      `
    )

     // ==================================================
    // IMPRESSORAS CONECTADAS AOS AGENTS
    // ==================================================
    //
    // Esta tabela representa a associação técnica:
    //
    // Tenant
    //   ↓
    // Agent
    //   ↓
    // Impressora física
    //
    //
    // printer_id:
    //   referência opcional ao cadastro normal
    //   da impressora em "printers".
    //
    // connection_key:
    //   identificação técnica criada pelo Agent.
    //
    // Exemplos:
    //
    // bambu:01P00A123456
    //
    // moonraker:192.168.1.20:7125
    //
    // marlin:COM3
    //
    //
    // IMPORTANTE:
    //
    // Nenhuma senha, LAN Access Code ou token
    // deve ser salvo nesta tabela.
    // ==================================================

    await query(
      `
        create table if not exists agent_printers (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          agent_id
            bigint
            not null
            references agents(id)
            on delete cascade,

          printer_id
            bigint
            references printers(id)
            on delete set null,

          connection_key
            text
            not null,

          protocol
            text
            not null,

          connection_type
            text
            not null
            default '',

          name
            text
            not null
            default '',

          manufacturer
            text
            not null
            default '',

          model
            text
            not null
            default '',

          serial
            text
            not null
            default '',

          ip
            text
            not null
            default '',

          port
            text
            not null
            default '',

          status
            text
            not null
            default 'disconnected',

                  last_error
            text
            not null
            default '',

          last_connection_error
            text
            not null
            default '',

          last_operation_error
            text
            not null
            default '',

          metadata
            jsonb
            not null
            default '{}'::jsonb,

          last_status
            jsonb
            not null
            default '{}'::jsonb,

          connected_at
            timestamptz,

          disconnected_at
            timestamptz,

          last_seen_at
            timestamptz,

          created_at
            timestamptz
            not null
            default now(),

          updated_at
            timestamptz
            not null
            default now(),

          unique (
            tenant_id,
            agent_id,
            connection_key
          )
        )
      `
    )

    // ==================================================
    // MIGRAÇÃO PARA BANCOS JÁ EXISTENTES
    // ==================================================
    //
    // create table if not exists NÃO altera uma tabela
    // que já existe.
    //
    // Portanto precisamos garantir que instalações antigas
    // também recebam a coluna last_status.
    // ==================================================

    await query(
      `
        alter table agent_printers
        add column if not exists
          last_status
          jsonb
          not null
          default '{}'::jsonb
      `
    )

    // ==================================================
    // ÍNDICES ESPECÍFICOS DE AGENT_PRINTERS
    // ==================================================

    await query(
      `
        create index if not exists
          agent_printers_agent_idx

        on agent_printers (
          tenant_id,
          agent_id
        )
      `
    )

    await query(
      `
        create index if not exists
          agent_printers_printer_idx

        on agent_printers (
          tenant_id,
          printer_id
        )
      `
    )

    await query(
      `
        create index if not exists
          agent_printers_serial_idx

        on agent_printers (
          tenant_id,
          serial
        )
      `
    )

    await query(
      `
        create index if not exists
          agent_printers_status_idx

        on agent_printers (
          tenant_id,
          status
        )
      `
    )

        // ==================================================
    // ERROS DA IMPRESSORA
    // ==================================================

    await query(
      `
        alter table agent_printers
        add column if not exists
          last_connection_error
          text
          not null
          default ''
      `
    )

    await query(
      `
        alter table agent_printers
        add column if not exists
          last_operation_error
          text
          not null
          default ''
      `
    )

    // ==================================================
    // GOALS
    // ==================================================

    await query(
      `
        create table if not exists goals (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null,

          current_value
            numeric(12,2)
            not null
            default 0,

          target_value
            numeric(12,2)
            not null
            default 0,

          color
            text
            not null
            default '#1768f2',

          icon
            text
            not null
            default 'target',

          period_start
            date
            not null,

          period_end
            date
            not null,

          status
            text
            not null
            default 'Ativa',

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // COMPANY SETTINGS
    // ==================================================

    await query(
      `
        create table if not exists company_settings (
          tenant_id
            text
            primary key
            references tenants(id)
            on delete cascade,

          name
            text
            not null
            default '',

          document
            text
            not null
            default '',

          phone
            text
            not null
            default '',

          email
            text
            not null
            default '',

          address
            text
            not null
            default '',

          district
            text
            not null
            default '',

          city
            text
            not null
            default '',

          state
            text
            not null
            default '',

          zip
            text
            not null
            default '',

          country
            text
            not null
            default 'Brasil',

          currency
            text
            not null
            default 'Real (R$)',

          timezone
            text
            not null
            default '(GMT-03:00) Brasilia',

          kwh
            numeric(12,4)
            not null
            default 0,

          updated_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // CALCULATOR SIMULATIONS
    // ==================================================

    await query(
      `
        create table if not exists calculator_simulations (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          name
            text
            not null
            default 'Simulacao sem nome',

          price_per_kg
            numeric(12,2)
            not null
            default 0,

          weight
            numeric(12,2)
            not null
            default 0,

          duration_minutes
            integer
            not null
            default 0,

          energy_enabled
            boolean
            not null
            default true,

          energy_rate
            numeric(12,4)
            not null
            default 0,

          watts
            numeric(12,2)
            not null
            default 0,

          margin
            numeric(12,2)
            not null
            default 0,

          direct_cost
            numeric(12,2)
            not null
            default 0,

          suggested_price
            numeric(12,2)
            not null
            default 0,

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // EXPORT HISTORY
    // ==================================================

    await query(
      `
        create table if not exists export_history (
          id bigserial primary key,

          tenant_id
            text
            not null
            references tenants(id)
            on delete cascade,

          file_name
            text
            not null,

          export_type
            text
            not null,

          file_format
            text
            not null,

          period_start
            date,

          period_end
            date,

          record_count
            integer
            not null
            default 0,

          status
            text
            not null
            default 'Concluido',

          created_at
            timestamptz
            not null
            default now()
        )
      `
    )

    // ==================================================
    // EVENTOS OPERACIONAIS
    // ==================================================

    await query(
      `
        create table if not exists operational_notifications (
          id bigserial primary key,
          tenant_id text not null references tenants(id) on delete cascade,
          type text not null default 'system',
          severity text not null default 'info',
          title text not null,
          message text not null default '',
          entity_type text not null default '',
          entity_id text not null default '',
          dedupe_key text,
          read_at timestamptz,
          created_at timestamptz not null default now(),
          unique (tenant_id, dedupe_key)
        )
      `
    )

    await query(
      `
        create table if not exists operational_audit_events (
          id bigserial primary key,
          tenant_id text not null references tenants(id) on delete cascade,
          action text not null,
          actor_type text not null default 'system',
          actor_id text not null default '',
          entity_type text not null default '',
          entity_id text not null default '',
          details jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )
      `
    )

    // ==================================================
    // ÍNDICES + RLS DAS TABELAS DE TENANT
    // ==================================================

    for (
      const table
      of tenantTables
    ) {
      await query(
        `
          create index if not exists
            ${table}_tenant_id_idx

          on ${table} (
            tenant_id
          )
        `
      )

      await enableTenantIsolation(
        table
      )
    }
  }
