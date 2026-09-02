import crypto from 'node:crypto'

import {
  query,
  tenantQuery,
  withTenant
} from '../db/pool.js'

import {
  readJsonBody
} from '../http/body.js'

import {
  sendJson
} from '../http/response.js'

import {
  getAuthUser
} from './auth.js'

import {
  validatePrintCompatibility
} from '../services/printValidation.js'

import {
  openPrintFileReadStream
} from '../services/printFileStorage.js'

// ======================================================
// CONFIGURAÃ‡Ã•ES
// ======================================================

// Evita caracteres fÃ¡ceis de confundir,
// como 0/O e 1/I.
const alphabet =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// ======================================================
// CÃ“DIGO DE PAREAMENTO
// ======================================================

const randomPart = (
  length = 4
) => {
  let value = ''

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    const index =
      crypto.randomInt(
        0,
        alphabet.length
      )

    value +=
      alphabet[index]
  }

  return value
}

const createPairingCode =
  () => {
    return `PF-${randomPart()}-${randomPart()}`
  }

const hashPairingCode = (
  code
) => {
  return crypto
    .createHash(
      'sha256'
    )
    .update(
      code
    )
    .digest(
      'hex'
    )
}

// ======================================================
// PROTEÃ‡ÃƒO DE SEGREDOS DOS COMANDOS
// ======================================================
//
// DATA_ENCRYPTION_KEY fica somente no BackEnd.
//
// O LAN Access Code da Bambu:
//
// FrontEnd
//   â†“
// BackEnd recebe em texto
//   â†“
// AES-256-GCM
//   â†“
// banco recebe somente ciphertext
//   â†“
// Agent autenticado busca comando
//   â†“
// BackEnd descriptografa em memÃ³ria
//   â†“
// Agent recebe accessCode
//
// O Agent nunca recebe DATA_ENCRYPTION_KEY.
// ======================================================

const getCommandEncryptionKey =
  () => {
    const rawKey =
      String(
        process.env
          .DATA_ENCRYPTION_KEY ||
        ''
      ).trim()

    if (!rawKey) {
      throw new Error(
        'DATA_ENCRYPTION_KEY nao configurada'
      )
    }

    /*
     * Transformamos a chave configurada
     * em exatamente 32 bytes para
     * AES-256.
     */
    return crypto
      .createHash(
        'sha256'
      )
      .update(
        rawKey
      )
      .digest()
  }

// ======================================================
// CONTEXTO DA CRIPTOGRAFIA
// ======================================================

const buildCommandSecretContext = (
  tenantId,
  agentId,
  secretName
) => {
  return [
    'printflow',
    'agent-command',
    String(
      tenantId
    ),
    String(
      agentId
    ),
    String(
      secretName
    ),
    'v1'
  ].join(':')
}

// ======================================================
// CRIPTOGRAFAR SEGREDO
// ======================================================

const encryptCommandSecret = (
  value,
  context
) => {
  const plaintext =
    String(
      value || ''
    )

  if (!plaintext) {
    throw new Error(
      'Segredo vazio nao pode ser criptografado'
    )
  }

  /*
   * 12 bytes Ã© o tamanho recomendado
   * para IV no AES-GCM.
   */
  const iv =
    crypto.randomBytes(
      12
    )

  const cipher =
    crypto.createCipheriv(
      'aes-256-gcm',
      getCommandEncryptionKey(),
      iv
    )

  /*
   * AAD vincula esse ciphertext
   * ao tenant + Agent + tipo do segredo.
   *
   * Isso impede reutilizar o segredo
   * criptografado em outro Agent.
   */
  cipher.setAAD(
    Buffer.from(
      context,
      'utf8'
    )
  )

  const ciphertext =
    Buffer.concat([
      cipher.update(
        plaintext,
        'utf8'
      ),

      cipher.final()
    ])

  const authTag =
    cipher.getAuthTag()

  return {
    protected:
      true,

    version:
      1,

    algorithm:
      'aes-256-gcm',

    iv:
      iv.toString(
        'base64'
      ),

    authTag:
      authTag.toString(
        'base64'
      ),

    ciphertext:
      ciphertext.toString(
        'base64'
      )
  }
}

const authenticateAgentRequest =
  async (
    req
  ) => {
    const agentId =
      String(
        req.headers[
          'x-agent-id'
        ] ||
        ''
      ).trim()

    const agentSecret =
      String(
        req.headers[
          'x-agent-secret'
        ] ||
        ''
      ).trim()

    if (
      !agentId ||
      !agentSecret
    ) {
      return null
    }

    const secretHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          agentSecret
        )
        .digest(
          'hex'
        )

    const result =
      await query(
        `
          select
            id,
            tenant_id
          from agents
          where id = $1
            and secret_hash = $2
            and secret_hash is not null
            and status <> 'revoked'
          limit 1
        `,
        [
          agentId,
          secretHash
        ]
      )

    return result
      .rows[0] ||
      null
  }

// ======================================================
// DESCRIPTOGRAFAR SEGREDO
// ======================================================

const decryptCommandSecret = (
  encryptedValue,
  context
) => {
  if (
    !encryptedValue ||
    encryptedValue.protected !==
      true ||
    encryptedValue.version !==
      1 ||
    encryptedValue.algorithm !==
      'aes-256-gcm'
  ) {
    throw new Error(
      'Segredo criptografado invalido'
    )
  }

  const decipher =
    crypto.createDecipheriv(
      'aes-256-gcm',
      getCommandEncryptionKey(),
      Buffer.from(
        encryptedValue.iv,
        'base64'
      )
    )

  decipher.setAAD(
    Buffer.from(
      context,
      'utf8'
    )
  )

  decipher.setAuthTag(
    Buffer.from(
      encryptedValue.authTag,
      'base64'
    )
  )

  const plaintext =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          encryptedValue
            .ciphertext,
          'base64'
        )
      ),

      decipher.final()
    ])

  return plaintext.toString(
    'utf8'
  )
}

// ======================================================
// OCULTAR SEGREDOS DO FRONTEND
// ======================================================

const sanitizeCommandPayloadForUser = (
  payload
) => {
  if (
    !payload ||
    typeof payload !==
      'object'
  ) {
    return {}
  }

  const safePayload =
    structuredClone(
      payload
    )

  /*
   * O usuÃ¡rio nÃ£o precisa receber
   * o accessCode novamente quando
   * consulta o resultado do comando.
   */
  if (
    safePayload.options &&
    typeof safePayload.options ===
      'object' &&
    'accessCode' in
      safePayload.options
  ) {
    safePayload
      .options
      .accessCode =
        '[PROTECTED]'
  }

  return safePayload
}

// ======================================================
// GERAR CÃ“DIGO DE PAREAMENTO
// ======================================================

export const handleAgentPairingCodeCreate =
  async (
    req,
    res
  ) => {
    const user =
      await getAuthUser(
        req
      )

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Login necessario'
        }
      )
    }

    const code =
      createPairingCode()

    const codeHash =
      hashPairingCode(
        code
      )

    // CÃ³digo vÃ¡lido por 10 minutos.
    const expiresAt =
      new Date(
        Date.now() +
        10 *
        60 *
        1000
      )

    await tenantQuery(
      user.tenantId,
      `
        insert into agent_pairing_codes (
          tenant_id,
          code_hash,
          expires_at
        )
        values (
          $1,
          $2,
          $3
        )
      `,
      [
        user.tenantId,
        codeHash,
        expiresAt
      ]
    )

    return sendJson(
      res,
      201,
      {
        code,

        expiresAt:
          expiresAt
            .toISOString()
      }
    )
  }

// ======================================================
// PAREAR AGENT
// ======================================================

