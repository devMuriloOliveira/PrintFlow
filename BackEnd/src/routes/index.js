import { configureCors, sendJson } from '../http/response.js'

import {
  enterRequest
} from '../http/rateLimit.js'

import {
  handleLogin,
  handlePasswordChange,
  handleTenantDeletionRequest,
  handleInvitationAccept,
  handleSessionRevoke,
  handleSessionsList,
  handleSessionsRevokeAll,
  handleLogout,
  handleMe,
  handleRefresh,
  handleRegister,
  handleEmailVerification,
  handlePasswordResetRequest,
  handlePasswordResetConfirm,
  handleMfaSetup,
  handleMfaStatus,
  handleMfaEnable,
  handleMfaDisable,
  handleMfaLogin,
  getAuthUser
} from './auth.js'

import {
  env
} from '../config/env.js'

import {
  canAccessRequest
} from '../auth/authorization.js'

import {
  assertTenantRequestEntitlement
} from '../services/subscriptionEntitlements.js'

import {
  handleProductCreate,
  handleProductPrintFileUpload,
  handleRecurringExpensesGenerate,
  handleResourceCreate,
  handleResourceDelete,
  handleResourceRead,
  handleResourceUpdate,
  handleFilamentMovements,
  handleOrderStageAdvance,
  readRoutes
} from './resources.js'

import {
  handleSettingsExport,
  handleSettingsExportHistory,
  handleSettingsBackupStatus,
  handleSettingsUpdate,
  handleCompanyCnpjLookup
} from './settings.js'

import { handleFinancialReportExport } from './reports.js'
import { handleCalculatorSimulationCreate, handleCalculatorSimulationsList } from './calculator.js'
import {
  handleMercadoPagoBillingSummary,
  handleMercadoPagoCheckoutCreate,
  handleMercadoPagoWebhook,
  handleMercadoPagoWebhookProbe,
  handleStripeBillingSummary,
  handleStripeCheckoutCreate,
  handleStripeSubscriptionCancellation,
  handleStripeSubscriptionPlanChange,
  handleStripeWebhook
} from './billing.js'

import {
  handleAmazonWebhook,
  handleIntegrationCreate,
  handleIntegrationsOverview,
  handleIntegrationsList,
  handleMarketplaceOAuthCallback,
  handleMarketplaceOAuthStart,
  handleMarketplaceIntegrationDisconnect,
  handleMarketplaceOrderSync,
  handleMercadoLivreWebhook,
  handleShopeeWebhook
} from './integrations.js'

import {
  handleMarketplaceOrderLinkProduct,
  handleMarketplaceOrdersList
} from './marketplaceOrders.js'

import {
  handleOperationalAuditList,
  handleOperationalHealth,
  handleOperationalNotificationRead,
  handleOperationalNotificationsList
} from './operations.js'

import {
  handleMemberUpdate,
  handleMembersList,
  handleInvitationCreate,
  handleInvitationRevoke,
  handleInvitationResend,
  handleInvitationsList
} from './members.js'

import {
  handlePlatformAdminAudit,
  handlePlatformAdminAuditExport,
  handlePlatformTenantDeletionAudit,
  handlePlatformTenantAuditExport,
  handleDataAccessRequest,
  handleDataAccessVerify,
  handlePlatformAuditDecision,
  handlePlatformAuditChatClose,
  handlePlatformSupportReopen,
  handlePlatformAuditChatReport,
  handlePlatformAuditMessageCreate,
  handlePlatformAuditMessagesList,
  handlePlatformAuditRequestsList,
  handlePlatformSupportMetrics,
  handlePlatformSupportBulkUpdate,
  handlePlatformSupportAutoAssign,
  handlePlatformSupportSlaRulesList,
  handlePlatformSupportSlaRuleUpdate,
  handlePlatformSupportHistory,
  handlePlatformSupportAttachmentsList,
  handlePlatformSupportAttachmentCreate,
  handlePlatformSupportAttachmentRead,
  handlePlatformNotificationsList,
  handlePlatformNotificationRead,
  handlePlatformSupportRequestsReport,
  handlePlatformChatAssigneesList,
  handlePlatformSupportMacrosList,
  handlePlatformChatClaim,
  handlePlatformChatTransfer,
  handlePlatformChatCollaboratorAdd,
  handlePlatformSupportMetadataUpdate,
  handlePlatformSupportSnooze,
  handlePlatformOverview,
      handlePlatformPrivacyRequestUpdate,
      handlePlatformPrivacyPortabilityExport,
  handlePlatformTenantAudit,
  handlePlatformTenantsList,
  handlePlatformPlansList,
  handlePlatformPlanBillingConfigurationUpdate,
  handlePlatformTenantDetails,
  handlePlatformTenantUsers,
  handlePlatformTenantSubscriptionEvents,
  handlePlatformTenantBillingRecords,
  handlePlatformTenantSubscriptionUpdate,
  handlePlatformTenantBillingRecordCreate,
  handlePlatformTenantStatusUpdate
} from './platformAdmin.js'

import { handleTenantAuditMessageCreate, handleTenantAuditMessagesList, handleTenantAuditRequestCancel, handleTenantAuditRequestCreate, handleTenantAuditRequestsList, handleTenantSupportAttachmentCreate, handleTenantSupportAttachmentRead, handleTenantSupportAttachmentsList, handleTenantSupportEvents, handleTenantUnreadMessages } from './auditRequests.js'

