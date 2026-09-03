import { configureCors, sendJson } from '../http/response.js'

import {
  enterRequest
} from '../http/rateLimit.js'

import {
  handleLogin,
  handleInvitationAccept,
  handleSessionRevoke,
  handleSessionsList,
  handleSessionsRevokeAll,
  handleLogout,
  handleMe,
  handleRefresh,
  handleRegister,
  getAuthUser
} from './auth.js'

import {
  env
} from '../config/env.js'

import {
  canAccessRequest
} from '../auth/authorization.js'

import {
  handleProductCreate,
  handleProductPrintFileUpload,
  handleResourceCreate,
  handleResourceDelete,
  handleResourceRead,
  handleResourceUpdate,
  readRoutes
} from './resources.js'

import {
  handleAmazonWebhook,
  handleIntegrationCreate,
  handleIntegrationsList,
  handleMarketplaceOAuthCallback,
  handleMarketplaceOAuthStart,
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
  handleOperationalNotificationRead,
  handleOperationalNotificationsList
} from './operations.js'

import {
  handleMemberUpdate,
  handleMembersList,
  handleInvitationCreate
} from './members.js'

import {
  handlePlatformAdminAudit,
  handleDataAccessRequest,
  handleDataAccessVerify,
  handlePlatformUserAudit,
  handlePlatformOverview,
  handlePlatformTenantAudit,
  handlePlatformTenantsList,
  handlePlatformTenantStatusUpdate
} from './platformAdmin.js'

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
        enterRequest(
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

            endpoints:
              Object.keys(
                readRoutes
              )
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
      }

      // ==================================================
      // CONSULTAR RESULTADO DE COMANDO
      // ==================================================

      if (req.method === 'GET' && url.pathname === '/api/members') {
        return await handleMembersList(req, res)
      }

      if (req.method === 'POST' && url.pathname === '/api/members/invitations') {
        return await handleInvitationCreate(req, res)
      }

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
        return await handlePlatformTenantsList(req, res)
      }

      if (req.method === 'GET' && url.pathname === '/api/platform-admin/audit') {
        return await handlePlatformAdminAudit(req, res, url)
      }

      if (req.method === 'GET' && url.pathname === '/api/platform-admin/user-audit') {
        return await handlePlatformUserAudit(req, res, url)
      }

      const platformTenantAuditMatch = url.pathname.match(/^\/api\/platform-admin\/tenants\/([^/]+)\/audit$/)
      if (req.method === 'GET' && platformTenantAuditMatch) {
        return await handlePlatformTenantAudit(req, res, platformTenantAuditMatch[1], url)
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