export const handleAgentPair =
  async (
    req,
    res
  ) => {
    const body =
      await readJsonBody(
        req
      )

    const code =
      String(
        body.code || ''
      )
        .trim()
        .toUpperCase()

    const machineName =
      String(
        body.machineName ||
        ''
      ).trim()

    const platform =
      String(
        body.platform ||
        ''
      ).trim()

    const architecture =
      String(
        body.architecture ||
        ''
      ).trim()

    const version =
      String(
        body.version ||
        ''
      ).trim()

    if (!code) {
      return sendJson(
        res,
        400,
        {
          error:
            'Codigo de conexao obrigatorio'
        }
      )
    }

    if (!machineName) {
      return sendJson(
        res,
        400,
        {
          error:
            'Nome do computador obrigatorio'
        }
      )
    }

    const codeHash =
      hashPairingCode(
        code
      )

    /*
     * Aqui ainda nÃ£o sabemos
     * o tenant do Agent.
     */
    const pairingResult =
      await query(
        `
          select
            id,
            tenant_id,
            expires_at,
            used_at
          from agent_pairing_codes
          where code_hash = $1
          limit 1
        `,
        [
          codeHash
        ]
      )

    const pairing =
      pairingResult
        .rows[0]

    if (!pairing) {
      return sendJson(
        res,
        400,
        {
          error:
            'Codigo de conexao invalido'
        }
      )
    }

    if (
      pairing.used_at
    ) {
      return sendJson(
        res,
        400,
        {
          error:
            'Este codigo ja foi utilizado'
        }
      )
    }

    if (
      new Date(
        pairing.expires_at
      ).getTime() <
      Date.now()
    ) {
      return sendJson(
        res,
        400,
        {
          error:
            'Codigo de conexao expirado'
        }
      )
    }

    // ==================================================
    // CRIAR SECRET DO AGENT
    // ==================================================

    const agentSecret =
      `pf_agent_${crypto
        .randomBytes(32)
        .toString('hex')}`

    /*
     * Nunca salvamos agentSecret
     * puro no banco.
     */
    const secretHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          agentSecret
        )
        .digest(
          'hex'
        )

    const agentResult =
      await query(
        `
          insert into agents (
            tenant_id,
            name,
            machine_name,
            platform,
            architecture,
            agent_version,
            secret_hash,
            status,
            last_seen_at
          )
          values (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            'online',
            now()
          )

          on conflict (
            tenant_id,
            machine_name
          )

          do update set
            platform =
              excluded.platform,

            architecture =
              excluded.architecture,

            agent_version =
              excluded.agent_version,

            secret_hash =
              excluded.secret_hash,

            status =
              'online',

            last_seen_at =
              now(),

            updated_at =
              now()

          returning
            id,
            tenant_id,
            machine_name,
            (
              select name
              from tenants
              where id = $1
              limit 1
            ) as tenant_name
        `,
        [
          pairing.tenant_id,
          machineName,
          machineName,
          platform,
          architecture,
          version,
          secretHash
        ]
      )

    /*
     * CÃ³digo de pareamento Ã©
     * utilizado somente uma vez.
     */
    await query(
      `
        update agent_pairing_codes
        set
          used_at = now()
        where id = $1
      `,
      [
        pairing.id
      ]
    )

    const agent =
      agentResult
        .rows[0]

    return sendJson(
      res,
      201,
      {
        agentId:
          String(
            agent.id
          ),

        agentSecret,

        tenantId:
          agent.tenant_id,

        tenantName:
          agent.tenant_name ||
          '',

        machineName:
          agent.machine_name
      }
    )
  }

// ======================================================
// VERIFICAR AGENT
// ======================================================

export const handleAgentVerify =
  async (
    req,
    res
  ) => {
    const agentId =
      String(
        req.headers[
          'x-agent-id'
        ] ||
        ''
      ).trim()

    const agentSecret =
      String(
        req.headers[
          'x-agent-secret'
        ] ||
        ''
      ).trim()

    if (
      !agentId ||
      !agentSecret
    ) {
      return sendJson(
        res,
        401,
        {
          error:
            'Credenciais do Agent obrigatorias'
        }
      )
    }


    const secretHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          agentSecret
        )
        .digest(
          'hex'
        )

    const result =
      await query(
        `
          select
            id,
            tenant_id,
            machine_name,
            platform,
            architecture,
            agent_version,
            status
          from agents
          where id = $1
            and secret_hash = $2
            and secret_hash is not null
            and status <> 'revoked'
          limit 1
        `,
        [
          agentId,
          secretHash
        ]
      )

    const agent =
      result.rows[0]

    if (!agent) {
      return sendJson(
        res,
        401,
        {
          error:
            'Agent invalido'
        }
      )
    }

    await query(
      `
        update agents
        set
          status =
            'online',


          last_seen_at =
            now(),

          updated_at =
            now()

        where id = $1
      `,
      [
        agent.id
      ]
    )

    return sendJson(
      res,
      200,
      {
        status:
          'authenticated',

        agent: {
          id:
            String(
              agent.id
            ),

          machineName:
            agent.machine_name,

          platform:
            agent.platform,

          architecture:
            agent.architecture,

          version:
            agent.agent_version
        }
      }
    )
  }

// ======================================================
// HEARTBEAT
// ======================================================

export const handleAgentHeartbeat =
  async (
    req,
    res
  ) => {
    const agentId =
      String(
        req.headers[
          'x-agent-id'
        ] ||
        ''
      ).trim()

    const agentSecret =
      String(
        req.headers[
          'x-agent-secret'
        ] ||
        ''
      ).trim()

    if (
      !agentId ||
      !agentSecret
    ) {
      return sendJson(
        res,
        401,
        {
          error:
            'Credenciais do Agent obrigatorias'
        }
      )
    }

    const body =
      await readJsonBody(
        req
      )

    const version =
      String(
        body.version ||
        ''
      ).trim()

    const platform =
      String(
        body.platform ||
        ''
      ).trim()

    const architecture =
      String(
        body.architecture ||
        ''
      ).trim()

    const secretHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          agentSecret
        )
        .digest(
          'hex'
        )

    const result =
      await query(
        `
          update agents
          set
            status =
              'online',


            agent_version =
              case
                when $3 <> '' then $3
                else agent_version
              end,

            platform =
              case
                when $4 <> '' then $4
                else platform
              end,

            architecture =
              case
                when $5 <> '' then $5
                else architecture
              end,
            last_seen_at =
              now(),

            updated_at =
              now()

          where id = $1
            and secret_hash = $2
            and secret_hash is not null
            and status <> 'revoked'

          returning
            id,
            machine_name,
            last_seen_at
        `,
        [
          agentId,
          secretHash,
          version,
          platform,
          architecture
        ]
      )

    const agent =
      result.rows[0]

    if (!agent) {
      return sendJson(
        res,
        401,
        {
          error:
            'Agent invalido'
        }
      )
    }

    return sendJson(
      res,
      200,
      {
        status:
          'online',

        lastSeenAt:
          agent.last_seen_at
      }
    )
  }

// ======================================================
// LISTAR AGENTS
// ======================================================

export const handleAgentsList =
  async (
    req,
    res
  ) => {
    const user =
      await getAuthUser(
        req
      )

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Login necessario'
        }
      )
    }

    const result =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            name,
            machine_name,
            platform,
            architecture,
            agent_version,
            status,
            last_seen_at,
            created_at,
            updated_at
          from agents
          where tenant_id = $1
          order by
            created_at desc
        `,
        [
          user.tenantId
        ]
      )

    const agents =
      result.rows.map(
        agent => ({
          id:
            String(
              agent.id
            ),

          name:
            agent.name,

          machineName:
            agent.machine_name,

          platform:
            agent.platform,

          architecture:
            agent.architecture,

          version:
            agent.agent_version,

          status:
            agent.status,

          lastSeenAt:
            agent.last_seen_at,

          createdAt:
            agent.created_at,

          updatedAt:
            agent.updated_at
        })
      )

    return sendJson(
      res,
      200,
      {
        agents
      }
    )
  }

// ======================================================
// REVOGAR AGENT
// ======================================================

export const handleAgentRevoke =
  async (
    req,
    res,
    agentId
  ) => {
    const user =
      await getAuthUser(
        req
      )

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Login necessario'
        }
      )
    }

    if (!agentId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Agent obrigatorio'
        }
      )
    }

    const result =
      await tenantQuery(
        user.tenantId,
        `
          update agents
          set
            status = 'revoked',
            secret_hash = null,
            updated_at = now()
          where tenant_id = $1
            and id = $2
          returning
            id
        `,
        [
          user.tenantId,
          agentId
        ]
      )

    if (!result.rows[0]) {
      return sendJson(
        res,
        404,
        {
          error:
            'Agent nao encontrado'
        }
      )
    }

    await tenantQuery(
      user.tenantId,
      `
        update agent_commands
        set
          status = 'failed',
          result = $3::jsonb,
          completed_at = now()
        where tenant_id = $1
          and agent_id = $2
          and status in ('pending', 'running')
      `,
      [
        user.tenantId,
        agentId,
        JSON.stringify({
          success:
            false,
          error:
            'Agent revogado pelo usuario.'
        })
      ]
    )

    return sendJson(
      res,
      200,
      {
        status:
          'revoked'
      }
    )
  }

// ======================================================
// CRIAR COMANDO DE DESCOBERTA
// ======================================================

export const handleAgentDiscoverCreate =
  async (
    req,
    res,
    agentId
  ) => {
    const user =
      await getAuthUser(
        req
      )

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Login necessario'
        }
      )
    }

    if (!agentId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Agent obrigatorio'
        }
      )
    }

    /*
     * Confirma que o Agent
     * pertence ao tenant.
     */
    const agentResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            machine_name
          from agents
          where tenant_id = $1
            and id = $2
          limit 1
        `,
        [
          user.tenantId,
          agentId
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        404,
        {
          error:
            'Agent nao encontrado'
        }
      )
    }

    const commandResult =
      await tenantQuery(
        user.tenantId,
        `
          insert into agent_commands (
            tenant_id,
            agent_id,
            command,
            payload,
            status
          )
          values (
            $1,
            $2,
            'discover_printers',
            '{}'::jsonb,
            'pending'
          )

          returning
            id,
            command,
            status,
            created_at
        `,
        [
          user.tenantId,
          agent.id
        ]
      )

    const command =
      commandResult
        .rows[0]

    return sendJson(
      res,
      201,
      {
        command: {
          id:
            String(
              command.id
            ),

          type:
            command.command,

          status:
            command.status,

          createdAt:
            command.created_at
        },

        agent: {
          id:
            String(
              agent.id
            ),

          machineName:
            agent.machine_name
        }
      }
    )
  }