import {
  handlePrintJobApprove,
  handlePrintJobCancel,
  handlePrintJobComplete,
  handlePrintJobEnqueue,
  handlePrintJobMovePrinter,
  handlePrintJobReorder,
  handlePrintJobStartManual
} from './printJobs.js'

import {
  handleAgentPair,
  handleAgentPairingCodeCreate,
  handleAgentVerify,
  handleAgentHeartbeat,
  handleAgentsList,
  handleAgentRevoke,
  handleAgentDiscoverCreate,
  handleAgentCommandsPending,
  handleAgentCommandComplete,
  handleAgentCommandGet,
  handleAgentPrintFileGet,
  handleAgentConnectPrinterCreate,
  handleAgentPrinterStatusCreate,
  handleAgentPrinterControlCreate,
  handleAgentPrintersList
} from './agents.js'

// ======================================================
// REQUEST HANDLER
// ======================================================

export const handleRequest =
  async (
    req,
    res
  ) => {
    try {
      const url =
        new URL(
          req.url ||
            '/',

          `http://${req.headers.host}`
        )
      const requestStartedAt = Date.now()
      const acceptEncoding = String(req.headers['accept-encoding'] || '')
      res.compressionEncoding = /\bbr\b/i.test(acceptEncoding) ? 'br' : /\bgzip\b/i.test(acceptEncoding) ? 'gzip' : ''
      res.once('finish', () => {
        const durationMs = Date.now() - requestStartedAt
        if (durationMs >= 1000 && url.pathname.startsWith('/api/')) {
          console.warn('Requisicao lenta', { method: req.method, url: url.pathname, status: res.statusCode, durationMs })
        }
      })

      if (!configureCors(req, res)) {
        return sendJson(res, 403, { error: 'Origem nao autorizada' })
      }

      // ==================================================
      // CORS / OPTIONS
      // ==================================================

      if (
        req.method ===
        'OPTIONS'
      ) {
        return sendJson(
          res,
          204,
          null
        )
      }

      // ==================================================
      // RATE LIMIT
      // ==================================================

      const limit =
        await enterRequest(
          req,
          url.pathname
        )

      if (
        !limit.allowed
      ) {
        return sendJson(
          res,
          limit.status,
          limit.body,
          limit.headers
        )
      }

      res.once(
        'finish',
        limit.release
      )

      res.once(
        'close',
        limit.release
      )

      // ==================================================
      // HEALTH
      // ==================================================

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/'
      ) {
        return sendJson(
          res,
          200,
          {
            name:
              'PrintFlow API',

            status:
              'ok',

            endpoints: [
              ...Object.keys(readRoutes),
              '/api/marketplace-integrations',
              '/api/marketplace-integrations/:platform/oauth-start',
              '/api/marketplace-integrations/:id/sync-order',
              '/api/marketplace-orders',
              '/webhooks/mercadolivre'
            ]
          }
        )
      }

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/healthz'
      ) {
        return sendJson(
          res,
          200,
          {
            status:
              'ok'
          }
        )
      }

      // ==================================================
      // AUTH
      // ==================================================

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/register'
      ) {
        return await handleRegister(
          req,
          res
        )
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/login'
      ) {
        return await handleLogin(
          req,
          res
        )
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') return await handleEmailVerification(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/request') return await handlePasswordResetRequest(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/confirm') return await handlePasswordResetConfirm(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/mfa/login') return await handleMfaLogin(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/mfa/setup') return await handleMfaSetup(req, res)
      if (req.method === 'GET' && url.pathname === '/api/auth/mfa/status') return await handleMfaStatus(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/mfa/enable') return await handleMfaEnable(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/mfa/disable') return await handleMfaDisable(req, res)

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/change-password'
      ) {
        return await handlePasswordChange(
          req,
          res
        )
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/tenant-deletion-request') {
        return await handleTenantDeletionRequest(req, res)
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/refresh'
      ) {
        return await handleRefresh(
          req,
          res
        )
      }

      if (
        req.method ===
        'POST' &&
        url.pathname ===
          '/api/auth/logout'
      ) {
        return await handleLogout(
          req,
          res
        )
      }

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/auth/me'
      ) {
        return await handleMe(
          req,
          res
        )
      }

      // ==================================================
      // WEBHOOKS
      // ==================================================

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/webhooks/mercadolivre'
      ) {
        return await handleMercadoLivreWebhook(
          req,
          res
        )
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/webhooks/shopee'
      ) {
        return await handleShopeeWebhook(
          req,
          res
        )
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/webhooks/amazon'
      ) {
        return await handleAmazonWebhook(
          req,
          res
        )
      }

      if (req.method === 'GET' && url.pathname === '/webhooks/mercado-pago') return handleMercadoPagoWebhookProbe(req, res)

      if (req.method === 'POST' && url.pathname === '/webhooks/mercado-pago') {
        return await handleMercadoPagoWebhook(
          req,
          res,
          url
        )
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/stripe') return await handleStripeWebhook(req, res)

      // ==================================================
      // ROTAS PÚBLICAS DO AGENT
      // ==================================================

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/agents/pair'
      ) {
        return await handleAgentPair(
          req,
          res
        )
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/agents/verify'
      ) {
        return await handleAgentVerify(
          req,
          res
        )
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/agents/heartbeat'
      ) {
        return await handleAgentHeartbeat(
          req,
          res
        )
      }

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/agents/commands/pending'
      ) {
        return await handleAgentCommandsPending(
          req,
          res
        )
      }

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/agents/print-file'
      ) {
        return await handleAgentPrintFileGet(
          req,
          res,
          url
        )
      }

      const agentCommandCompleteMatch =
        url.pathname.match(
          /^\/api\/agents\/commands\/([^/]+)\/complete$/
        )

      if (
        req.method ===
          'POST' &&
        agentCommandCompleteMatch
      ) {
        const commandId =
          agentCommandCompleteMatch[1]

        return await handleAgentCommandComplete(
          req,
          res,
          commandId
        )
      }

      // ==================================================
      // DEFINIR ROTAS PÚBLICAS DO AGENT
      // ==================================================

      const isPublicAgentRoute =
        (
          req.method ===
            'POST' &&
          (
            url.pathname ===
              '/api/agents/pair' ||

            url.pathname ===
              '/api/agents/verify' ||

            url.pathname ===
              '/api/agents/heartbeat' ||

            /^\/api\/agents\/commands\/[^/]+\/complete$/.test(
              url.pathname
            )
          )
        ) ||
        (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/agents/commands/pending'
        ) ||
        (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/agents/print-file'
        )

      const isPublicMarketplaceOAuthRoute =
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/marketplace-integrations/oauth-callback'

      // ==================================================
      // PROTEGER /api/*
      // ==================================================

      const isProtectedApi =
        url.pathname.startsWith(
          '/api/'
        ) &&
        !url.pathname.startsWith(
          '/api/auth/'
        ) &&
        !isPublicAgentRoute &&
        !isPublicMarketplaceOAuthRoute

      if (
        isProtectedApi &&
        !env.allowDemoTenant &&
        !(await getAuthUser(
          req
        ))
      ) {
        return sendJson(
          res,
          401,
          {
            error:
              'Login necessario'
          }
        )

      }

      if (req.method === 'POST' && url.pathname === '/api/auth/invitations/accept') {
        return await handleInvitationAccept(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/sessions') return await handleSessionsList(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/sessions/revoke-all') return await handleSessionsRevokeAll(req, res)
      const authSessionMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)$/)
      if (req.method === 'DELETE' && authSessionMatch) return await handleSessionRevoke(req, res, authSessionMatch[1])

      if (isProtectedApi && !env.allowDemoTenant) {
        const user = await getAuthUser(req)
        if (!canAccessRequest(user, req.method, url.pathname)) {
          return sendJson(res, 403, { error: 'Voce nao possui permissao para esta operacao.' })
        }
        const isBillingRecoveryRoute = url.pathname === '/api/billing/mercado-pago' || url.pathname === '/api/billing/mercado-pago/checkout' || url.pathname === '/api/billing/stripe' || url.pathname === '/api/billing/stripe/checkout' || url.pathname === '/api/billing/stripe/subscription/cancel' || url.pathname === '/api/billing/stripe/subscription/resume' || url.pathname === '/api/billing/stripe/subscription/change-plan'
        if (!url.pathname.startsWith('/api/platform-admin/') && !isBillingRecoveryRoute) {
          try {
            await assertTenantRequestEntitlement({ tenantId: user.tenantId, method: req.method, pathname: url.pathname })
          } catch (error) {
            return sendJson(res, 403, { error: error.message || 'A assinatura nao permite esta operacao.' })
          }
        }
      }

      // ==================================================
      // CONSULTAR RESULTADO DE COMANDO
      // ==================================================

      if (req.method === 'GET' && url.pathname === '/api/members') {
        return await handleMembersList(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/billing/mercado-pago') {
        return await handleMercadoPagoBillingSummary(req, res)
      }

      if (req.method === 'POST' && url.pathname === '/api/billing/mercado-pago/checkout') {
        return await handleMercadoPagoCheckoutCreate(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/billing/stripe') return await handleStripeBillingSummary(req, res)
      if (req.method === 'POST' && url.pathname === '/api/billing/stripe/checkout') return await handleStripeCheckoutCreate(req, res)
      if (req.method === 'POST' && url.pathname === '/api/billing/stripe/subscription/cancel') return await handleStripeSubscriptionCancellation(req, res, true)
      if (req.method === 'POST' && url.pathname === '/api/billing/stripe/subscription/resume') return await handleStripeSubscriptionCancellation(req, res, false)
      if (req.method === 'POST' && url.pathname === '/api/billing/stripe/subscription/change-plan') return await handleStripeSubscriptionPlanChange(req, res)

      if (req.method === 'POST' && url.pathname === '/api/members/invitations') {
        return await handleInvitationCreate(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/members/invitations') {
        return await handleInvitationsList(req, res)
      }

      const invitationActionMatch = url.pathname.match(/^\/api\/members\/invitations\/([^/]+)\/(resend)$/)
      if (req.method === 'POST' && invitationActionMatch) return await handleInvitationResend(req, res, invitationActionMatch[1])
      const invitationMatch = url.pathname.match(/^\/api\/members\/invitations\/([^/]+)$/)
      if (req.method === 'DELETE' && invitationMatch) return await handleInvitationRevoke(req, res, invitationMatch[1])

      const memberUpdateMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/)
      if (req.method === 'PATCH' && memberUpdateMatch) {
        return await handleMemberUpdate(req, res, memberUpdateMatch[1])
      }

      const agentCommandGetMatch =
        url.pathname.match(
          /^\/api\/agent-commands\/([^/]+)$/
        )

      if (
        req.method ===
          'GET' &&
        agentCommandGetMatch
      ) {
        const commandId =
          agentCommandGetMatch[1]

        return await handleAgentCommandGet(
          req,
          res,
          commandId
        )
      }

      // ==================================================
      // DESCOBRIR IMPRESSORAS
      // ==================================================

      const agentDiscoverMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/discover$/
        )

      if (
        req.method ===
          'POST' &&
        agentDiscoverMatch
      ) {
        const agentId =
          agentDiscoverMatch[1]

        return await handleAgentDiscoverCreate(
          req,
          res,
          agentId
        )
      }

      // ==================================================
      // CONECTAR IMPRESSORA
      // ==================================================

      const agentConnectPrinterMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/connect-printer$/
        )

      if (
        req.method ===
          'POST' &&
        agentConnectPrinterMatch
      ) {
        const agentId =
          agentConnectPrinterMatch[1]

        return await handleAgentConnectPrinterCreate(
          req,
          res,
          agentId
        )
      }

      // ==================================================
      // LISTAR IMPRESSORAS REGISTRADAS DO AGENT
      // ==================================================

      const agentPrintersListMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printers$/
        )

      if (
        req.method ===
          'GET' &&
        agentPrintersListMatch
      ) {
        const agentId =
          agentPrintersListMatch[1]

        return await handleAgentPrintersList(
          req,
          res,
          agentId
        )
      }

      // ==================================================
      // STATUS DA IMPRESSORA
      // ==================================================

      const agentPrinterStatusMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printer-status$/
        )

      if (
        req.method ===
          'POST' &&
        agentPrinterStatusMatch
      ) {
        const agentId =
          agentPrinterStatusMatch[1]

        return await handleAgentPrinterStatusCreate(
          req,
          res,
          agentId
        )
      }

      // ==================================================
      // PAUSAR IMPRESSÃO
      // ==================================================

      const agentPrinterStartMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printer-start$/
        )

      if (
        req.method ===
          'POST' &&
        agentPrinterStartMatch
      ) {
        const agentId =
          agentPrinterStartMatch[1]

        return await handleAgentPrinterControlCreate(
          req,
          res,
          agentId,
          'start'
        )
      }

      const agentPrinterPauseMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printer-pause$/
        )

      if (
        req.method ===
          'POST' &&
        agentPrinterPauseMatch
      ) {
        const agentId =
          agentPrinterPauseMatch[1]

        return await handleAgentPrinterControlCreate(
          req,
          res,
          agentId,
          'pause'
        )
      }

      // ==================================================
      // RETOMAR IMPRESSÃO
      // ==================================================

      const agentPrinterResumeMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printer-resume$/
        )

      if (
        req.method ===
          'POST' &&
        agentPrinterResumeMatch
      ) {
        const agentId =
          agentPrinterResumeMatch[1]

        return await handleAgentPrinterControlCreate(
          req,
          res,
          agentId,
          'resume'
        )
      }

      // ==================================================
      // CANCELAR IMPRESSÃO
      // ==================================================

      const agentPrinterCancelMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printer-cancel$/
        )

      if (
        req.method ===
          'POST' &&
        agentPrinterCancelMatch
      ) {
        const agentId =
          agentPrinterCancelMatch[1]

        return await handleAgentPrinterControlCreate(
          req,
          res,
          agentId,
          'cancel'
        )
      }

      // ==================================================
      // DESCONECTAR IMPRESSORA
      // ==================================================

      const agentPrinterDisconnectMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)\/printer-disconnect$/
        )

      if (
        req.method ===
          'POST' &&
        agentPrinterDisconnectMatch
      ) {
        const agentId =
          agentPrinterDisconnectMatch[1]

        return await handleAgentPrinterControlCreate(
          req,
          res,
          agentId,
          'disconnect'
        )
      }

      // ==================================================
      // LISTAR AGENTS
      // ==================================================

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/agents'
      ) {
        return await handleAgentsList(
          req,
          res
        )
      }

      const agentRevokeMatch =
        url.pathname.match(
          /^\/api\/agents\/([^/]+)$/
        )

      if (
        req.method ===
          'DELETE' &&
        agentRevokeMatch
      ) {
        return await handleAgentRevoke(
          req,
          res,
          agentRevokeMatch[1]
        )
      }

      // ==================================================
      // GERAR CÓDIGO DE PAREAMENTO
      // ==================================================

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/agents/pairing-code'
      ) {
        return await handleAgentPairingCodeCreate(
          req,
          res
        )
      }

      // ==================================================
      // READ ROUTES
      // ==================================================

      if (req.method === 'PUT' && url.pathname === '/api/settings') {
        return await handleSettingsUpdate(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/settings/company-lookup') {
        return await handleCompanyCnpjLookup(req, res, url)
      }

      if (req.method === 'GET' && url.pathname === '/api/settings/backup-status') {
        return await handleSettingsBackupStatus(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/settings/audit-requests') return await handleTenantAuditRequestsList(req, res)
      if (req.method === 'POST' && url.pathname === '/api/settings/audit-requests') return await handleTenantAuditRequestCreate(req, res)
      const tenantAuditRequestMatch = url.pathname.match(/^\/api\/settings\/audit-requests\/([^/]+)$/)
      if (req.method === 'DELETE' && tenantAuditRequestMatch) return await handleTenantAuditRequestCancel(req, res, tenantAuditRequestMatch[1])
      const tenantAuditMessagesMatch = url.pathname.match(/^\/api\/settings\/audit-requests\/([^/]+)\/messages$/)
      if (req.method === 'GET' && tenantAuditMessagesMatch) return await handleTenantAuditMessagesList(req, res, tenantAuditMessagesMatch[1])
      if (req.method === 'POST' && tenantAuditMessagesMatch) return await handleTenantAuditMessageCreate(req, res, tenantAuditMessagesMatch[1])

      if (req.method === 'GET' && url.pathname === '/api/support/requests') return await handleTenantAuditRequestsList(req, res)
      if (req.method === 'GET' && url.pathname === '/api/support/events') return await handleTenantSupportEvents(req, res)
      if (req.method === 'GET' && url.pathname === '/api/support/unread') return await handleTenantUnreadMessages(req, res)
      if (req.method === 'POST' && url.pathname === '/api/support/requests') return await handleTenantAuditRequestCreate(req, res)
      const supportRequestMatch = url.pathname.match(/^\/api\/support\/requests\/([^/]+)$/)
      if (req.method === 'DELETE' && supportRequestMatch) return await handleTenantAuditRequestCancel(req, res, supportRequestMatch[1])
      const supportMessagesMatch = url.pathname.match(/^\/api\/support\/requests\/([^/]+)\/messages$/)
      const supportAttachmentsMatch = url.pathname.match(/^\/api\/support\/requests\/([^/]+)\/attachments$/)
      if (req.method === 'GET' && supportAttachmentsMatch) return await handleTenantSupportAttachmentsList(req, res, supportAttachmentsMatch[1])
      if (req.method === 'POST' && supportAttachmentsMatch) return await handleTenantSupportAttachmentCreate(req, res, supportAttachmentsMatch[1])
      const supportAttachmentReadMatch = url.pathname.match(/^\/api\/support\/requests\/([^/]+)\/attachments\/([^/]+)$/)
      if (req.method === 'GET' && supportAttachmentReadMatch) return await handleTenantSupportAttachmentRead(req, res, supportAttachmentReadMatch[1], supportAttachmentReadMatch[2])
      if (req.method === 'GET' && supportMessagesMatch) return await handleTenantAuditMessagesList(req, res, supportMessagesMatch[1])
      if (req.method === 'POST' && supportMessagesMatch) return await handleTenantAuditMessageCreate(req, res, supportMessagesMatch[1])

      if (req.method === 'GET' && url.pathname === '/api/settings/export') {
        return await handleSettingsExport(req, res, url)
      }

      if (req.method === 'GET' && url.pathname === '/api/settings/export-history') {
        return await handleSettingsExportHistory(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/reports/financial-export') {
        return await handleFinancialReportExport(req, res, url)
      }

      if (req.method === 'GET' && url.pathname === '/api/calculator/simulations') {
        return await handleCalculatorSimulationsList(req, res)
      }
      if (req.method === 'POST' && url.pathname === '/api/calculator/simulations') {
        return await handleCalculatorSimulationCreate(req, res)
      }

      if (
        req.method ===
          'GET' &&
        readRoutes[
          url.pathname
        ]
      ) {
        return sendJson(
          res,
          200,
          await readRoutes[
            url.pathname
          ](
            req
          )
        )
      }

      // ==================================================
      // OPERACAO / NOTIFICACOES
      // ==================================================

      if (req.method === 'GET' && url.pathname === '/api/platform-admin/overview') {
        return await handlePlatformOverview(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/platform-admin/tenants') {
        return await handlePlatformTenantsList(req, res, url)
      }
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/plans') return await handlePlatformPlansList(req, res)
      const platformPlanBillingConfigMatch = url.pathname.match(/^\/api\/platform-admin\/plans\/([^/]+)\/billing-configuration$/)
      if (req.method === 'POST' && platformPlanBillingConfigMatch) return await handlePlatformPlanBillingConfigurationUpdate(req, res, platformPlanBillingConfigMatch[1])
      const platformTenantDetailsMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/details$/)
      if (req.method === 'GET' && platformTenantDetailsMatch) return await handlePlatformTenantDetails(req, res, platformTenantDetailsMatch[1])
      const platformTenantUsersMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/users$/)
      if (req.method === 'GET' && platformTenantUsersMatch) return await handlePlatformTenantUsers(req, res, platformTenantUsersMatch[1])
      const platformTenantSubscriptionEventsMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/subscription-events$/)
      if (req.method === 'GET' && platformTenantSubscriptionEventsMatch) return await handlePlatformTenantSubscriptionEvents(req, res, platformTenantSubscriptionEventsMatch[1], url)
      const platformTenantBillingRecordsMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/billing-records$/)
      if (req.method === 'GET' && platformTenantBillingRecordsMatch) return await handlePlatformTenantBillingRecords(req, res, platformTenantBillingRecordsMatch[1], url)
      const platformTenantSubscriptionMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/subscription$/)
      if (req.method === 'POST' && platformTenantSubscriptionMatch) return await handlePlatformTenantSubscriptionUpdate(req, res, platformTenantSubscriptionMatch[1])
      if (req.method === 'POST' && platformTenantBillingRecordsMatch) return await handlePlatformTenantBillingRecordCreate(req, res, platformTenantBillingRecordsMatch[1])

      if (req.method === 'GET' && url.pathname === '/api/platform-admin/audit') {
        return await handlePlatformAdminAudit(req, res, url)
      }
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/audit-export') {
        return await handlePlatformAdminAuditExport(req, res, url)
      }

      if (req.method === 'GET' && url.pathname === '/api/platform-admin/tenant-deletions') {
        return await handlePlatformTenantDeletionAudit(req, res, url)
      }
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/audit-requests') return await handlePlatformAuditRequestsList(req, res, url)
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/notifications') return await handlePlatformNotificationsList(req, res)
      const platformNotificationReadMatch = url.pathname.match(/^\/api\/platform-admin\/notifications\/([^/]+)\/read$/)
      if (req.method === 'POST' && platformNotificationReadMatch) return await handlePlatformNotificationRead(req, res, platformNotificationReadMatch[1])
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/chat-assignees') return await handlePlatformChatAssigneesList(req, res)
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/support-macros') return await handlePlatformSupportMacrosList(req, res)
      const platformAuditRequestMessagesMatch = url.pathname.match(/^\/api\/platform-admin\/audit-requests\/([^/]+)\/messages$/)
      if (req.method === 'GET' && platformAuditRequestMessagesMatch) return await handlePlatformAuditMessagesList(req, res, platformAuditRequestMessagesMatch[1])
      if (req.method === 'POST' && platformAuditRequestMessagesMatch) return await handlePlatformAuditMessageCreate(req, res, platformAuditRequestMessagesMatch[1])
      const platformAuditRequestDecisionMatch = url.pathname.match(/^\/api\/platform-admin\/audit-requests\/([^/]+)\/decision$/)
      if (req.method === 'POST' && platformAuditRequestDecisionMatch) return await handlePlatformAuditDecision(req, res, platformAuditRequestDecisionMatch[1])
      const platformAuditRequestCloseMatch = url.pathname.match(/^\/api\/platform-admin\/audit-requests\/([^/]+)\/close-chat$/)
      if (req.method === 'POST' && platformAuditRequestCloseMatch) return await handlePlatformAuditChatClose(req, res, platformAuditRequestCloseMatch[1])
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/support-requests') return await handlePlatformAuditRequestsList(req, res, url)
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/support-metrics') return await handlePlatformSupportMetrics(req, res, url)
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/support-sla-rules') return await handlePlatformSupportSlaRulesList(req, res)
      const platformSupportSlaRuleMatch = url.pathname.match(/^\/api\/platform-admin\/support-sla-rules\/([^/]+)$/)
      if (req.method === 'POST' && platformSupportSlaRuleMatch) return await handlePlatformSupportSlaRuleUpdate(req, res, platformSupportSlaRuleMatch[1])
      if (req.method === 'POST' && url.pathname === '/api/platform-admin/support-requests/bulk') return await handlePlatformSupportBulkUpdate(req, res)
      if (req.method === 'POST' && url.pathname === '/api/platform-admin/support-requests/auto-assign') return await handlePlatformSupportAutoAssign(req, res)
      if (req.method === 'GET' && url.pathname === '/api/platform-admin/support-requests/report') return await handlePlatformSupportRequestsReport(req, res, url)
      const platformSupportMessagesMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/messages$/)
      const platformSupportHistoryMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/history$/)
      if (req.method === 'GET' && platformSupportHistoryMatch) return await handlePlatformSupportHistory(req, res, platformSupportHistoryMatch[1])
      const platformSupportAttachmentsMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/attachments$/)
      if (req.method === 'GET' && platformSupportAttachmentsMatch) return await handlePlatformSupportAttachmentsList(req, res, platformSupportAttachmentsMatch[1])
      if (req.method === 'POST' && platformSupportAttachmentsMatch) return await handlePlatformSupportAttachmentCreate(req, res, platformSupportAttachmentsMatch[1])
      const platformSupportAttachmentReadMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/attachments\/([^/]+)$/)
      if (req.method === 'GET' && platformSupportAttachmentReadMatch) return await handlePlatformSupportAttachmentRead(req, res, platformSupportAttachmentReadMatch[1], platformSupportAttachmentReadMatch[2])
      if (req.method === 'GET' && platformSupportMessagesMatch) return await handlePlatformAuditMessagesList(req, res, platformSupportMessagesMatch[1])
      if (req.method === 'POST' && platformSupportMessagesMatch) return await handlePlatformAuditMessageCreate(req, res, platformSupportMessagesMatch[1])
      const platformSupportChatReportMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/report$/)
      if (req.method === 'GET' && platformSupportChatReportMatch) return await handlePlatformAuditChatReport(req, res, platformSupportChatReportMatch[1], url)
      const platformSupportDecisionMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/decision$/)
      if (req.method === 'POST' && platformSupportDecisionMatch) return await handlePlatformAuditDecision(req, res, platformSupportDecisionMatch[1])
      const platformSupportCloseMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/close-chat$/)
      if (req.method === 'POST' && platformSupportCloseMatch) return await handlePlatformAuditChatClose(req, res, platformSupportCloseMatch[1])
      const platformSupportReopenMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/reopen$/)
      if (req.method === 'POST' && platformSupportReopenMatch) return await handlePlatformSupportReopen(req, res, platformSupportReopenMatch[1])
      const platformSupportSnoozeMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/snooze$/)
      if (req.method === 'POST' && platformSupportSnoozeMatch) return await handlePlatformSupportSnooze(req, res, platformSupportSnoozeMatch[1])
      const platformChatClaimMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/claim$/)
      if (req.method === 'POST' && platformChatClaimMatch) return await handlePlatformChatClaim(req, res, platformChatClaimMatch[1])
      const platformChatTransferMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/transfer$/)
      if (req.method === 'POST' && platformChatTransferMatch) return await handlePlatformChatTransfer(req, res, platformChatTransferMatch[1])
      const platformChatCollaboratorMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/collaborators$/)
      if (req.method === 'POST' && platformChatCollaboratorMatch) return await handlePlatformChatCollaboratorAdd(req, res, platformChatCollaboratorMatch[1])
      const platformSupportMetadataMatch = url.pathname.match(/^\/api\/platform-admin\/support-requests\/([^/]+)\/metadata$/)
      if (req.method === 'POST' && platformSupportMetadataMatch) return await handlePlatformSupportMetadataUpdate(req, res, platformSupportMetadataMatch[1])
      const platformPrivacyUpdateMatch = url.pathname.match(/^\/api\/platform-admin\/privacy-requests\/([^/]+)$/)
      if (req.method === 'POST' && platformPrivacyUpdateMatch) return await handlePlatformPrivacyRequestUpdate(req, res, platformPrivacyUpdateMatch[1])
      const platformPrivacyExportMatch = url.pathname.match(/^\/api\/platform-admin\/privacy-requests\/([^/]+)\/export$/)
      if (req.method === 'GET' && platformPrivacyExportMatch) return await handlePlatformPrivacyPortabilityExport(req, res, platformPrivacyExportMatch[1])

      const platformTenantAuditMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/audit$/)
      if (req.method === 'GET' && platformTenantAuditMatch) {
        return await handlePlatformTenantAudit(req, res, platformTenantAuditMatch[1], url)
      }

      const platformTenantAuditExportMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/audit-export$/)
      if (req.method === 'GET' && platformTenantAuditExportMatch) {
        return await handlePlatformTenantAuditExport(req, res, platformTenantAuditExportMatch[1], url)
      }

      const platformDataAccessMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/data-access-requests$/)
      if (req.method === 'POST' && platformDataAccessMatch) return await handleDataAccessRequest(req, res, platformDataAccessMatch[1])
      const platformDataAccessVerifyMatch = url.pathname.match(/^\/api\/platform-admin\/data-access-requests\/([^/]+)\/verify$/)
      if (req.method === 'POST' && platformDataAccessVerifyMatch) return await handleDataAccessVerify(req, res, platformDataAccessVerifyMatch[1])

      const platformTenantStatusMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/status$/)
      if (req.method === 'POST' && platformTenantStatusMatch) {
        return await handlePlatformTenantStatusUpdate(req, res, platformTenantStatusMatch[1])
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/api/operational-notifications'
      ) {
        return await handleOperationalNotificationsList(req, res, url)
      }

      if (req.method === 'GET' && url.pathname === '/api/operational-health') {
        return await handleOperationalHealth(req, res)
      }

      const notificationReadMatch = url.pathname.match(/^\/api\/operational-notifications\/([^/]+)\/read$/)
      if (req.method === 'POST' && notificationReadMatch) {
        return await handleOperationalNotificationRead(req, res, notificationReadMatch[1])
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/api/operational-audit-events'
      ) {
        return await handleOperationalAuditList(req, res, url)
      }

      // ==================================================
      // INTEGRAÇÕES
      // ==================================================

      if (req.method === 'GET' && url.pathname === '/api/integrations/overview') {
        return await handleIntegrationsOverview(req, res)
      }

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/marketplace-integrations'
      ) {
        return await handleIntegrationsList(
          req,
          res
        )
      }

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/marketplace-integrations'
      ) {
        return await handleIntegrationCreate(
          req,
          res
        )
      }

      const marketplaceIntegrationDisconnectMatch =
        url.pathname.match(/^\/api\/marketplace-integrations\/([^/]+)$/)

      if (
        req.method ===
          'DELETE' &&
        marketplaceIntegrationDisconnectMatch
      ) {
        return await handleMarketplaceIntegrationDisconnect(
          req,
          res,
          marketplaceIntegrationDisconnectMatch[1]
        )
      }

      const marketplaceOAuthStartMatch =
        url.pathname.match(
          /^\/api\/marketplace-integrations\/([^/]+)\/oauth-start$/
        )

      if (
        req.method ===
          'POST' &&
        marketplaceOAuthStartMatch
      ) {
        return await handleMarketplaceOAuthStart(
          req,
          res,
          marketplaceOAuthStartMatch[1]
        )
      }

      const marketplaceOrderSyncMatch =
        url.pathname.match(
          /^\/api\/marketplace-integrations\/([^/]+)\/sync-order$/
        )

      if (
        req.method ===
          'POST' &&
        marketplaceOrderSyncMatch
      ) {
        return await handleMarketplaceOrderSync(
          req,
          res,
          marketplaceOrderSyncMatch[1]
        )
      }

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/marketplace-integrations/oauth-callback'
      ) {
        return await handleMarketplaceOAuthCallback(
          req,
          res,
          url
        )
      }

      // ==================================================
      // PEDIDOS DE MARKETPLACE
      // ==================================================

      if (
        req.method ===
          'GET' &&
        url.pathname ===
          '/api/marketplace-orders'
      ) {
        return await handleMarketplaceOrdersList(
          req,
          res
        )
      }

      const marketplaceOrderLinkMatch =
        url.pathname.match(
          /^\/api\/marketplace-orders\/([^/]+)\/link-product$/
        )

      if (
        req.method ===
          'POST' &&
        marketplaceOrderLinkMatch
      ) {
        return await handleMarketplaceOrderLinkProduct(
          req,
          res,
          marketplaceOrderLinkMatch[1]
        )
      }

      // ==================================================
      // FILA DE IMPRESSAO
      // ==================================================

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/print-jobs/enqueue'
      ) {
        return await handlePrintJobEnqueue(
          req,
          res
        )
      }

      const printJobActionMatch =
        url.pathname.match(
          /^\/api\/print-jobs\/([^/]+)\/(approve|reorder|move-printer|start-manual|cancel|complete)$/
        )

      if (
        req.method ===
          'POST' &&
        printJobActionMatch
      ) {
        const [
          ,
          printJobId,
          action
        ] =
          printJobActionMatch

        if (
          action ===
          'approve'
        ) {
          return await handlePrintJobApprove(
            req,
            res,
            printJobId
          )
        }

        if (
          action ===
          'reorder'
        ) {
          return await handlePrintJobReorder(
            req,
            res,
            printJobId
          )
        }

        if (
          action ===
          'move-printer'
        ) {
          return await handlePrintJobMovePrinter(
            req,
            res,
            printJobId
          )
        }

        if (
          action ===
          'start-manual'
        ) {
          return await handlePrintJobStartManual(
            req,
            res,
            printJobId
          )
        }

        if (
          action ===
          'cancel'
        ) {
          return await handlePrintJobCancel(
            req,
            res,
            printJobId
          )
        }

        if (
          action ===
          'complete'
        ) {
          return await handlePrintJobComplete(
            req,
            res,
            printJobId
          )
        }
      }

      // ==================================================
      // PRODUTOS
      // ==================================================

      if (
        req.method ===
          'POST' &&
        url.pathname ===
          '/api/products'
      ) {
        return await handleProductCreate(
          req,
          res
        )
      }

      const productPrintFileMatch =
        url.pathname.match(
          /^\/api\/products\/([^/]+)\/print-file$/
        )

      if (
        req.method ===
          'PUT' &&
        productPrintFileMatch
      ) {
        return await handleProductPrintFileUpload(
          req,
          res,
          productPrintFileMatch[1],
          url
        )
      }

      // ==================================================
      // RESOURCES GENÉRICOS
      // ==================================================

      const filamentMovementsMatch = url.pathname.match(/^\/api\/filaments\/([^/]+)\/movements$/)
      if (filamentMovementsMatch && ['GET', 'POST'].includes(req.method)) {
        return await handleFilamentMovements(req, res, filamentMovementsMatch[1])
      }

      const orderStageMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/advance-stage$/)
      if (req.method === 'POST' && orderStageMatch) return await handleOrderStageAdvance(req, res, orderStageMatch[1])

      if (req.method === 'POST' && url.pathname === '/api/expenses/recurring/generate') return await handleRecurringExpensesGenerate(req, res)

      const resourceMatch =
        url.pathname.match(
          /^\/api\/([a-z-]+)(?:\/([^/]+))?$/
        )

      if (
        resourceMatch
      ) {
        const [
          ,
          resource,
          id
        ] =
          resourceMatch

        if (
          req.method ===
            'GET' &&
          id
        ) {
          return await handleResourceRead(
            req,
            res,
            resource,
            id
          )
        }

        if (
          req.method ===
            'POST' &&
          !id
        ) {
          return await handleResourceCreate(
            req,
            res,
            resource
          )
        }

        if (
          req.method ===
            'PUT' &&
          id
        ) {
          return await handleResourceUpdate(
            req,
            res,
            resource,
            id
          )
        }

        if (
          req.method ===
            'DELETE' &&
          id
        ) {
          return await handleResourceDelete(
            req,
            res,
            resource,
            id
          )
        }
      }

      // ==================================================
      // 404
      // ==================================================

      return sendJson(
        res,
        404,
        {
          error:
            'Endpoint nao encontrado'
        }
      )
    } catch (
      error
    ) {
      const expectedClientErrors =
        new Set([
          'Registro nao encontrado',
          'Membro nao encontrado',
          'E-mail ou senha invalidos.',
          'Informe a senha atual.',
          'Senha atual invalida.',
          'A nova senha deve ser diferente da senha atual.',
          'A senha precisa ter pelo menos 10 caracteres.',
          'A senha precisa conter letra minuscula.',
          'A senha precisa conter letra maiuscula.',
          'A senha precisa conter numero.',
          'A senha precisa conter caractere especial.',
          'Refresh token invalido.',
          'Refresh token reutilizado.'
        ])

      const status =
        error.message === 'Registro nao encontrado' ||
        error.message === 'Membro nao encontrado'
          ? 404
          : 400

      if (
        !expectedClientErrors.has(
          error.message
        )
      ) {
        console.error(
          'Erro ao processar requisicao',
          {
            method:
              req.method,

            url:
              req.url,

            message:
              error.message
          }
        )
      }

      return sendJson(
        res,
        status,
        {
          error:
            error.message ||
            'Requisicao invalida'
        }
      )
    }
  }
