import {
  sendJson
} from '../http/response.js'

import {
  enterRequest
} from '../http/rateLimit.js'

import {
  handleLogin,
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
  handleMercadoLivreWebhook,
  handleShopeeWebhook
} from './integrations.js'

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
        !isPublicAgentRoute

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

      // ==================================================
      // CONSULTAR RESULTADO DE COMANDO
      // ==================================================

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
          'E-mail ou senha invalidos.',
          'Refresh token invalido.',
          'Refresh token reutilizado.'
        ])

      const status =
        error.message ===
        'Registro nao encontrado'
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
