import crypto from 'node:crypto'

import {
  query,
  tenantQuery
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

// ======================================================
// CONFIGURAÇÕES
// ======================================================

// Evita caracteres fáceis de confundir,
// como 0/O e 1/I.
const alphabet =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// ======================================================
// CÓDIGO DE PAREAMENTO
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
// PROTEÇÃO DE SEGREDOS DOS COMANDOS
// ======================================================
//
// DATA_ENCRYPTION_KEY fica somente no BackEnd.
//
// O LAN Access Code da Bambu:
//
// FrontEnd
//   ↓
// BackEnd recebe em texto
//   ↓
// AES-256-GCM
//   ↓
// banco recebe somente ciphertext
//   ↓
// Agent autenticado busca comando
//   ↓
// BackEnd descriptografa em memória
//   ↓
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
   * 12 bytes é o tamanho recomendado
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
   * O usuário não precisa receber
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
// GERAR CÓDIGO DE PAREAMENTO
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

    // Código válido por 10 minutos.
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
     * Aqui ainda não sabemos
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
            machine_name
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
     * Código de pareamento é
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

            last_seen_at =
              now(),

            updated_at =
              now()

          where id = $1
            and secret_hash = $2

          returning
            id,
            machine_name,
            last_seen_at
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
// BUSCAR PRÓXIMO COMANDO DO AGENT
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
         * Compatibilidade temporária
         * com comandos antigos que
         * possam ter sido salvos antes
         * desta implementação.
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
       * Clonamos para não alterar
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
    // SEGURANÇA / CONSISTÊNCIA
    // ==================================================

    if (!connectionKey) {
      console.log(
        '[AgentPrinters] Conexão concluída sem connection_key.'
      )

      return
    }

    if (!protocol) {
      console.log(
        '[AgentPrinters] Conexão concluída sem protocolo.'
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
    // METADATA NÃO SENSÍVEL
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

      mock:
        printer.mock ===
        true
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
      `[AgentPrinters] ✅ Impressora registrada: ${connectionKey}`
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
    // SOMENTE COMANDOS RELACIONADOS À IMPRESSORA
    // ==================================================

    const supportedCommands =
      new Set([
        'printer_status',
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

    const isOperationCommand =
      [
        'printer_pause',
        'printer_resume',
        'printer_cancel'
      ].includes(
        command.command
      )

    // ==================================================
    // CLASSIFICAR ERRO
    // ==================================================
    //
    // printer_status:
    //   trata erro como problema de comunicação.
    //
    // pause / resume / cancel:
    //   trata erro como problema operacional.
    //
    // Quando o comando correspondente tem sucesso,
    // errorMessage será '', limpando o erro anterior
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
    // ESTADO DA CONEXÃO
    // ==================================================
    //
    // Nem toda falha significa que a impressora
    // desconectou.
    //
    // printer_status falhou:
    //   podemos considerar perda de comunicação.
    //
    // pause/resume/cancel falhou:
    //   mantém o estado atual da conexão.
    //
    // Qualquer comando bem-sucedido prova que houve
    // comunicação com a impressora.
    //
    // ==================================================

    const shouldMarkDisconnected =
      isStatusCommand &&
      !commandSucceeded

    const shouldMarkConnected =
      commandSucceeded

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
    // Somente printer_status concluído com sucesso
    // pode atualizar last_status.
    //
    // Em caso de falha, mantemos a última telemetria
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

          commandSucceeded,

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
        `[AgentPrinters] agentPrinterId ${agentPrinterId} não encontrado para o Agent ${agent.id}.`
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
        `[AgentPrinters] ✅ Comando ${command.command} concluído: ${updatedPrinter.connection_key}`
      )

      return
    }

    if (
      shouldMarkDisconnected
    ) {
      console.log(
        `[AgentPrinters] ⚠ Impressora marcada como desconectada: ${updatedPrinter.connection_key} - ${errorMessage}`
      )

      return
    }

    console.log(
      `[AgentPrinters] ⚠ Erro operacional em ${command.command}: ${updatedPrinter.connection_key} - ${errorMessage}`
    )
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
    // Também retornamos payload porque,
    // no caso do connect_printer,
    // precisamos dos dados não sensíveis
    // da impressora.
    //
    // O accessCode já foi removido do
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
         * A conexão da impressora já aconteceu.
         *
         * Uma falha ao registrar no banco não deve
         * transformar o comando físico em failed.
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
    // VALIDAÇÃO BAMBU
    // ==================================================

    if (
      protocol ===
      'bambu'
    ) {
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
        !printer.serial
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
        !options.accessCode
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
      'bambu'
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
       * durante esta requisição.
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
    // AUTENTICAR USUÁRIO
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
    // BUSCAR IMPRESSORA CONFIÁVEL NO BANCO
    // ==================================================

    const printerResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            agent_id,
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
    // MONTAR OBJETO CONFIÁVEL
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
    // ADICIONAR METADATA NÃO SENSÍVEL
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
// pause / resume / cancel
// ======================================================

export const handleAgentPrinterControlCreate =
  async (
    req,
    res,
    agentId,
    action
  ) => {
    // ==================================================
    // AUTENTICAR USUÁRIO
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
    // AÇÕES PERMITIDAS
    // ==================================================

    const allowedActions =
      new Set([
        'pause',
        'resume',
        'cancel'
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
    // BUSCAR IMPRESSORA CONFIÁVEL
    // ==================================================

    const printerResult =
      await tenantQuery(
        user.tenantId,
        `
          select
            id,
            agent_id,
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
    // MONTAR OBJETO CONFIÁVEL
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
    // METADATA NÃO SENSÍVEL
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
      `printer_${action}`

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
    // AUTENTICAR USUÁRIO
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