// ======================================================
// BUSCAR PRÃ“XIMO COMANDO DO AGENT
// ======================================================

export const handleAgentCommandsPending =
  async (
    req,
    res
  ) => {
    const agentId =
      String(
        req.headers[
          'x-agent-id'
        ] ||
        ''
      ).trim()

    const agentSecret =
      String(
        req.headers[
          'x-agent-secret'
        ] ||
        ''
      ).trim()

    if (
      !agentId ||
      !agentSecret
    ) {
      return sendJson(
        res,
        401,
        {
          error:
            'Credenciais do Agent obrigatorias'
        }
      )
    }

    const secretHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          agentSecret
        )
        .digest(
          'hex'
        )

    // ==================================================
    // AUTENTICAR AGENT
    // ==================================================

    const agentResult =
      await query(
        `
          select
            id,
            tenant_id
          from agents
          where id = $1
            and secret_hash = $2
            and secret_hash is not null
            and status <> 'revoked'
          limit 1
        `,
        [
          agentId,
          secretHash
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        401,
        {
          error:
            'Agent invalido'
        }
      )
    }

    // ==================================================
    // EXPIRAR COMANDOS TRAVADOS
    // ==================================================
    //
    // Se o Agent cair depois de buscar um comando,
    // ele ficava indefinidamente como running.
    // ==================================================

    await query(
      `
        update agent_commands
        set
          status = 'failed',
          result = $3::jsonb,
          completed_at = now()
        where agent_id = $1
          and tenant_id = $2
          and status = 'running'
          and started_at < now() - interval '3 minutes'
      `,
      [
        agent.id,
        agent.tenant_id,
        JSON.stringify({
          success:
            false,

          error:
            'O Agent nao concluiu o comando dentro do tempo esperado.'
        })
      ]
    )

    // ==================================================
    // BUSCAR COMANDO
    // ==================================================

    const commandResult =
      await query(
        `
          select
            id,
            command,
            payload,
            status,
            created_at
          from agent_commands
          where agent_id = $1
            and tenant_id = $2
            and status = 'pending'
          order by
            created_at asc
          limit 1
        `,
        [
          agent.id,
          agent.tenant_id
        ]
      )

    const command =
      commandResult
        .rows[0]

    if (!command) {
      return sendJson(
        res,
        200,
        {
          command:
            null
        }
      )
    }

    // ==================================================
    // PREPARAR PAYLOAD
    // ==================================================

    let payloadForAgent =
      command.payload ||
      {}

    let payloadForStorage =
      command.payload ||
      {}

    // ==================================================
    // DESCRIPTOGRAFAR ACCESS CODE DA BAMBU
    // ==================================================

    if (
      command.command ===
        'connect_printer' &&
      payloadForAgent
        ?.printer
        ?.protocol ===
        'bambu' &&
      payloadForAgent
        ?.options
        ?.accessCode
    ) {
      const storedAccessCode =
        payloadForAgent
          .options
          .accessCode

      let accessCode

      /*
       * Novo formato seguro.
       */
      if (
        storedAccessCode &&
        typeof storedAccessCode ===
          'object' &&
        storedAccessCode
          .protected ===
          true
      ) {
        const context =
          buildCommandSecretContext(
            agent.tenant_id,
            agent.id,
            'bambu-access-code'
          )

        accessCode =
          decryptCommandSecret(
            storedAccessCode,
            context
          )
      } else {
        /*
         * Compatibilidade temporÃ¡ria
         * com comandos antigos que
         * possam ter sido salvos antes
         * desta implementaÃ§Ã£o.
         *
         * Isso pode ser removido depois.
         */
        accessCode =
          String(
            storedAccessCode ||
            ''
          )
      }

      /*
       * Clonamos para nÃ£o alterar
       * acidentalmente o objeto do banco.
       */
      payloadForAgent =
        structuredClone(
          payloadForAgent
        )

      payloadForAgent.options = {
        ...payloadForAgent.options,

        accessCode
      }

      // ==================================================
      // REMOVER SEGREDO DO COMANDO PERSISTIDO
      // ==================================================

      payloadForStorage =
        structuredClone(
          command.payload ||
          {}
        )

      if (
        payloadForStorage.options &&
        typeof payloadForStorage
          .options ===
          'object'
      ) {
        delete payloadForStorage
          .options
          .accessCode
      }
    }

    // ==================================================
    // MARCAR COMO RUNNING
    // ==================================================

    await query(
      `
        update agent_commands
        set
          status =
            'running',

          started_at =
            now(),

          payload =
            $2::jsonb

        where id = $1
      `,
      [
        command.id,

        JSON.stringify(
          payloadForStorage
        )
      ]
    )

    // ==================================================
    // ENVIAR PARA O AGENT
    // ==================================================

    return sendJson(
      res,
      200,
      {
        command: {
          id:
            String(
              command.id
            ),

          type:
            command.command,

          payload:
            payloadForAgent,

          status:
            'running',

          createdAt:
            command.created_at
        }
      }
    )
  }

// ======================================================
// REGISTRAR IMPRESSORA CONECTADA AO AGENT
// ======================================================

