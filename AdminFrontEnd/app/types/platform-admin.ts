export type Overview = {
  tenants: number
  activeTenants: number
  suspendedTenants: number
  paymentAttention: number
  agents: number
  onlineAgents: number
  printers: number
  connectedPrinters: number
}

export type Tenant = {
  id: string
  name: string
  cnpj: string
  accountStatus: string
  billingStatus: string
  billingDueAt?: string | null
  planId?: string | null
  planName?: string
  subscriptionStatus?: string
  billingCycle?: string
  currentPeriodEnd?: string | null
  trialEndsAt?: string | null
  graceEndsAt?: string | null
  users: number
  activeUsers: number
  agents: number
  onlineAgents: number
  printers: number
}

export type PlatformPlan = { id: string; code: string; name: string; description: string; monthlyReferencePrice: number; yearlyReferencePrice: number; limits: Record<string, number>; features: Record<string, boolean>; active: boolean; createdAt: string; updatedAt?: string }
export type TenantDetails = Tenant & { subscription: { id: string; planId?: string | null; planName: string; status: string; billingCycle: string; startedAt?: string | null; currentPeriodStart?: string | null; currentPeriodEnd?: string | null; trialEndsAt?: string | null; graceEndsAt?: string | null; cancelledAt?: string | null; cancellationReason: string; manualOverride: boolean; source: string; provider: string; lastProviderSyncAt?: string | null; notes: string } | null; usage: { users: number; activeUsers: number; agents: number; printers: number; products: number; orders: number } }
export type TenantSubscriptionEvent = { id: string; action: string; previousState: Record<string, unknown>; newState: Record<string, unknown>; reason: string; actorUserId: string; source: string; provider: string; createdAt: string }
export type TenantUser = { id: string; name: string; role: string; status: string; createdAt: string; updatedAt?: string }
export type TenantBillingRecord = { id: string; reference?: string; amount: number; currency: string; dueAt?: string | null; paidAt?: string | null; status: string; source: string; provider: string; providerInvoiceId: string; notes: string; createdAt: string }

export type AuditRequest = {
  id: string
  tenantId: string
  requestedBy: string
  requesterName: string
  status: string
  subject: string
  category: 'technical' | 'financial' | 'integration' | 'account' | 'data_backup' | 'privacy' | 'audit'
  requestKind?: 'support' | 'privacy'
  privacyRight?: string
  priority: 'low' | 'normal' | 'high'
  requesterRole: string
  responsibleId?: string | null
  responsibleName?: string
  chatAssigneeId?: string | null
  chatAssigneeName?: string
  chatAssignedAt?: string | null
  chatCollaborators?: Array<{ id: string; name: string }>
  dueAt?: string | null
  reason: string
  scope: { entityType?: string; entityId?: string; periodStart?: string; periodEnd?: string }
  reviewerId?: string | null
  reviewReason?: string
  decision?: 'approved' | 'rejected' | null
  expiresAt?: string | null
  chatOpenedAt?: string | null
  chatClosedAt?: string | null
  supportStatus?: 'new' | 'in_progress' | 'waiting_customer' | 'waiting_internal' | 'resolved' | 'reopened'
  supportTags?: string[]
  supportFirstResponseDueAt?: string | null
  supportResolutionDueAt?: string | null
  supportReopenUntil?: string | null
  supportParentRequestId?: string | null
  createdAt: string
  updatedAt: string
}

export type Message = {
  id: string
  sender_type: 'owner' | 'requester' | 'superadmin'
  sender_id: string
  body: string
  visibility?: 'public' | 'internal'
  created_at: string
}

export type TenantAudit = {
  id: string
  action: string
  summary: string
  context?: string
  actorType: string
  entityType: string
  entityId: string
  createdAt: string
}

export type PlatformAudit = {
  id: string
  action: string
  summary: string
  context?: string
  targetTenantId?: string
  targetResource: string
  targetResourceId: string
  reason: string
  createdAt: string
}

export type PlatformNotification = {
  id: string
  type: string
  severity: string
  title: string
  message: string
  entityType: string
  entityId: string
  readAt?: string | null
  createdAt: string
}

export type SupportMacro = { id: string; name: string; body: string; category: string }
export type SupportSlaRule = { id: string; category: string; priority: string; firstResponseMinutes: number; resolutionMinutes: number; active: boolean; updatedAt?: string }
export type SupportAttachment = { id: string; requestId: string; originalName: string; mimeType: string; sizeBytes: number; expiresAt: string; createdAt: string }

export type SupportMetrics = {
  total: number
  waitingCustomer: number
  waitingInternal: number
  overdue: number
  reopened: number
  averageFirstResponseMinutes: number
  averageResolutionMinutes: number
  byCategory: Array<{ category: string; total: number }>
  byAssignee: Array<{ id: string | null; name: string; total: number }>
  byTenant: Array<{ tenantId: string; total: number }>
  lgpd: { total: number; withinDeadline: number; overdue: number }
}

export type DeletionAudit = {
  id: string
  requestId: string
  eventType: string
  summary: string
  context?: string
  evidence?: Record<string, unknown>
  createdAt: string
}

export type AuthorizedTenantAudit = {
  tenant: Tenant
  accessRequestId: string
  events: TenantAudit[]
}
