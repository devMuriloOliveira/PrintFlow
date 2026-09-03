const rolePermissions = {
  owner: new Set(['*']),
  admin: new Set([
    'app_data.read',
    'settings.manage',
    'audit.read',
    'notifications.read',
    'members.read',
    'members.manage',
    'catalog.read',
    'catalog.manage',
    'clients.read',
    'clients.manage',
    'financial.read',
    'financial.manage',
    'integrations.read',
    'integrations.manage',
    'marketplaces.read',
    'marketplaces.manage',
    'orders.read',
    'orders.manage',
    'production.read',
    'production.manage'
  ]),
  financeiro: new Set([
    'catalog.read',
    'clients.read',
    'clients.manage',
    'financial.read',
    'financial.manage',
    'marketplaces.read',
    'orders.read',
    'orders.manage'
  ]),
  producao: new Set([
    'catalog.read',
    'catalog.manage',
    'clients.read',
    'orders.read',
    'orders.manage',
    'production.read',
    'production.manage'
  ]),
  usuario: new Set([
    'catalog.read',
    'orders.read',
    'production.read'
  ])
}

export const tenantMemberRoles = Object.freeze(['owner', 'admin', 'financeiro', 'producao', 'usuario'])

const hasPermission = (role, permission) => {
  const permissions = rolePermissions[String(role || '').toLowerCase()]
  return Boolean(permissions?.has('*') || permissions?.has(permission))
}

const accessForMethod = (method, area) =>
  method === 'GET' ? `${area}.read` : `${area}.manage`

export const requiredPermissionForRequest = (method, pathname) => {
  if (pathname === '/api/app-data') return 'app_data.read'
  if (pathname === '/api/settings') return 'settings.manage'
  if (pathname === '/api/members') return accessForMethod(method, 'members')
  if (pathname === '/api/members/invitations') return 'members.manage'
  if (pathname.startsWith('/api/members/')) return 'members.manage'
  if (pathname === '/api/operational-audit-events') return 'audit.read'
  if (pathname.startsWith('/api/operational-notifications')) return 'notifications.read'

  if (pathname.startsWith('/api/expenses') || pathname.startsWith('/api/goals') || pathname.startsWith('/api/expense-segments')) {
    return accessForMethod(method, 'financial')
  }

  if (pathname.startsWith('/api/marketplace-integrations')) {
    return accessForMethod(method, 'integrations')
  }

  if (pathname.startsWith('/api/marketplaces')) return accessForMethod(method, 'marketplaces')
  if (pathname.startsWith('/api/orders')) return accessForMethod(method, 'orders')
  if (pathname.startsWith('/api/clients')) return accessForMethod(method, 'clients')

  if (pathname.startsWith('/api/products') || pathname.startsWith('/api/filaments') || pathname.startsWith('/api/printers')) {
    return accessForMethod(method, 'catalog')
  }

  if (pathname.startsWith('/api/print-jobs') || pathname.startsWith('/api/agents')) {
    return accessForMethod(method, 'production')
  }

  // New protected routes require an explicit policy before lower-privilege roles use them.
  return 'tenant.manage'
}

export const canAccessRequest = (user, method, pathname) => {
  const role = String(user?.role || '').toLowerCase()
  const permission = requiredPermissionForRequest(method, pathname)

  return hasPermission(role, permission)
}