const registerConnectedAgentPrinter =
  async (
    agent,
    command
  ) => {
    if (
      !agent ||
      !command
    ) {
      return
    }

    if (
      command.command !==
      'connect_printer'
    ) {
      return
    }

    if (
      command.status !==
      'completed'
    ) {
      return
    }

    const result =
      command.result ||
      {}

    if (
      result.success ===
      false
    ) {
      return
    }

    const printer =
      result.printer ||
      command.payload
        ?.printer ||
      {}

    const connection =
      result.connection ||
      {}

    const connectionKey =
      String(
        connection.key ||
        ''
      ).trim()

    const protocol =
      String(
        printer.protocol ||
        ''
      )
        .trim()
        .toLowerCase()

    // ==================================================
    // SEGURANÃ‡A / CONSISTÃŠNCIA
    // ==================================================

    if (!connectionKey) {
      console.log(
        '[AgentPrinters] Conexao concluida sem connection_key.'
      )

      return
    }

    if (!protocol) {
      console.log(
        '[AgentPrinters] Conexao concluida sem protocolo.'
      )

      return
    }

    // ==================================================
    // NORMALIZAR DADOS
    // ==================================================

    const connectionType =
      String(
        printer.connectionType ||
        ''
      ).trim()

    const name =
      String(
        printer.name ||
        ''
      ).trim()

    const manufacturer =
      String(
        printer.manufacturer ||
        ''
      ).trim()

    const model =
      String(
        printer.model ||
        ''
      ).trim()

    const serial =
      String(
        printer.serial ||
        ''
      ).trim()

    const ip =
      String(
        printer.ip ||
        ''
      ).trim()

    const port =
      printer.port !==
        undefined &&
      printer.port !==
        null
        ? String(
            printer.port
          ).trim()
        : ''

    // ==================================================
    // METADATA NÃƒO SENSÃVEL
    // ==================================================
    //
    // Nunca colocar aqui:
    //
    // accessCode
    // password
    // token
    // secret
    //
    // ==================================================

    const metadata = {
      software:
        printer.software ||
        null,

      baudRate:
        printer.baudRate ||
        null,

      firmware:
        printer.firmware ||
        null,

      mock:
        printer.mock ===
        true,

      capabilities:
        connection.capabilities ||
        printer.capabilities ||
        {}
    }

    // ==================================================
    // UPSERT
    // ==================================================

    await tenantQuery(
      agent.tenant_id,
      `
        insert into agent_printers (
          tenant_id,
          agent_id,
          printer_id,
          connection_key,
          protocol,
          connection_type,
          name,
          manufacturer,
          model,
          serial,
          ip,
          port,
          status,
          last_error,
          metadata,
          connected_at,
          disconnected_at,
          last_seen_at,
          updated_at
        )
        values (
          $1,
          $2,
          null,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          'connected',
          '',
          $12::jsonb,
          now(),
          null,
          now(),
          now()
        )

        on conflict (
          tenant_id,
          agent_id,
          connection_key
        )

        do update set
          protocol =
            excluded.protocol,

          connection_type =
            excluded.connection_type,

          name =
            excluded.name,

          manufacturer =
            excluded.manufacturer,

          model =
            excluded.model,

          serial =
            excluded.serial,

          ip =
            excluded.ip,

          port =
            excluded.port,

          status =
            'connected',

          last_error =
            '',

          metadata =
            excluded.metadata,

          connected_at =
            now(),

          disconnected_at =
            null,

          last_seen_at =
            now(),

          updated_at =
            now()
      `,
      [
        agent.tenant_id,
        agent.id,
        connectionKey,
        protocol,
        connectionType,
        name,
        manufacturer,
        model,
        serial,
        ip,
        port,

        JSON.stringify(
          metadata
        )
      ]
    )

    console.log(
      `[AgentPrinters] Impressora registrada: ${connectionKey}`
    )
  }

  // ======================================================
// ATUALIZAR ESTADO DA IMPRESSORA REGISTRADA
// ======================================================

// ======================================================
// ATUALIZAR ESTADO DA IMPRESSORA REGISTRADA
// ======================================================

const updateAgentPrinterFromCommand =
  async (
    agent,
    command
  ) => {
    if (
      !agent ||
      !command
    ) {
      return
    }

    // ==================================================
    // SOMENTE COMANDOS RELACIONADOS Ã€ IMPRESSORA
    // ==================================================

    const supportedCommands =
      new Set([
        'printer_status',
        'start_print',
        'printer_pause',
        'printer_resume',
        'printer_cancel',
        'disconnect_printer'
      ])

    if (
      !supportedCommands.has(
        command.command
      )
    ) {
      return
    }

    // ==================================================
    // agentPrinterId
    // ==================================================

    const agentPrinterId =
      String(
        command.payload
          ?.agentPrinterId ||
        ''
      ).trim()

    if (
      !agentPrinterId
    ) {
      console.log(
        `[AgentPrinters] Comando ${command.command} sem agentPrinterId.`
      )

      return
    }

    // ==================================================
    // SUCESSO / FALHA
    // ==================================================

    const commandSucceeded =
      command.status ===
        'completed' &&
      command.result
        ?.success !==
        false

    const errorMessage =
      commandSucceeded
        ? ''
        : String(
            command.result
              ?.error ||
            'Falha ao comunicar com a impressora.'
          ).slice(
            0,
            1000
          )

    // ==================================================
    // CLASSIFICAR COMANDO
    // ==================================================

    const isStatusCommand =
      command.command ===
        'printer_status'

    const isDisconnectCommand =
      command.command ===
        'disconnect_printer'

    const isOperationCommand =
      [
        'start_print',
        'printer_pause',
        'printer_resume',
        'printer_cancel',
        'disconnect_printer'
      ].includes(
        command.command
      )

    // ==================================================
    // CLASSIFICAR ERRO
    // ==================================================
    //
    // printer_status:
    //   trata erro como problema de comunicaÃ§Ã£o.
    //
    // pause / resume / cancel:
    //   trata erro como problema operacional.
    //
    // Quando o comando correspondente tem sucesso,
    // errorMessage serÃ¡ '', limpando o erro anterior
    // daquele tipo.
    //
    // ==================================================

    const connectionError =
      isStatusCommand
        ? errorMessage
        : null

    const operationError =
      isOperationCommand
        ? errorMessage
        : null

    // ==================================================
    // ESTADO DA CONEXÃƒO
    // ==================================================
    //
    // Nem toda falha significa que a impressora
    // desconectou.
    //
    // printer_status falhou:
    //   podemos considerar perda de comunicaÃ§Ã£o.
    //
    // pause/resume/cancel falhou:
    //   mantÃ©m o estado atual da conexÃ£o.
    //
    // Qualquer comando bem-sucedido prova que houve
    // comunicaÃ§Ã£o com a impressora.
    //
    // ==================================================

    const shouldMarkDisconnected =
      (
        isStatusCommand &&
        !commandSucceeded
      ) ||
      (
        isDisconnectCommand &&
        commandSucceeded
      )

    const shouldMarkConnected =
      commandSucceeded &&
      !isDisconnectCommand

    const connectionStatus =
      shouldMarkConnected
        ? 'connected'
        : shouldMarkDisconnected
          ? 'disconnected'
          : null

    // ==================================================
    // TELEMETRIA
    // ==================================================
    //
    // Somente printer_status concluÃ­do com sucesso
    // pode atualizar last_status.
    //
    // Em caso de falha, mantemos a Ãºltima telemetria
    // conhecida.
    //
    // ==================================================

    const telemetry =
      isStatusCommand &&
      commandSucceeded &&
      command.result
        ?.status &&
      typeof command.result.status ===
        'object'
        ? command.result.status
        : null

    // ==================================================
    // ATUALIZAR agent_printers
    // ==================================================

    const result =
      await tenantQuery(
        agent.tenant_id,
        `
          update agent_printers

          set
            status =
              case
                when $1::text is not null
                  then $1
                else status
              end,

            last_error =
              $2,

            last_connection_error =
              case
                when $3::text is not null
                  then $3
                else last_connection_error
              end,

            last_operation_error =
              case
                when $4::text is not null
                  then $4
                else last_operation_error
              end,

            last_seen_at =
              case
                when $5::boolean = true
                  then now()
                else last_seen_at
              end,

            disconnected_at =
              case
                when $5::boolean = true
                  then null

                when $6::boolean = true
                  then now()

                else
                  disconnected_at
              end,

            last_status =
              case
                when $7::jsonb is not null
                  then $7::jsonb
                else last_status
              end,

            updated_at =
              now()

          where tenant_id = $8
            and agent_id = $9
            and id = $10

          returning
            id,
            connection_key,
            status,
            last_error,
            last_connection_error,
            last_operation_error,
            last_status,
            last_seen_at,
            disconnected_at
        `,
        [
          connectionStatus,

          errorMessage,

          connectionError,

          operationError,

          shouldMarkConnected,

          shouldMarkDisconnected,

          telemetry
            ? JSON.stringify(
                telemetry
              )
            : null,

          agent.tenant_id,

          agent.id,

          agentPrinterId
        ]
      )

    // ==================================================
    // REGISTRO ATUALIZADO
    // ==================================================

    const updatedPrinter =
      result
        .rows[0]

    if (
      !updatedPrinter
    ) {
      console.log(
        `[AgentPrinters] agentPrinterId ${agentPrinterId} nao encontrado para o Agent ${agent.id}.`
      )

      return
    }

    // ==================================================
    // LOG
    // ==================================================

    if (
      commandSucceeded
    ) {
      console.log(
        `[AgentPrinters] Comando ${command.command} concluido: ${updatedPrinter.connection_key}`
      )

      return
    }

    if (
      shouldMarkDisconnected
    ) {
      console.log(
        `[AgentPrinters] Impressora marcada como desconectada: ${updatedPrinter.connection_key} - ${errorMessage}`
      )

      return
    }

    console.log(
      `[AgentPrinters] Erro operacional em ${command.command}: ${updatedPrinter.connection_key} - ${errorMessage}`
    )
  }

// ======================================================
// ATUALIZAR FILA DE IMPRESSAO A PARTIR DO COMANDO
// ======================================================

