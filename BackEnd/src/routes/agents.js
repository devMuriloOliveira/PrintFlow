import crypto from 'node:crypto'

import { query, tenantQuery } from '../db/pool.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { getAuthUser } from './auth.js'

// Evita caracteres fáceis de confundir, como 0/O e 1/I.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const randomPart = (length = 4) => {
  let value = ''

  for (let i = 0; i < length; i += 1) {
    const index = crypto.randomInt(0, alphabet.length)
    value += alphabet[index]
  }

  return value
}

const createPairingCode = () => {
  return `PF-${randomPart()}-${randomPart()}`
}

const hashPairingCode = (code) => {
  return crypto
    .createHash('sha256')
    .update(code)
    .digest('hex')
}


// ========================================
// GERAR CÓDIGO DE PAREAMENTO
// ========================================

export const handleAgentPairingCodeCreate = async (req, res) => {
  const user = await getAuthUser(req)

  if (!user) {
    return sendJson(res, 401, {
      error: 'Login necessario'
    })
  }

  const code = createPairingCode()

  const codeHash = hashPairingCode(code)

  // Código válido por 10 minutos.
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await tenantQuery(
    user.tenantId,
    `
      insert into agent_pairing_codes (
        tenant_id,
        code_hash,
        expires_at
      )
      values ($1, $2, $3)
    `,
    [
      user.tenantId,
      codeHash,
      expiresAt
    ]
  )

  return sendJson(res, 201, {
    code,
    expiresAt: expiresAt.toISOString()
  })
}


// ========================================
// PAREAR AGENT
// ========================================

export const handleAgentPair = async (req, res) => {
  const body = await readJsonBody(req)

  const code = String(body.code || '')
    .trim()
    .toUpperCase()

  const machineName = String(body.machineName || '').trim()
  const platform = String(body.platform || '').trim()
  const architecture = String(body.architecture || '').trim()
  const version = String(body.version || '').trim()

  if (!code) {
    return sendJson(res, 400, {
      error: 'Codigo de conexao obrigatorio'
    })
  }

  if (!machineName) {
    return sendJson(res, 400, {
      error: 'Nome do computador obrigatorio'
    })
  }

  const codeHash = hashPairingCode(code)

  // Procura o código de pareamento.
  // Aqui ainda não sabemos o tenant do Agent.
  const pairingResult = await query(
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
    [codeHash]
  )

  const pairing = pairingResult.rows[0]

  if (!pairing) {
    return sendJson(res, 400, {
      error: 'Codigo de conexao invalido'
    })
  }

  if (pairing.used_at) {
    return sendJson(res, 400, {
      error: 'Este codigo ja foi utilizado'
    })
  }

  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    return sendJson(res, 400, {
      error: 'Codigo de conexao expirado'
    })
  }

  // Cria uma credencial exclusiva para este Agent.
  const agentSecret =
    `pf_agent_${crypto.randomBytes(32).toString('hex')}`

  // Nunca salvamos o segredo puro no banco.
  const secretHash = crypto
    .createHash('sha256')
    .update(agentSecret)
    .digest('hex')

  const agentResult = await query(
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

      on conflict (tenant_id, machine_name)

      do update set
        platform = excluded.platform,
        architecture = excluded.architecture,
        agent_version = excluded.agent_version,
        secret_hash = excluded.secret_hash,
        status = 'online',
        last_seen_at = now(),
        updated_at = now()

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

  // Marca o código como usado para não poder ser reutilizado.
  await query(
    `
      update agent_pairing_codes
      set used_at = now()
      where id = $1
    `,
    [pairing.id]
  )

  const agent = agentResult.rows[0]

  return sendJson(res, 201, {
    agentId: String(agent.id),
    agentSecret,
    machineName: agent.machine_name
  })
}

