import { hasDatabase, tenantQuery } from '../db/pool.js'

const text = (value, max = 300) => String(value || '').trim().slice(0, max)

const normalizeSeverity = (value) =>
  ['info', 'success', 'warning', 'error'].includes(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : 'info'

const actionLabels = {
  'products.created': 'Produto criado',
  'products.updated': 'Produto atualizado',
  'products.print_file_uploaded': 'Arquivo de impressao enviado',
  'orders.created': 'Pedido registrado',
  'orders.updated': 'Pedido atualizado',
  'orders.deleted': 'Pedido excluido',
  'expenses.created': 'Despesa registrada',
  'expenses.updated': 'Despesa atualizada',
  'expenses.deleted': 'Despesa excluida',
  'filaments.created': 'Filamento cadastrado',
  'filaments.updated': 'Filamento atualizado',
  'filaments.deleted': 'Filamento excluido',
  'printers.created': 'Impressora cadastrada',
  'printers.updated': 'Impressora atualizada',
  'printers.deleted': 'Impressora excluida',
  'marketplaces.created': 'Marketplace cadastrado',
  'marketplaces.updated': 'Marketplace atualizado',
  'marketplaces.deleted': 'Marketplace excluido',
  'clients.created': 'Cliente cadastrado',
  'clients.updated': 'Cliente atualizado',
  'clients.deleted': 'Cliente excluido',
  'goals.created': 'Meta criada',
  'goals.updated': 'Meta atualizada',
  'goals.deleted': 'Meta excluida',
  'printJobs.created': 'Fila de impressao criada',
  'printJobs.updated': 'Fila de impressao atualizada',
  'printJobs.deleted': 'Fila de impressao excluida',
  'platform.overview.read': 'Resumo da plataforma consultado',
  'platform.tenants.list': 'Lista de empresas consultada',
  'platform.admin_audit.read': 'Auditoria administrativa consultada',
  'platform.admin_audit.exported': 'Relatorio de atividades administrativas exportado',
  'platform.tenant_audit.read': 'Relatorio de empresa consultado',
  'platform.tenant_audit.exported': 'Relatorio de empresa exportado',
  'platform.support.chat_report_exported': 'Relatorio de conversa exportado',
  'platform.data_access.requested': 'Solicitacao segura de acesso iniciada',
  'platform.data_access.verified': 'CNPJ confirmado para acesso ao relatorio',
  'platform.data_access.rejected': 'Confirmacao de CNPJ recusada',
  'platform.tenant_status.update': 'Status da empresa atualizado',
  'membership.owner.granted': 'Proprietario inicial definido',
  'membership.updated': 'Permissao de usuario atualizada',
  'invitation.created': 'Convite de usuario criado',
  'invitation.revoked': 'Convite de usuario cancelado',
  'invitation.accepted': 'Convite de usuario aceito',
  'password.changed': 'Senha alterada',
  'tenant.deletion.requested': 'Exclusao da empresa solicitada',
  'tenant.deletion.cancelled': 'Exclusao da empresa cancelada',
  'platform.tenant_deletions.read': 'Auditoria de exclusoes consultada',
  'session.revoked': 'Sessao encerrada',
  'sessions.revoked_all': 'Todas as sessoes foram encerradas',
  'notification.read': 'Notificacao marcada como lida',
  'settings.updated': 'Configuracoes da empresa atualizadas',
  'settings.data_exported': 'Dados da empresa exportados',
  'support.request.created': 'Solicitacao de suporte criada',
  'support.request.message_sent': 'Mensagem de suporte enviada',
  'support.request.cancelled': 'Solicitacao de suporte cancelada',
  'agent.offline': 'Agent ficou offline',
  'print_job.start_timeout': 'Inicio da impressao excedeu o prazo'
}

const fieldLabels = {
  name: 'nome', subtitle: 'subtitulo', sku: 'SKU', category: 'categoria', description: 'descricao',
  price: 'preco', weight: 'peso', status: 'status', amount: 'valor', expense_date: 'data',
  supplier: 'fornecedor', remaining_weight: 'saldo', cost: 'custo', maker: 'fabricante',
  model: 'modelo', location: 'localizacao', power_w: 'potencia', commission: 'comissao',
  gross: 'valor bruto', fee: 'taxa', shipping: 'frete', net: 'valor liquido', profit: 'lucro',
  quantity: 'quantidade', priority: 'prioridade', scheduled_at: 'agendamento', target_value: 'meta',
  current_value: 'progresso', active: 'situacao'
}

const isSensitiveField = (field) => /password|token|secret|email|phone|hash|document|cnpj|storage|connection.*key|file_name/i.test(field)

const fallbackLabel = (action) => String(action || 'system.event')
  .replace(/[._]/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const describeAuditEvent = (event = {}) => {
  const details = event.details && typeof event.details === 'object' ? event.details : {}
  const fields = Array.isArray(details.changedFields)
    ? details.changedFields.filter((field) => !isSensitiveField(field)).map((field) => fieldLabels[field] || String(field)).slice(0, 8)
    : []
  const context = []
  if (fields.length) context.push(`Campos alterados: ${fields.join(', ')}.`)
  if (details.source === 'orders') context.push('Cadastro criado durante o registro de um pedido.')
  if (details.format) context.push(`Formato do arquivo: ${String(details.format).toUpperCase()}.`)
  if (details.sessionsRevoked) context.push('Sessoes anteriores foram encerradas por seguranca.')
  if (details.scheduledFor) context.push(`Exclusao programada para ${new Date(details.scheduledFor).toLocaleString('pt-BR')}.`)

  return {
    summary: details.summary || actionLabels[event.action] || fallbackLabel(event.action),
    context: context.join(' ')
  }
}

export const writeOperationalNotification = async (tenantId, event = {}, client = null) => {
  if (!hasDatabase || !tenantId) return null

  const params = [
    String(tenantId),
    text(event.type || 'system', 80),
    normalizeSeverity(event.severity),
    text(event.title || 'Atualizacao operacional', 180),
    text(event.message || '', 1000),
    text(event.entityType || '', 80),
    text(event.entityId || '', 120),
    text(event.dedupeKey || '', 180) || null
  ]

  const sql = `
    insert into operational_notifications (
      tenant_id, type, severity, title, message, entity_type, entity_id, dedupe_key
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (tenant_id, dedupe_key) do nothing
    returning id, created_at
  `

  const result = client
    ? await client.query(sql, params)
    : await tenantQuery(tenantId, sql, params)

  return result.rows[0] || null
}

export const writeAuditEvent = async (tenantId, event = {}, client = null) => {
  if (!hasDatabase || !tenantId) return null

  const details = event.details && typeof event.details === 'object' ? event.details : {}
  const description = describeAuditEvent({ action: event.action, details })

  const params = [
    String(tenantId),
    text(event.action || 'system.event', 120),
    text(event.actorType || 'system', 40),
    text(event.actorId || '', 120),
    text(event.entityType || '', 80),
    text(event.entityId || '', 120),
    JSON.stringify({ ...details, summary: description.summary, context: description.context })
  ]

  const sql = `
    insert into operational_audit_events (
      tenant_id, action, actor_type, actor_id, entity_type, entity_id, details
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    returning id, created_at
  `

  const result = client
    ? await client.query(sql, params)
    : await tenantQuery(tenantId, sql, params)

  return result.rows[0] || null
}