const updatePrintJobFromCommand =
  async (
    agent,
    command
  ) => {
    if (
      !agent ||
      !command
    ) {
      return
    }

    const supportedCommands =
      new Set([
        'start_print',
        'printer_pause',
        'printer_resume',
        'printer_cancel'
      ])

    if (
      !supportedCommands.has(
        command.command
      )
    ) {
      return
    }

    const printJobId =
      String(
        command.payload
          ?.printJobId ||
        command.payload
          ?.job
          ?.id ||
        ''
      ).trim()

    const agentPrinterId =
      String(
        command.payload
          ?.agentPrinterId ||
        ''
      ).trim()

    if (
      command.command ===
        'start_print' &&
      !printJobId
    ) {
      return
    }

    const commandSucceeded =
      command.status ===
        'completed' &&
      command.result
        ?.success !==
        false

    if (
      command.command !==
      'start_print'
    ) {
      if (
        !agentPrinterId ||
        !commandSucceeded
      ) {
        return
      }

      const nextStatus =
        command.command ===
          'printer_pause'
          ? 'paused'
          : command.command ===
              'printer_resume'
            ? 'printing'
            : 'cancelled'

      await tenantQuery(
        agent.tenant_id,
        `
          update print_jobs
          set
            status = $3,
            completed_at =
              case
                when $3 = 'cancelled'
                  then completed_at
                else completed_at
              end,
            cancelled_at =
              case
                when $3 = 'cancelled'
                  then now()
                else cancelled_at
              end,
            updated_at = now()
          where tenant_id = $1
            and agent_printer_id = $2
            and status in ('starting', 'printing', 'paused')
        `,
        [
          agent.tenant_id,
          agentPrinterId,
          nextStatus
        ]
      )

      return
    }

    await tenantQuery(
      agent.tenant_id,
      `
        update print_jobs
        set
          status =
            case
              when $3::boolean = true
                then 'printing'
              when status = 'starting'
                then 'queued'
              else status
            end,

          started_at =
            case
              when $3::boolean = true
                then coalesce(started_at, now())
              else started_at
            end,

          notes =
            case
              when $3::boolean = false
                then concat_ws(
                  E'\\n',
                  nullif(notes, ''),
                  concat(
                    'Falha ao iniciar impressao: ',
                    left(
                      coalesce($4::text, 'Erro nao informado pelo Agent.'),
                      500
                    )
                  )
                )
              else notes
            end,

          updated_at = now()
        where tenant_id = $1
          and id = $2
      `,
      [
        agent.tenant_id,
        printJobId,
        commandSucceeded,
        command.result
          ?.error ||
          ''
      ]
    )
  }

// ======================================================
// AGENT BAIXA ARQUIVO DE IMPRESSAO
// ======================================================

export const handleAgentPrintFileGet =
  async (
    req,
    res,
    url
  ) => {
    const agent =
      await authenticateAgentRequest(
        req
      )

    if (!agent) {
      return sendJson(
        res,
        401,
        {
          error:
            'Agent invalido'
        }
      )
    }

    const storageKey =
      String(
        url.searchParams.get(
          'key'
        ) ||
        ''
      ).trim()

    if (!storageKey) {
      return sendJson(
        res,
        400,
        {
          error:
            'Chave do arquivo obrigatoria'
        }
      )
    }

    const fileResult =
      await tenantQuery(
        agent.tenant_id,
        `
          select
            id,
            print_file_name,
            print_file_format,
            print_file_hash,
            print_file_size_bytes,
            print_file_storage_key
          from products
          where tenant_id = $1
            and print_file_storage_key = $2
          limit 1
        `,
        [
          agent.tenant_id,
          storageKey
        ]
      )

    const product =
      fileResult
        .rows[0]

    if (!product) {
      return sendJson(
        res,
        404,
        {
          error:
            'Arquivo nao encontrado'
        }
      )
    }

    try {
      const file =
        await openPrintFileReadStream(
          storageKey
        )

      res.writeHead(
        200,
        {
          'Content-Type':
            'application/octet-stream',
          'Content-Length':
            String(
              file.sizeBytes
            ),
          'X-PrintFlow-File-Name':
            encodeURIComponent(
              product.print_file_name ||
              'print-file'
            ),
          'X-PrintFlow-File-Format':
            product.print_file_format ||
            '',
          'X-PrintFlow-File-Hash':
            product.print_file_hash ||
            '',
          'Access-Control-Allow-Origin':
            '*'
        }
      )

      file.stream.pipe(
        res
      )
    } catch (error) {
      return sendJson(
        res,
        404,
        {
          error:
            error.message ||
            'Arquivo nao encontrado'
        }
      )
    }
  }

// ======================================================
// AGENT FINALIZA COMANDO
// ======================================================

export const handleAgentCommandComplete =
  async (
    req,
    res,
    commandId
  ) => {
    const agentId =
      String(
        req.headers[
          'x-agent-id'
        ] ||
        ''
      ).trim()

    const agentSecret =
      String(
        req.headers[
          'x-agent-secret'
        ] ||
        ''
      ).trim()

    // ==================================================
    // VALIDAR CREDENCIAIS
    // ==================================================

    if (
      !agentId ||
      !agentSecret
    ) {
      return sendJson(
        res,
        401,
        {
          error:
            'Credenciais do Agent obrigatorias'
        }
      )
    }

    const secretHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          agentSecret
        )
        .digest(
          'hex'
        )

    // ==================================================
    // AUTENTICAR AGENT
    // ==================================================

    const agentResult =
      await query(
        `
          select
            id,
            tenant_id
          from agents
          where id = $1
            and secret_hash = $2
            and secret_hash is not null
            and status <> 'revoked'
          limit 1
        `,
        [
          agentId,
          secretHash
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        401,
        {
          error:
            'Agent invalido'
        }
      )
    }

    // ==================================================
    // LER RESULTADO
    // ==================================================

    const body =
      await readJsonBody(
        req
      )

    const success =
      body.success !==
      false

    const result =
      body.result ||
      {}

    const status =
      success
        ? 'completed'
        : 'failed'

    // ==================================================
    // FINALIZAR COMANDO
    // ==================================================
    //
    // TambÃ©m retornamos payload porque,
    // no caso do connect_printer,
    // precisamos dos dados nÃ£o sensÃ­veis
    // da impressora.
    //
    // O accessCode jÃ¡ foi removido do
    // payload quando o Agent buscou
    // o comando.
    // ==================================================

    const commandResult =
      await query(
        `
          update agent_commands

          set
            status = $1,

            result =
              $2::jsonb,

            completed_at =
              now()

          where id = $3
            and agent_id = $4
            and tenant_id = $5

          returning
            id,
            agent_id,
            command,
            payload,
            status,
            result,
            created_at,
            started_at,
            completed_at
        `,
        [
          status,

          JSON.stringify(
            result
          ),

          commandId,
          agent.id,
          agent.tenant_id
        ]
      )

    const command =
      commandResult
        .rows[0]

    if (!command) {
      return sendJson(
        res,
        404,
        {
          error:
            'Comando nao encontrado'
        }
      )
    }

    // ==================================================
    // REGISTRAR IMPRESSORA SOMENTE SE CONECTOU
    // ==================================================

    if (
      command.command ===
        'connect_printer' &&
      command.status ===
        'completed'
    ) {
      try {
        await registerConnectedAgentPrinter(
          agent,
          command
        )
      } catch (
        error
      ) {
        /*
         * A conexÃ£o da impressora jÃ¡ aconteceu.
         *
         * Uma falha ao registrar no banco nÃ£o deve
         * transformar o comando fÃ­sico em failed.
         *
         * Mas registramos o erro no servidor.
         */
        console.error(
          '[AgentPrinters] Falha ao registrar impressora conectada:',
          error
        )
      }
    }

// ======================================================
// ATUALIZAR ESTADO DA IMPRESSORA
// ======================================================

try {
  await updateAgentPrinterFromCommand(
    agent,
    command
  )
} catch (
  error
) {
  console.error(
    '[AgentPrinters] Falha ao atualizar estado da impressora:',
    error
  )
}

try {
  await updatePrintJobFromCommand(
    agent,
    command
  )
} catch (
  error
) {
  console.error(
    '[PrintJobs] Falha ao atualizar fila de impressao:',
    error
  )
}

    // ==================================================
    // RESPOSTA PARA O AGENT
    // ==================================================

    return sendJson(
      res,
      200,
      {
        command: {
          id:
            String(
              command.id
            ),

          type:
            command.command,

          status:
            command.status,

          result:
            command.result,

          completedAt:
            command.completed_at
        }
      }
    )
  }