export const handleAgentVerify = async (req, res) => {
  const agentId = String(req.headers['x-agent-id'] || '').trim()
  const agentSecret = String(req.headers['x-agent-secret'] || '').trim()

  if (!agentId || !agentSecret) {
    return sendJson(res, 401, {
      error: 'Credenciais do Agent obrigatorias'
    })
  }

  const secretHash = crypto
    .createHash('sha256')
    .update(agentSecret)
    .digest('hex')

  const result = await query(
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

  const agent = result.rows[0]

  if (!agent) {
    return sendJson(res, 401, {
      error: 'Agent invalido'
    })
  }

  await query(
    `
      update agents
      set
        status = 'online',
        last_seen_at = now(),
        updated_at = now()
      where id = $1
    `,
    [agent.id]
  )

  return sendJson(res, 200, {
    status: 'authenticated',

    agent: {
      id: String(agent.id),
      machineName: agent.machine_name,
      platform: agent.platform,
      architecture: agent.architecture,
      version: agent.agent_version
    }
  })
}

export const handleAgentHeartbeat = async (req, res) => {
  const agentId = String(req.headers['x-agent-id'] || '').trim()
  const agentSecret = String(req.headers['x-agent-secret'] || '').trim()

  if (!agentId || !agentSecret) {
    return sendJson(res, 401, {
      error: 'Credenciais do Agent obrigatorias'
    })
  }

  const secretHash = crypto
    .createHash('sha256')
    .update(agentSecret)
    .digest('hex')

  const result = await query(
    `
      update agents
      set
        status = 'online',
        last_seen_at = now(),
        updated_at = now()
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

  const agent = result.rows[0]

  if (!agent) {
    return sendJson(res, 401, {
      error: 'Agent invalido'
    })
  }

  return sendJson(res, 200, {
    status: 'online',
    lastSeenAt: agent.last_seen_at
  })
}

export const handleAgentsList = async (req, res) => {
  const user = await getAuthUser(req)

  if (!user) {
    return sendJson(res, 401, {
      error: 'Login necessario'
    })
  }

  const result = await tenantQuery(
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
      order by created_at desc
    `,
    [user.tenantId]
  )

  const agents = result.rows.map((agent) => ({
    id: String(agent.id),
    name: agent.name,
    machineName: agent.machine_name,
    platform: agent.platform,
    architecture: agent.architecture,
    version: agent.agent_version,
    status: agent.status,
    lastSeenAt: agent.last_seen_at,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at
  }))

  return sendJson(res, 200, {
    agents
  })
}

export const handleAgentDiscoverCreate = async (req, res, agentId) => {
  const user = await getAuthUser(req)

  if (!user) {
    return sendJson(res, 401, {
      error: 'Login necessario'
    })
  }

  if (!agentId) {
    return sendJson(res, 400, {
      error: 'Agent obrigatorio'
    })
  }

  // Primeiro confirma que este Agent pertence
  // ao tenant do usuário logado.
  const agentResult = await tenantQuery(
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

  const agent = agentResult.rows[0]

  if (!agent) {
    return sendJson(res, 404, {
      error: 'Agent nao encontrado'
    })
  }

  const commandResult = await tenantQuery(
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

  const command = commandResult.rows[0]

  return sendJson(res, 201, {
    command: {
      id: String(command.id),
      type: command.command,
      status: command.status,
      createdAt: command.created_at
    },

    agent: {
      id: String(agent.id),
      machineName: agent.machine_name
    }
  })
}

export const handleAgentCommandsPending = async (req, res) => {
  const agentId = String(req.headers['x-agent-id'] || '').trim()
  const agentSecret = String(req.headers['x-agent-secret'] || '').trim()

  if (!agentId || !agentSecret) {
    return sendJson(res, 401, {
      error: 'Credenciais do Agent obrigatorias'
    })
  }

  const secretHash = crypto
    .createHash('sha256')
    .update(agentSecret)
    .digest('hex')

  const agentResult = await query(
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

  const agent = agentResult.rows[0]

  if (!agent) {
    return sendJson(res, 401, {
      error: 'Agent invalido'
    })
  }

  const commandResult = await query(
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
      order by created_at asc
      limit 1
    `,
    [
      agent.id,
      agent.tenant_id
    ]
  )

  const command = commandResult.rows[0]

  if (!command) {
    return sendJson(res, 200, {
      command: null
    })
  }

  await query(
    `
      update agent_commands
      set
        status = 'running',
        started_at = now()
      where id = $1
    `,
    [command.id]
  )

  return sendJson(res, 200, {
    command: {
      id: String(command.id),
      type: command.command,
      payload: command.payload || {},
      status: 'running',
      createdAt: command.created_at
    }
  })
}

export const handleAgentCommandComplete = async (req, res, commandId) => {
  const agentId = String(req.headers['x-agent-id'] || '').trim()
  const agentSecret = String(req.headers['x-agent-secret'] || '').trim()

  if (!agentId || !agentSecret) {
    return sendJson(res, 401, {
      error: 'Credenciais do Agent obrigatorias'
    })
  }

  const secretHash = crypto
    .createHash('sha256')
    .update(agentSecret)
    .digest('hex')

  const agentResult = await query(
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

  const agent = agentResult.rows[0]

  if (!agent) {
    return sendJson(res, 401, {
      error: 'Agent invalido'
    })
  }

  const body = await readJsonBody(req)

    const success = body.success !== false
    const result = body.result || {}

  const status= success 
  ? 'completed' 
  : 'failed'

  const commandResult = await query(
  `
    update agent_commands
    set
      status = $1,
      result = $2::jsonb,
      completed_at = now()
    where id = $3
      and agent_id = $4
      and tenant_id = $5
    returning
      id,
      command,
      status,
      result,
      completed_at
  `,
  [
    status,
    JSON.stringify(result),
    commandId,
    agent.id,
    agent.tenant_id
  ]
)
  const command = commandResult.rows[0]

  if (!command) {
    return sendJson(res, 404, {
      error: 'Comando nao encontrado'
    })
  }

  return sendJson(res, 200, {
    command: {
      id: String(command.id),
      type: command.command,
      status: command.status,
      result: command.result,
      completedAt: command.completed_at
    }
  })
}

export const handleAgentCommandGet = async (
  req,
  res,
  commandId
) => {
  const user = await getAuthUser(req)

  if (!user) {
    return sendJson(
      res,
      401,
      {
        error: 'Login necessario'
      }
    )
  }

  if (!commandId) {
    return sendJson(
      res,
      400,
      {
        error: 'Comando obrigatorio'
      }
    )
  }

  const result = await tenantQuery(
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
        error: 'Comando nao encontrado'
      }
    )
  }

  return sendJson(
    res,
    200,
    {
      command: {
        id:
          String(command.id),

        agentId:
          String(command.agent_id),

        type:
          command.command,

        payload:
          command.payload || {},

        status:
          command.status,

        result:
          command.result || null,

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

export const handleAgentConnectPrinterCreate = async (
  req,
  res,
  agentId
) => {
  const user = await getAuthUser(req)

  if (!user) {
    return sendJson(
      res,
      401,
      {
        error: 'Login necessario'
      }
    )
  }

  if (!agentId) {
    return sendJson(
      res,
      400,
      {
        error: 'Agent obrigatorio'
      }
    )
  }

  // =====================================================
  // CONFIRMAR QUE O AGENT PERTENCE AO TENANT
  // =====================================================

  const agentResult = await tenantQuery(
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
    agentResult.rows[0]

  if (!agent) {
    return sendJson(
      res,
      404,
      {
        error: 'Agent nao encontrado'
      }
    )
  }

  // =====================================================
  // LER DADOS DA IMPRESSORA
  // =====================================================

  const body =
    await readJsonBody(req)

  const printer =
    body?.printer

  const options =
    body?.options || {}

  if (!printer) {
    return sendJson(
      res,
      400,
      {
        error: 'Dados da impressora obrigatorios'
      }
    )
  }

  const protocol =
    String(
      printer.protocol || ''
    )
      .trim()
      .toLowerCase()

  if (!protocol) {
    return sendJson(
      res,
      400,
      {
        error: 'Protocolo da impressora obrigatorio'
      }
    )
  }

  // =====================================================
  // PROTOCOLOS ACEITOS
  // =====================================================

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

  // =====================================================
  // VALIDAÇÃO ESPECÍFICA BAMBU
  // =====================================================

  if (protocol === 'bambu') {
    if (!printer.ip) {
      return sendJson(
        res,
        400,
        {
          error:
            'IP da Bambu obrigatorio'
        }
      )
    }

    if (!printer.serial) {
      return sendJson(
        res,
        400,
        {
          error:
            'Serial da Bambu obrigatorio'
        }
      )
    }

    if (!options.accessCode) {
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

  // =====================================================
  // CRIAR COMANDO
  // =====================================================

  const payload = {
    printer: {
      ...printer,
      protocol
    },

    options
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
    commandResult.rows[0]

  return sendJson(
    res,
    201,
    {
      command: {
        id:
          String(command.id),

        type:
          command.command,

        status:
          command.status,

        createdAt:
          command.created_at
      },

      agent: {
        id:
          String(agent.id),

        machineName:
          agent.machine_name
      }
    }
  )
}