// ======================================================
// FRONTEND CONSULTA RESULTADO DO COMANDO
// ======================================================

export const handleAgentCommandGet =
  async (
    req,
    res,
    commandId
  ) => {
    const user =
      await getAuthUser(
        req
      )

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Login necessario'
        }
      )
    }

    if (!commandId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Comando obrigatorio'
        }
      )
    }

    const result =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            agent_id,
            command,
            payload,
            status,
            result,
            created_at,
            started_at,
            completed_at
          from agent_commands
          where tenant_id = $1
            and id = $2
          limit 1
        `,
        [
          user.tenantId,
          commandId
        ]
      )

    const command =
      result.rows[0]

    if (!command) {
      return sendJson(
        res,
        404,
        {
          error:
            'Comando nao encontrado'
        }
      )
    }

    return sendJson(
      res,
      200,
      {
        command: {
          id:
            String(
              command.id
            ),

          agentId:
            String(
              command.agent_id
            ),

          type:
            command.command,

          /*
           * Nunca devolvemos o segredo
           * real para o FrontEnd.
           */
          payload:
            sanitizeCommandPayloadForUser(
              command.payload ||
              {}
            ),

          status:
            command.status,

          result:
            command.result ||
            null,

          createdAt:
            command.created_at,

          startedAt:
            command.started_at,

          completedAt:
            command.completed_at
        }
      }
    )
  }

// ======================================================
// CONECTAR IMPRESSORA
// ======================================================

export const handleAgentConnectPrinterCreate =
  async (
    req,
    res,
    agentId
  ) => {
    const user =
      await getAuthUser(
        req
      )

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Login necessario'
        }
      )
    }

    if (!agentId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Agent obrigatorio'
        }
      )
    }

    // ==================================================
    // CONFIRMAR AGENT DO TENANT
    // ==================================================

    const agentResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            machine_name
          from agents
          where tenant_id = $1
            and id = $2
          limit 1
        `,
        [
          user.tenantId,
          agentId
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        404,
        {
          error:
            'Agent nao encontrado'
        }
      )
    }

    // ==================================================
    // LER DADOS DA IMPRESSORA
    // ==================================================

    const body =
      await readJsonBody(
        req
      )

    const printer =
      body?.printer

    const options =
      body?.options ||
      {}

    if (!printer) {
      return sendJson(
        res,
        400,
        {
          error:
            'Dados da impressora obrigatorios'
        }
      )
    }

    const protocol =
      String(
        printer.protocol ||
        ''
      )
        .trim()
        .toLowerCase()

    if (!protocol) {
      return sendJson(
        res,
        400,
        {
          error:
            'Protocolo da impressora obrigatorio'
        }
      )
    }

    // ==================================================
    // PROTOCOLOS SUPORTADOS
    // ==================================================

    const supportedProtocols =
      new Set([
        'bambu',
        'moonraker',
        'octoprint',
        'prusalink',
        'marlin'
      ])

    if (
      !supportedProtocols.has(
        protocol
      )
    ) {
      return sendJson(
        res,
        400,
        {
          error:
            'Protocolo de impressora nao suportado'
        }
      )
    }

    // ==================================================
    // VALIDAÃ‡ÃƒO BAMBU
    // ==================================================

    if (
      protocol ===
      'bambu'
    ) {
      const isMockPrinter =
        printer.mock ===
        true

      if (
        !printer.ip
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              'IP da Bambu obrigatorio'
          }
        )
      }

      if (
        !printer.serial &&
        !isMockPrinter
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              'Serial da Bambu obrigatorio'
          }
        )
      }

      if (
        !options.accessCode &&
        !isMockPrinter
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              'LAN Access Code da Bambu obrigatorio'
          }
        )
      }
    }

    // ==================================================
    // CRIPTOGRAFAR SEGREDOS
    // ==================================================

    const safeOptions = {
      ...options
    }

    if (
      protocol ===
        'bambu' &&
      printer.mock !==
        true
    ) {
      const context =
        buildCommandSecretContext(
          user.tenantId,
          agent.id,
          'bambu-access-code'
        )

      /*
       * IMPORTANTE:
       *
       * accessCode puro existe somente
       * durante esta requisiÃ§Ã£o.
       *
       * O banco recebe exclusivamente
       * o objeto criptografado.
       */
      safeOptions.accessCode =
        encryptCommandSecret(
          options.accessCode,
          context
        )
    }

    // ==================================================
    // CRIAR PAYLOAD
    // ==================================================

    const payload = {
      printer: {
        ...printer,

        protocol
      },

      options:
        safeOptions
    }

    // ==================================================
    // CRIAR COMANDO
    // ==================================================

    const commandResult =
      await tenantQuery(
        user.tenantId,
        `
          insert into agent_commands (
            tenant_id,
            agent_id,
            command,
            payload,
            status
          )
          values (
            $1,
            $2,
            'connect_printer',
            $3::jsonb,
            'pending'
          )

          returning
            id,
            command,
            status,
            created_at
        `,
        [
          user.tenantId,
          agent.id,

          JSON.stringify(
            payload
          )
        ]
      )

    const command =
      commandResult
        .rows[0]

    return sendJson(
      res,
      201,
      {
        command: {
          id:
            String(
              command.id
            ),

          type:
            command.command,

          status:
            command.status,

          createdAt:
            command.created_at
        },

        agent: {
          id:
            String(
              agent.id
            ),

          machineName:
            agent.machine_name
        }
      }
    )
  }

// ======================================================
// CONSULTAR STATUS DA IMPRESSORA
// ======================================================

// ======================================================
// CONSULTAR STATUS DA IMPRESSORA
// ======================================================

export const handleAgentPrinterStatusCreate =
  async (
    req,
    res,
    agentId
  ) => {
    // ==================================================
    // AUTENTICAR USUÃRIO
    // ==================================================

    const user =
      await getAuthUser(
        req
      )

    if (!user) {
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
    // VALIDAR AGENT
    // ==================================================

    if (!agentId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Agent obrigatorio'
        }
      )
    }

    // ==================================================
    // CONFIRMAR QUE O AGENT PERTENCE AO TENANT
    // ==================================================

    const agentResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            machine_name

          from agents

          where tenant_id = $1
            and id = $2

          limit 1
        `,
        [
          user.tenantId,
          agentId
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        404,
        {
          error:
            'Agent nao encontrado'
        }
      )
    }

    // ==================================================
    // LER agentPrinterId
    // ==================================================

    const body =
      await readJsonBody(
        req
      )

    const agentPrinterId =
      String(
        body?.agentPrinterId ||
        ''
      ).trim()

    if (!agentPrinterId) {
      return sendJson(
        res,
        400,
        {
          error:
            'agentPrinterId obrigatorio'
        }
      )
    }

    // ==================================================
    // BUSCAR IMPRESSORA CONFIÃVEL NO BANCO
    // ==================================================

    const printerResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            agent_id,
            printer_id,
            connection_key,
            protocol,
            connection_type,
            name,
            manufacturer,
            model,
            serial,
            ip,
            port,
            status,
            metadata

          from agent_printers

          where tenant_id = $1
            and agent_id = $2
            and id = $3

          limit 1
        `,
        [
          user.tenantId,
          agent.id,
          agentPrinterId
        ]
      )

    const storedPrinter =
      printerResult
        .rows[0]

    if (!storedPrinter) {
      return sendJson(
        res,
        404,
        {
          error:
            'Impressora do Agent nao encontrada'
        }
      )
    }

    // ==================================================
    // MONTAR OBJETO CONFIÃVEL
    // ==================================================

    const printer = {
      protocol:
        storedPrinter.protocol,

      connectionType:
        storedPrinter.connection_type,

      name:
        storedPrinter.name,

      manufacturer:
        storedPrinter.manufacturer,

      model:
        storedPrinter.model,

      serial:
        storedPrinter.serial,

      ip:
        storedPrinter.ip,

      port:
        storedPrinter.port
          ? Number(
              storedPrinter.port
            )
          : undefined
    }

    // ==================================================
    // ADICIONAR METADATA NÃƒO SENSÃVEL
    // ==================================================

    if (
      storedPrinter.metadata &&
      typeof storedPrinter.metadata ===
        'object'
    ) {
      if (
        storedPrinter.metadata.software
      ) {
        printer.software =
          storedPrinter.metadata.software
      }

      if (
        storedPrinter.metadata.baudRate
      ) {
        printer.baudRate =
          Number(
            storedPrinter.metadata.baudRate
          )
      }

      if (
        storedPrinter.metadata.firmware
      ) {
        printer.firmware =
          storedPrinter.metadata.firmware
      }

      if (
        storedPrinter.metadata.mock ===
        true
      ) {
        printer.mock =
          true
      }
    }

    // ==================================================
    // CRIAR PAYLOAD DO COMANDO
    // ==================================================

    const payload = {
      agentPrinterId:
        String(
          storedPrinter.id
        ),

      connectionKey:
        storedPrinter.connection_key,

      printer
    }

    // ==================================================
    // CRIAR COMANDO
    // ==================================================

    const commandResult =
      await tenantQuery(
        user.tenantId,
        `
          insert into agent_commands (
            tenant_id,
            agent_id,
            command,
            payload,
            status
          )

          values (
            $1,
            $2,
            'printer_status',
            $3::jsonb,
            'pending'
          )

          returning
            id,
            command,
            status,
            created_at
        `,
        [
          user.tenantId,
          agent.id,

          JSON.stringify(
            payload
          )
        ]
      )

    const command =
      commandResult
        .rows[0]

    // ==================================================
    // RETORNO
    // ==================================================

    return sendJson(
      res,
      201,
      {
        command: {
          id:
            String(
              command.id
            ),

          type:
            command.command,

          status:
            command.status,

          createdAt:
            command.created_at
        },

        agent: {
          id:
            String(
              agent.id
            ),

          machineName:
            agent.machine_name
        },

        printer: {
          id:
            String(
              storedPrinter.id
            ),

          connectionKey:
            storedPrinter.connection_key,

          protocol:
            storedPrinter.protocol,

          name:
            storedPrinter.name
        }
      }
    )
  }

// ======================================================
// CONTROLE DA IMPRESSORA
// pause / resume / cancel / disconnect
// ======================================================

export const handleAgentPrinterControlCreate =
  async (
    req,
    res,
    agentId,
    action
  ) => {
    // ==================================================
    // AUTENTICAR USUÃRIO
    // ==================================================

    const user =
      await getAuthUser(
        req
      )

    if (!user) {
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
    // VALIDAR AGENT
    // ==================================================

    if (!agentId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Agent obrigatorio'
        }
      )
    }

    // ==================================================
    // AÃ‡Ã•ES PERMITIDAS
    // ==================================================

    const allowedActions =
      new Set([
        'start',
        'pause',
        'resume',
        'cancel',
        'disconnect'
      ])

    if (
      !allowedActions.has(
        action
      )
    ) {
      return sendJson(
        res,
        400,
        {
          error:
            'Acao de controle invalida'
        }
      )
    }

    // ==================================================
    // VALIDAR AGENT DO TENANT
    // ==================================================

    const agentResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            machine_name

          from agents

          where tenant_id = $1
            and id = $2

          limit 1
        `,
        [
          user.tenantId,
          agentId
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        404,
        {
          error:
            'Agent nao encontrado'
        }
      )
    }

    // ==================================================
    // LER agentPrinterId
    // ==================================================

    const body =
      await readJsonBody(
        req
      )

    const agentPrinterId =
      String(
        body?.agentPrinterId ||
        ''
      ).trim()

    const printJobId =
      String(
        body?.printJobId ||
        ''
      ).trim()

    if (!agentPrinterId) {
      return sendJson(
        res,
        400,
        {
          error:
            'agentPrinterId obrigatorio'
        }
      )
    }

    if (
      action ===
        'start' &&
      !printJobId
    ) {
      return sendJson(
        res,
        400,
        {
          error:
            'printJobId obrigatorio'
        }
      )
    }

    // ==================================================
    // BUSCAR IMPRESSORA CONFIÃVEL
    // ==================================================

    const printerResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            agent_id,
            printer_id,
            connection_key,
            protocol,
            connection_type,
            name,
            manufacturer,
            model,
            serial,
            ip,
            port,
            status,
            metadata

          from agent_printers

          where tenant_id = $1
            and agent_id = $2
            and id = $3

          limit 1
        `,
        [
          user.tenantId,
          agent.id,
          agentPrinterId
        ]
      )

    const storedPrinter =
      printerResult
        .rows[0]

    if (!storedPrinter) {
      return sendJson(
        res,
        404,
        {
          error:
            'Impressora do Agent nao encontrada'
        }
      )
    }

    let printJob =
      null

    if (
      action ===
      'start'
    ) {
      const jobResult =
        await tenantQuery(
          user.tenantId,
          `
            select
              j.id,
              j.order_id,
              o.external_id,
              j.product_id,
              coalesce(p.name, j.title) as product_name,
              j.printer_id,
              j.agent_printer_id,
              j.source,
              j.title,
              j.quantity,
              j.priority,
              j.status,
              j.notes,
              p.dimensions,
              p.weight,
              p.layer_height,
              p.infill,
              p.print_file_name,
              p.print_file_format,
              p.print_file_hash,
              p.print_file_size_bytes,
              p.print_file_storage_key,
              p.print_profile,
              p.compatibility,
              p.validation_status,
              p.validation_message,
              pr.volume as printer_volume,
              pr.agent_protocol as printer_protocol,
              pr.nozzle_mm as printer_nozzle_mm,
              pr.min_layer_height as printer_min_layer_height,
              pr.max_layer_height as printer_max_layer_height,
              f.material as filament_material

            from print_jobs j

            left join orders o
              on o.id = j.order_id
             and o.tenant_id = j.tenant_id

            left join products p
              on p.id = j.product_id
             and p.tenant_id = j.tenant_id

            left join printers pr
              on pr.id = j.printer_id
             and pr.tenant_id = j.tenant_id

            left join filaments f
              on f.id = p.filament_id
             and f.tenant_id = p.tenant_id

            where j.tenant_id = $1
              and j.id = $2
              and j.printer_id is not distinct from $3::bigint
              and j.agent_printer_id is not distinct from $4::bigint

            limit 1
          `,
          [
            user.tenantId,
            printJobId,
            storedPrinter.printer_id,
            storedPrinter.id
          ]
        )

      const storedJob =
        jobResult
          .rows[0]

      if (!storedJob) {
        return sendJson(
          res,
          404,
          {
            error:
              'Item da fila nao encontrado'
          }
        )
      }

      const validation =
        validatePrintCompatibility(
          {
            product: {
              ...storedJob,
              print_file_format:
                storedJob.print_file_format,
              validation_status:
                storedJob.validation_status,
              compatibility:
                storedJob.compatibility ||
                {},
              print_profile:
                storedJob.print_profile ||
                {}
            },

            printer: {
              ...storedPrinter,
              volume:
                storedJob.printer_volume,
              nozzle_mm:
                storedJob.printer_nozzle_mm,
              min_layer_height:
                storedJob.printer_min_layer_height,
              max_layer_height:
                storedJob.printer_max_layer_height,
              agent_protocol:
                storedJob.printer_protocol ||
                storedPrinter.protocol
            },

            filament: {
              material:
                storedJob.filament_material ||
                ''
            },

            job: {
              quantity:
                Number(
                  storedJob.quantity ??
                  0
                )
            }
          }
        )

      if (
        !validation.valid
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              validation.errors[0] ||
              'Produto incompativel com a impressora selecionada.',

            validation
          }
        )
      }

      printJob = {
        id:
          String(
            storedJob.id
          ),

        orderId:
          storedJob.order_id
            ? String(
                storedJob.order_id
              )
            : '',

        externalOrderId:
          storedJob.external_id ||
          '',

        productId:
          storedJob.product_id
            ? String(
                storedJob.product_id
              )
            : '',

        productName:
          storedJob.product_name ||
          '',

        printerId:
          storedJob.printer_id
            ? String(
                storedJob.printer_id
              )
            : '',

        agentPrinterId:
          storedJob.agent_printer_id
            ? String(
                storedJob.agent_printer_id
              )
            : '',

        source:
          storedJob.source ||
          'manual',

        title:
          storedJob.title ||
          storedJob.product_name ||
          '',

        quantity:
          Number(
            storedJob.quantity ??
            1
          ),

        priority:
          Number(
            storedJob.priority ||
            0
          ),

        status:
          storedJob.status ||
          'queued',

        notes:
          storedJob.notes ||
          '',

        printFile: {
          name:
            storedJob.print_file_name ||
            '',

          format:
            storedJob.print_file_format ||
            '',

          hash:
            storedJob.print_file_hash ||
            '',

          sizeBytes:
            Number(
              storedJob.print_file_size_bytes ||
              0
            ),

          storageKey:
            storedJob.print_file_storage_key ||
            ''
        },

        printProfile:
          storedJob.print_profile ||
          {},

        compatibility:
          storedJob.compatibility ||
          {},

        validationStatus:
          storedJob.validation_status ||
          'needs_validation',

        validationWarnings:
          validation.warnings ||
          ''
      }
    }

    // ==================================================
    // MONTAR OBJETO CONFIÃVEL
    // ==================================================

    const printer = {
      protocol:
        storedPrinter.protocol,

      connectionType:
        storedPrinter.connection_type,

      name:
        storedPrinter.name,

      manufacturer:
        storedPrinter.manufacturer,

      model:
        storedPrinter.model,

      serial:
        storedPrinter.serial,

      ip:
        storedPrinter.ip,

      port:
        storedPrinter.port
          ? Number(
              storedPrinter.port
            )
          : undefined
    }

    // ==================================================
    // METADATA NÃƒO SENSÃVEL
    // ==================================================

    if (
      storedPrinter.metadata &&
      typeof storedPrinter.metadata ===
        'object'
    ) {
      if (
        storedPrinter.metadata.software
      ) {
        printer.software =
          storedPrinter.metadata.software
      }

      if (
        storedPrinter.metadata.baudRate
      ) {
        printer.baudRate =
          Number(
            storedPrinter.metadata.baudRate
          )
      }

      if (
        storedPrinter.metadata.firmware
      ) {
        printer.firmware =
          storedPrinter.metadata.firmware
      }

      if (
        storedPrinter.metadata.mock ===
        true
      ) {
        printer.mock =
          true
      }
    }

    // ==================================================
    // DEFINIR COMANDO
    // ==================================================

    const commandType =
      action ===
        'disconnect'
        ? 'disconnect_printer'
        : action ===
            'start'
          ? 'start_print'
          : `printer_${action}`

    // ==================================================
    // PAYLOAD
    // ==================================================

    const payload = {
      agentPrinterId:
        String(
          storedPrinter.id
        ),

      connectionKey:
        storedPrinter.connection_key,

      printer,

      ...(printJob
        ? {
            printJobId:
              printJob.id,

            job:
              printJob
          }
        : {})
    }

    // ==================================================
    // CRIAR COMANDO
    // ==================================================

    let commandResult

    try {
      commandResult =
        await withTenant(
          user.tenantId,
          async (client) => {
            if (
              action ===
              'start'
            ) {
              const reserveResult =
                await client.query(
                  `
                    update print_jobs
                    set
                      status = 'starting',
                      started_at = coalesce(started_at, now()),
                      updated_at = now()
                    where tenant_id = $1
                      and id = $2
                      and printer_id is not distinct from $3::bigint
                      and agent_printer_id is not distinct from $4::bigint
                      and status = 'queued'
                      and not exists (
                        select 1
                        from print_jobs active
                        where active.tenant_id = print_jobs.tenant_id
                          and active.id <> print_jobs.id
                          and active.printer_id is not distinct from print_jobs.printer_id
                          and active.agent_printer_id is not distinct from print_jobs.agent_printer_id
                          and active.status in ('starting', 'printing', 'paused')
                      )
                    returning id
                  `,
                  [
                    user.tenantId,
                    printJobId,
                    storedPrinter.printer_id,
                    storedPrinter.id
                  ]
                )

              if (
                !reserveResult.rowCount
              ) {
                const error =
                  new Error(
                    'Esta impressora ja possui uma impressao em andamento ou este item nao esta mais na fila.'
                  )

                error.statusCode =
                  409

                throw error
              }
            }

            return client.query(
              `
                insert into agent_commands (
                  tenant_id,
                  agent_id,
                  command,
                  payload,
                  status
                )

                values (
                  $1,
                  $2,
                  $3,
                  $4::jsonb,
                  'pending'
                )

                returning
                  id,
                  command,
                  status,
                  created_at
              `,
              [
                user.tenantId,
                agent.id,
                commandType,

                JSON.stringify(
                  payload
                )
              ]
            )
          }
        )
    } catch (error) {
      if (
        error.statusCode ===
        409
      ) {
        return sendJson(
          res,
          409,
          {
            error:
              error.message
          }
        )
      }

      throw error
    }

    const command =
      commandResult
        .rows[0]

    // ==================================================
    // RETORNO
    // ==================================================

    return sendJson(
      res,
      201,
      {
        command: {
          id:
            String(
              command.id
            ),

          type:
            command.command,

          status:
            command.status,

          createdAt:
            command.created_at
        },

        agent: {
          id:
            String(
              agent.id
            ),

          machineName:
            agent.machine_name
        },

        printer: {
          id:
            String(
              storedPrinter.id
            ),

          connectionKey:
            storedPrinter.connection_key,

          protocol:
            storedPrinter.protocol,

          name:
            storedPrinter.name
        }
      }
    )
  }

// ======================================================
// LISTAR IMPRESSORAS REGISTRADAS DO AGENT
// ======================================================

export const handleAgentPrintersList =
  async (
    req,
    res,
    agentId
  ) => {
    // ==================================================
    // AUTENTICAR USUÃRIO
    // ==================================================

    const user =
      await getAuthUser(
        req
      )

    if (!user) {
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
    // VALIDAR AGENT
    // ==================================================

    if (!agentId) {
      return sendJson(
        res,
        400,
        {
          error:
            'Agent obrigatorio'
        }
      )
    }

    // ==================================================
    // CONFIRMAR QUE O AGENT PERTENCE AO TENANT
    // ==================================================

    const agentResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            machine_name,
            status,
            last_seen_at

          from agents

          where tenant_id = $1
            and id = $2

          limit 1
        `,
        [
          user.tenantId,
          agentId
        ]
      )

    const agent =
      agentResult
        .rows[0]

    if (!agent) {
      return sendJson(
        res,
        404,
        {
          error:
            'Agent nao encontrado'
        }
      )
    }

    // ==================================================
    // BUSCAR IMPRESSORAS DO AGENT
    // ==================================================

    const printerResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            agent_id,
            printer_id,
            connection_key,
            protocol,
            connection_type,
            name,
            manufacturer,
            model,
            serial,
            ip,
            port,
            status,
            last_error,
            last_connection_error,
            last_operation_error,
            metadata,
            last_status,
            connected_at,
            disconnected_at,
            last_seen_at,
            created_at,
            updated_at

          from agent_printers

          where tenant_id = $1
            and agent_id = $2

          order by
            created_at desc
        `,
        [
          user.tenantId,
          agent.id
        ]
      )

    // ==================================================
    // FORMATAR RESPOSTA
    // ==================================================

    const printers =
      printerResult
        .rows
        .map(
          printer => ({
            id:
              String(
                printer.id
              ),

            agentId:
              String(
                printer.agent_id
              ),

            printerId:
              printer.printer_id
                ? String(
                    printer.printer_id
                  )
                : null,

            connectionKey:
              printer.connection_key,

            protocol:
              printer.protocol,

            connectionType:
              printer.connection_type,

            name:
              printer.name,

            manufacturer:
              printer.manufacturer,

            model:
              printer.model,

            serial:
              printer.serial,

            ip:
              printer.ip,

            port:
              printer.port,

            status:
              printer.status,

            lastError:
              printer.last_error ||
              null,

            lastConnectionError:
              printer
                .last_connection_error ||
              null,

            lastOperationError:
              printer
                .last_operation_error ||
              null,

            metadata:
              printer.metadata ||
              {},

            lastStatus:
              printer.last_status ||
              {},

            connectedAt:
              printer.connected_at,

            disconnectedAt:
              printer.disconnected_at,

            lastSeenAt:
              printer.last_seen_at,

            createdAt:
              printer.created_at,

            updatedAt:
              printer.updated_at
          })
        )

    // ==================================================
    // RETORNO
    // ==================================================

    return sendJson(
      res,
      200,
      {
        agent: {
          id:
            String(
              agent.id
            ),

          machineName:
            agent.machine_name,

          status:
            agent.status,

          lastSeenAt:
            agent.last_seen_at
        },

        printers
      }
    )
  }
