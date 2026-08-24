<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
  watchEffect
} from 'vue'

import { navigateTo } from '#app'

const {
  printers,
  filaments,
  createItem,
  updateItem
} = useAppData()

const { notify } = useUi()

const route = useRoute()
const config = useRuntimeConfig()
const defaultAgentWindowsDownloadUrl =
  '/downloads/PrintFlow-Agent-Setup.exe'

const agentWindowsDownloadUrl =
  computed(() =>
    String(
      config.public.agentWindowsDownloadUrl ||
        defaultAgentWindowsDownloadUrl
    ).trim()
  )

const downloadAgentWindows = () => {
  if (!agentWindowsDownloadUrl.value) {
    notify(
      'Link de download do Agent ainda nao configurado. Configure NUXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL.',
      'info'
    )

    return
  }

  window.open(
    agentWindowsDownloadUrl.value,
    '_blank',
    'noopener'
  )

  agentOpenMessage.value =
    'Download iniciado. Execute o instalador e, quando o Agent abrir, ele ficara disponivel para conectar por esta tela.'
}

// ======================================================
// PRINTFLOW AGENT
// ======================================================

const agentLoading = ref(false)
const pairingLoading = ref(false)
const openingAgent = ref(false)

const discoveringAgentId =
  ref<string | null>(null)

const discoveryAgentId =
  ref<string | null>(null)

const connectingPrinterKey =
  ref<string | null>(null)

const printerStatusLoadingKey =
  ref<string | null>(null)

const printerControlLoadingKey =
  ref<string | null>(null)

const discoveryStatus = ref<
  'idle' |
  'pending' |
  'running' |
  'completed' |
  'failed'
>('idle')

const discoveredPrinters =
  ref<any[]>([])

const discoveryMessage =
  ref('')

const agentOpenMessage =
  ref('')

const printerStatuses =
  reactive<Record<string, any>>({})

const agents =
  ref<any[]>([])

const pairingCode =
  ref('')

const pairingExpiresAt =
  ref('')

const connectionMode =
  ref<'agent' | 'manual'>(
    'agent'
  )

const onlineAgents =
  computed(() =>
    agents.value.filter(
      agent =>
        agentIsOnline(
          agent
        )
    )
  )

// ======================================================
// OPCOES DE CONEXAO POR IMPRESSORA
// ======================================================

const printerConnectionOptions =
  reactive<
    Record<
      string,
      {
        serial: string
        accessCode: string
        apiKey: string
        username: string
        password: string
      }
    >
  >({})

const getPrinterKey = (
  printer: any
) => {
  return [
    printer.connectionType ||
      'unknown',

    printer.ip ||
      printer.port ||
      'unknown',

    printer.protocol ||
      'unknown'
  ].join(':')
}

const getPrinterConnectionOptions = (
  printer: any
) => {
  const key =
    getPrinterKey(
      printer
    )

  if (
    !printerConnectionOptions[key]
  ) {
    printerConnectionOptions[key] = {
      serial: '',
      accessCode: '',
      apiKey: '',
      username:
        printer.protocol ===
        'prusalink'
          ? 'maker'
          : '',
      password: ''
    }
  }

  return printerConnectionOptions[key]
}

// ======================================================
// CARREGAR AGENTS
// ======================================================

const loadAgents = async () => {
  agentLoading.value =
    true

  try {
    const token =
      localStorage.getItem(
        'printflow-auth-token'
      )

    if (!token) {
      throw new Error(
        'Sessão não encontrada.'
      )
    }

    const response =
      await fetch(
        `${config.public.apiBase}/api/agents`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      )

    const data =
      await response.json()

    if (!response.ok) {
      throw new Error(
        data?.error ||
        'Não foi possível carregar os Agents.'
      )
    }

    agents.value =
      data.agents || []
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : 'Não foi possível carregar os Agents.',
      'info'
    )
  } finally {
    agentLoading.value =
      false
  }
}

// ======================================================
// GERAR CÓDIGO DE PAREAMENTO
// ======================================================

const generatePairingCode =
  async () => {
    pairingLoading.value =
      true

    try {
      const token =
        localStorage.getItem(
          'printflow-auth-token'
        )

      if (!token) {
        throw new Error(
          'Sessão não encontrada.'
        )
      }

      const response =
        await fetch(
          `${config.public.apiBase}/api/agents/pairing-code`,
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json'
            }
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ||
          'Não foi possível gerar o código.'
        )
      }

      pairingCode.value =
        data.code

      pairingExpiresAt.value =
        data.expiresAt

      return data.code
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível gerar o código.',
        'info'
      )
    } finally {
      pairingLoading.value =
        false
    }
  }

// ======================================================
// AGENT ONLINE
// ======================================================

const agentIsOnline = (
  agent: any
) => {
  if (
    !agent?.lastSeenAt
  ) {
    return false
  }

  const lastSeen =
    new Date(
      agent.lastSeenAt
    ).getTime()

  return (
    Date.now() -
      lastSeen <
    90_000
  )
}

// ======================================================
// FORMATAR ÚLTIMO CONTATO
// ======================================================

const formatLastSeen = (
  value: string | null
) => {
  if (!value) {
    return 'Nunca'
  }

  const time =
    new Date(
      value
    ).getTime()

  const difference =
    Date.now() -
    time

  if (
    difference <
    60_000
  ) {
    return 'Agora'
  }

  const minutes =
    Math.floor(
      difference /
      60_000
    )

  if (
    minutes <
    60
  ) {
    return `Há ${minutes} min`
  }

  const hours =
    Math.floor(
      minutes /
      60
    )

  if (
    hours <
    24
  ) {
    return `Há ${hours}h`
  }

  return new Date(
    value
  ).toLocaleString(
    'pt-BR'
  )
}

// ======================================================
// ABRIR AGENT INSTALADO
// ======================================================

const openInstalledAgent =
  async () => {
    if (
      openingAgent.value
    ) {
      return
    }

    openingAgent.value =
      true

    agentOpenMessage.value =
      'Preparando conexao automatica com o PrintFlow Agent...'

    try {
      if (
        !pairingCode.value
      ) {
        await generatePairingCode()
      }

      if (
        !pairingCode.value
      ) {
        agentOpenMessage.value =
          'Nao foi possivel preparar a conexao automatica. Tente novamente.'

        return
      }

      const protocolUrl =
        `printflow-agent://pair?code=${encodeURIComponent(pairingCode.value)}`

      window.location.href =
        protocolUrl

      agentOpenMessage.value =
        'Solicitacao enviada ao Windows. Se o navegador pedir permissao, confirme para abrir o PrintFlow Agent.'

      for (
        let attempt = 0;
        attempt < 6;
        attempt++
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              5000
            )
        )

        await loadAgents()

        if (
          onlineAgents.value.length >
          0
        ) {
          agentOpenMessage.value =
            'PrintFlow Agent aberto e conectado.'

          return
        }
      }

      agentOpenMessage.value =
        'Ainda nao recebemos contato do Agent. Se ele nao abrir, use o atalho PrintFlow Agent no Windows.'
    } finally {
      openingAgent.value =
        false
    }
  }

// ======================================================
// VALIDADE DO CÓDIGO
// ======================================================

const formatPairingExpiration =
  computed(() => {
    if (
      !pairingExpiresAt.value
    ) {
      return ''
    }

    return new Date(
      pairingExpiresAt.value
    ).toLocaleTimeString(
      'pt-BR',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    )
  })

// ======================================================
// ESPERAR RESULTADO DE COMANDO
// ======================================================

const waitForCommandResult =
  async (
    commandId: string
  ) => {
    const token =
      localStorage.getItem(
        'printflow-auth-token'
      )

    if (!token) {
      throw new Error(
        'Sessão não encontrada.'
      )
    }

    const maxAttempts =
      40

    const intervalMs =
      1000

    for (
      let attempt = 0;
      attempt < maxAttempts;
      attempt++
    ) {
      const response =
        await fetch(
          `${config.public.apiBase}/api/agent-commands/${commandId}`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ||
          'Não foi possível consultar o resultado do comando.'
        )
      }

      const command =
        data.command

      if (
        command.status ===
        'completed'
      ) {
        return command.result
      }

      if (
        command.status ===
        'failed'
      ) {
        throw new Error(
          command.result?.error ||
          'O comando falhou.'
        )
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            intervalMs
          )
      )
    }

    throw new Error(
      'A operação demorou mais que o esperado.'
    )
  }

  // ======================================================
// LOCALIZAR IMPRESSORA REGISTRADA NO AGENT
// ======================================================

// ======================================================
// LOCALIZAR IMPRESSORA REGISTRADA NO AGENT
// ======================================================

const findRegisteredAgentPrinter =
  async (
    agent: any,
    printer: any
  ) => {
    // ==================================================
    // TOKEN
    // ==================================================

    const token =
      localStorage.getItem(
        'printflow-auth-token'
      )

    if (!token) {
      throw new Error(
        'Sessão não encontrada.'
      )
    }

    // ==================================================
    // SERIAL
    // ==================================================

    let serial =
      String(
        printer.serial ||
        ''
      ).trim()

    // ==================================================
    // BAMBU
    // ==================================================
    //
    // Durante a descoberta, o objeto da Bambu pode
    // não possuir o serial.
    //
    // Nesse caso usamos o serial informado pelo
    // usuário no formulário de conexão.
    //
    // ==================================================

    if (
      printer.protocol ===
      'bambu'
    ) {
      const credentials =
        getPrinterConnectionOptions(
          printer
        )

      const enteredSerial =
        String(
          credentials.serial ||
          ''
        ).trim()

      if (
        enteredSerial
      ) {
        serial =
          enteredSerial
      }

      if (
        !serial
      ) {
        throw new Error(
          'Informe o número de série da Bambu.'
        )
      }
    }

    // ==================================================
    // BUSCAR IMPRESSORAS REGISTRADAS
    // ==================================================

    const response =
      await fetch(
        `${config.public.apiBase}/api/agents/${agent.id}/printers`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      )

    const data =
      await response.json()

    if (
      !response.ok
    ) {
      throw new Error(
        data?.error ||
        'Não foi possível localizar as impressoras registradas.'
      )
    }

    const registeredPrinters =
      Array.isArray(
        data?.printers
      )
        ? data.printers
        : []

    // ==================================================
    // NORMALIZAR IDENTIFICADORES
    // ==================================================

    const protocol =
      String(
        printer.protocol ||
        ''
      )
        .trim()
        .toLowerCase()

    const connectionType =
      String(
        printer.connectionType ||
        ''
      )
        .trim()
        .toLowerCase()

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
    // LOCALIZAR REGISTRO
    // ==================================================

    const registeredPrinter =
      registeredPrinters.find(
        (item: any) => {
          const itemProtocol =
            String(
              item.protocol ||
              ''
            )
              .trim()
              .toLowerCase()

          if (
            itemProtocol !==
            protocol
          ) {
            return false
          }

          // ==============================================
          // BAMBU
          // ==============================================

          if (
            protocol ===
            'bambu'
          ) {
            const itemSerial =
              String(
                item.serial ||
                ''
              )
                .trim()
                .toLowerCase()

            const targetSerial =
              String(
                serial ||
                ''
              )
                .trim()
                .toLowerCase()

            return (
              itemSerial ===
              targetSerial
            )
          }

          // ==============================================
          // USB / MARLIN
          // ==============================================

          if (
            connectionType ===
            'usb'
          ) {
            return (
              String(
                item.port ||
                ''
              ).trim() ===
              port
            )
          }

          // ==============================================
          // REDE
          // ==============================================

          return (
            String(
              item.ip ||
              ''
            ).trim() ===
              ip &&
            (
              !port ||
              String(
                item.port ||
                ''
              ).trim() ===
                port
            )
          )
        }
      )

    // ==================================================
    // NÃO ENCONTRADA
    // ==================================================

    if (
      !registeredPrinter
    ) {
      throw new Error(
        'Esta impressora ainda não está registrada como conectada ao PrintFlow Agent. Conecte a impressora primeiro.'
      )
    }

    // ==================================================
    // ID TÉCNICO DA IMPRESSORA
    // ==================================================

    const agentPrinterId =
      String(
        registeredPrinter.id ||
        ''
      ).trim()

    if (
      !agentPrinterId
    ) {
      throw new Error(
        'Identificação da impressora conectada não encontrada.'
      )
    }

    // ==================================================
    // CHAVE LOCAL DA INTERFACE
    // ==================================================

    const key =
      getPrinterKey(
        printer
      )

    // ==================================================
    // ÚLTIMA TELEMETRIA CONHECIDA
    // ==================================================

    const lastStatus =
      registeredPrinter
        ?.lastStatus

    // ==================================================
    // ERROS CONHECIDOS
    // ==================================================

    const lastConnectionError =
      registeredPrinter
        ?.lastConnectionError ||
      null

    const lastOperationError =
      registeredPrinter
        ?.lastOperationError ||
      null

    // ==================================================
    // CARREGAR ESTADO NO FRONTEND
    // ==================================================
    //
    // Mesmo que ainda não exista telemetria, mantemos
    // os erros conhecidos.
    //
    // Dessa forma podemos mostrar:
    //
    // - problema de conexão
    // - erro operacional
    //
    // separadamente.
    //
    // ==================================================

    if (
      lastStatus &&
      typeof lastStatus ===
        'object' &&
      !Array.isArray(
        lastStatus
      ) &&
      Object.keys(
        lastStatus
      ).length >
        0
    ) {
      printerStatuses[key] = {
        ...lastStatus,

        lastConnectionError,

        lastOperationError
      }
    } else {
      printerStatuses[key] = {
        lastConnectionError,

        lastOperationError
      }
    }

    // ==================================================
    // RETORNO
    // ==================================================

    return {
      agentPrinterId,
      registeredPrinter
    }
  }

// ======================================================
// PROCURAR IMPRESSORAS
// ======================================================

const discoverPrinters =
  async (
    agent: any
  ) => {
    if (
      !agentIsOnline(
        agent
      )
    ) {
      notify(
        'Este Agent está offline. Inicie o PrintFlow Agent antes de procurar impressoras.',
        'info'
      )

      return
    }

    if (
      discoveringAgentId.value
    ) {
      return
    }

    discoveringAgentId.value =
      String(
        agent.id
      )

    discoveryAgentId.value =
      String(
        agent.id
      )

    discoveryStatus.value =
      'pending'

    discoveredPrinters.value =
      []

    discoveryMessage.value =
      'Enviando comando para o PrintFlow Agent...'

    try {
      const token =
        localStorage.getItem(
          'printflow-auth-token'
        )

      if (!token) {
        throw new Error(
          'Sessão não encontrada.'
        )
      }

      const response =
        await fetch(
          `${config.public.apiBase}/api/agents/${agent.id}/discover`,
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json'
            }
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ||
          'Não foi possível iniciar a busca.'
        )
      }

      const commandId =
        String(
          data.command.id
        )

      discoveryStatus.value =
        'running'

      discoveryMessage.value =
        'O Agent está procurando impressoras...'

      const result =
        await waitForCommandResult(
          commandId
        )

      const found =
        Array.isArray(
          result?.printers
        )
          ? result.printers
          : []

      discoveredPrinters.value =
        found

      discoveryStatus.value =
        'completed'

      if (
        found.length ===
        0
      ) {
        discoveryMessage.value =
          'Nenhuma impressora foi encontrada.'
      } else {
        discoveryMessage.value =
          `${found.length} impressora(s) encontrada(s).`
      }
    } catch (error) {
      discoveryStatus.value =
        'failed'

      discoveryMessage.value =
        error instanceof Error
          ? error.message
          : 'Não foi possível procurar impressoras.'

      notify(
        discoveryMessage.value,
        'info'
      )
    } finally {
      discoveringAgentId.value =
        null
    }
  }

// ======================================================
// CONECTAR IMPRESSORA
// ======================================================

const connectDiscoveredPrinter =
  async (
    agent: any,
    printer: any
  ) => {
    const key =
      getPrinterKey(
        printer
      )

    if (
      connectingPrinterKey.value
    ) {
      return
    }

    connectingPrinterKey.value =
      key

    try {
      const token =
        localStorage.getItem(
          'printflow-auth-token'
        )

      if (!token) {
        throw new Error(
          'Sessão não encontrada.'
        )
      }

      const printerPayload = {
        ...printer
      }

      const options:
        Record<string, any> =
        {}

      // ==================================================
      // BAMBU
      // ==================================================

      if (
        printer.protocol ===
        'bambu'
      ) {
        if (
          printer.mock ===
          true
        ) {
          printerPayload.serial =
            printer.serial ||
            'PFMOCKBAMBU001'
        } else {
          const credentials =
            getPrinterConnectionOptions(
              printer
            )

          const serial =
            credentials
              .serial
              .trim()

          const accessCode =
            credentials
              .accessCode
              .trim()

          if (!serial) {
            throw new Error(
              'Informe o número de série da Bambu.'
            )
          }

          if (!accessCode) {
            throw new Error(
              'Informe o LAN Access Code da Bambu.'
            )
          }

          printerPayload.serial =
            serial

          options.accessCode =
            accessCode
        }
      }

      discoveryMessage.value =
        'Testando conexão com a impressora...'

      const connectionOptions =
        getPrinterConnectionOptions(
          printer
        )

      if (
        printer.protocol ===
        'octoprint'
      ) {
        const apiKey =
          connectionOptions
            .apiKey
            .trim()

        if (!apiKey) {
          throw new Error(
            'Informe a API Key do OctoPrint.'
          )
        }

        options.apiKey =
          apiKey
      }

      if (
        printer.protocol ===
        'moonraker'
      ) {
        const apiKey =
          connectionOptions
            .apiKey
            .trim()

        if (apiKey) {
          options.apiKey =
            apiKey
        }
      }

      if (
        printer.protocol ===
        'prusalink'
      ) {
        const username =
          connectionOptions
            .username
            .trim()

        const password =
          connectionOptions
            .password
            .trim()

        if (!username) {
          throw new Error(
            'Informe o usuario do PrusaLink.'
          )
        }

        if (!password) {
          throw new Error(
            'Informe a senha/API Key do PrusaLink.'
          )
        }

        options.username =
          username

        options.password =
          password
      }

      const response =
        await fetch(
          `${config.public.apiBase}/api/agents/${agent.id}/connect-printer`,
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                printer:
                  printerPayload,

                options
              })
          }
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ||
          'Não foi possível iniciar a conexão.'
        )
      }

      const result =
        await waitForCommandResult(
          String(
            data.command.id
          )
        )

      if (
        result?.success ===
        false
      ) {
        throw new Error(
          result.error ||
          'Não foi possível conectar à impressora.'
        )
      }

      discoveryMessage.value =
        'Impressora conectada com sucesso.'

      const {
        agentPrinterId,
        registeredPrinter
      } =
        await findRegisteredAgentPrinter(
          agent,
          printerPayload
        )

      const serial =
        String(
          printerPayload.serial ||
          registeredPrinter.serial ||
          ''
        ).trim()

      const existingPrinter =
        printers.value.find(
          item =>
            item.agentPrinterId ===
              agentPrinterId ||
            (
              serial &&
              item.serial ===
                serial
            )
        )

      const printerRecord = {
        id:
          existingPrinter?.id,

        name:
          printerPayload.name ||
          registeredPrinter.name ||
          'Bambu Lab',

        code:
          existingPrinter?.code ||
          nextCode.value,

        maker:
          printerPayload.manufacturer ||
          registeredPrinter.manufacturer ||
          'Bambu Lab',

        model:
          printerPayload.model ||
          registeredPrinter.model ||
          printerPayload.software ||
          'Bambu Lab',

        acquired:
          existingPrinter?.acquired ||
          null,

        power:
          existingPrinter?.power ||
          350,

        hours:
          existingPrinter?.hours ||
          0,

        status:
          'DisponÃ­vel',

        maintenance:
          existingPrinter?.maintenance ||
          null,

        serial:
          serial ||
          '-',

        location:
          existingPrinter?.location ||
          '',

        volume:
          existingPrinter?.volume ||
          '',

        defaultFilament:
          existingPrinter?.defaultFilament ||
          '',

        agentId:
          String(
            agent.id
          ),

        agentPrinterId,

        agentConnectionKey:
          registeredPrinter.connectionKey ||
          result?.connection?.key ||
          '',

        agentProtocol:
          printerPayload.protocol ||
          registeredPrinter.protocol ||
          '',

        agentConnectionType:
          printerPayload.connectionType ||
          registeredPrinter.connectionType ||
          ''
      }

      if (
        existingPrinter?.id
      ) {
        await updateItem(
          'printers',
          printerRecord
        )
      } else {
        await createItem(
          'printers',
          printerRecord
        )
      }

      notify(
        'Impressora conectada e adicionada Ã  lista.'
      )

      navigateTo(
        '/impressoras'
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível conectar à impressora.'

      discoveryMessage.value =
        message

      notify(
        message,
        'info'
      )
    } finally {
      connectingPrinterKey.value =
        null
    }
  }

// ======================================================
// CONSULTAR STATUS DA IMPRESSORA
// ======================================================

// ======================================================
// CONSULTAR STATUS DA IMPRESSORA
// ======================================================

const loadPrinterStatus =
  async (
    agent: any,
    printer: any
  ) => {
    const key =
      getPrinterKey(
        printer
      )

    // ==================================================
    // EVITAR CONSULTAS SIMULTÂNEAS
    // ==================================================

    if (
      printerStatusLoadingKey.value
    ) {
      return
    }

    printerStatusLoadingKey.value =
      key

    try {
      // ==================================================
      // TOKEN
      // ==================================================

      const token =
        localStorage.getItem(
          'printflow-auth-token'
        )

      if (
        !token
      ) {
        throw new Error(
          'Sessão não encontrada.'
        )
      }

      // ==================================================
      // LOCALIZAR IMPRESSORA REGISTRADA
      // ==================================================
      //
      // O helper:
      //
      // 1. consulta agent_printers;
      // 2. identifica a impressora correta;
      // 3. obtém agentPrinterId;
      // 4. carrega lastStatus;
      // 5. carrega erros conhecidos.
      //
      // ==================================================

      const {
        agentPrinterId
      } =
        await findRegisteredAgentPrinter(
          agent,
          printer
        )

      // ==================================================
      // SOLICITAR STATUS
      // ==================================================
      //
      // O navegador envia SOMENTE:
      //
      // agentPrinterId
      //
      // IP, serial, protocolo e porta são recuperados
      // pelo BackEnd a partir de agent_printers.
      //
      // ==================================================

      const response =
        await fetch(
          `${config.public.apiBase}/api/agents/${agent.id}/printer-status`,
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                agentPrinterId
              })
          }
        )

      const data =
        await response.json()

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
          'Não foi possível solicitar o status.'
        )
      }

      // ==================================================
      // ESPERAR AGENT
      // ==================================================

      const result =
        await waitForCommandResult(
          String(
            data.command.id
          )
        )

      if (
        result?.success ===
        false
      ) {
        throw new Error(
          result.error ||
          'Não foi possível consultar o status.'
        )
      }

      // ==================================================
      // TELEMETRIA ATUAL
      // ==================================================

      const status =
        result?.status &&
        typeof result.status ===
          'object'
          ? result.status
          : {}

      // ==================================================
      // PRESERVAR ESTADO EXISTENTE
      // ==================================================
      //
      // Antes dessa chamada o helper pode ter carregado:
      //
      // lastOperationError
      // lastConnectionError
      // lastStatus
      //
      // Um printer_status bem-sucedido prova que a
      // comunicação está funcionando.
      //
      // Portanto:
      //
      // lastConnectionError = null
      //
      // mas preservamos lastOperationError.
      //
      // ==================================================

      const currentStatus =
        printerStatuses[key] &&
        typeof printerStatuses[key] ===
          'object'
          ? printerStatuses[key]
          : {}

      printerStatuses[key] = {
        ...currentStatus,
        ...status,

        lastConnectionError:
          null
      }

      // ==================================================
      // SUCESSO
      // ==================================================

      notify(
        'Status atualizado.'
      )
    } catch (
      error
    ) {
      // ==================================================
      // ERRO DE STATUS / COMUNICAÇÃO
      // ==================================================
      //
      // Não apagamos a última telemetria.
      //
      // A última leitura válida continua visível,
      // mas registramos na interface que a atualização
      // atual falhou.
      //
      // ==================================================

      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível consultar o status.'

      const currentStatus =
        printerStatuses[key] &&
        typeof printerStatuses[key] ===
          'object'
          ? printerStatuses[key]
          : {}

      printerStatuses[key] = {
        ...currentStatus,

        lastConnectionError:
          message
      }

      notify(
        message,
        'info'
      )
    } finally {
      printerStatusLoadingKey.value =
        null
    }
  }
// ======================================================
// CONTROLES DA IMPRESSORA
// ======================================================

const controlPrinter =
  async (
    agent: any,
    printer: any,
    action:
      | 'pause'
      | 'resume'
      | 'cancel'
  ) => {
    const key =
      getPrinterKey(
        printer
      )

    // ==================================================
    // EVITAR COMANDOS SIMULTÂNEOS
    // ==================================================

    if (
      printerControlLoadingKey.value
    ) {
      return
    }

    // ==================================================
    // CONFIRMAR CANCELAMENTO
    // ==================================================

    if (
      action ===
      'cancel'
    ) {
      const confirmed =
        window.confirm(
          'Deseja realmente cancelar a impressão atual?'
        )

      if (
        !confirmed
      ) {
        return
      }
    }

    printerControlLoadingKey.value =
      `${key}:${action}`

    try {
      // ==================================================
      // TOKEN
      // ==================================================

      const token =
        localStorage.getItem(
          'printflow-auth-token'
        )

      if (
        !token
      ) {
        throw new Error(
          'Sessão não encontrada.'
        )
      }

      // ==================================================
      // LOCALIZAR IMPRESSORA REGISTRADA
      // ==================================================

      const {
        agentPrinterId
      } =
        await findRegisteredAgentPrinter(
          agent,
          printer
        )

      // ==================================================
      // ENVIAR COMANDO
      // ==================================================

      const response =
        await fetch(
          `${config.public.apiBase}/api/agents/${agent.id}/printer-${action}`,
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${token}`,

              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                agentPrinterId
              })
          }
        )

      const data =
        await response.json()

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
          'Não foi possível enviar o comando.'
        )
      }

      // ==================================================
      // ESPERAR AGENT EXECUTAR
      // ==================================================

      const result =
        await waitForCommandResult(
          String(
            data.command.id
          )
        )

      if (
        result?.success ===
        false
      ) {
        throw new Error(
          result.error ||
          'O comando não pôde ser executado.'
        )
      }

      // ==================================================
      // MENSAGEM DE SUCESSO
      // ==================================================

      const messages = {
        pause:
          'Impressão pausada.',

        resume:
          'Impressão retomada.',

        cancel:
          'Impressão cancelada.'
      }

      notify(
        messages[action]
      )

      // ==================================================
      // LIMPAR ERRO OPERACIONAL ANTERIOR
      // ==================================================

      const currentStatus =
        printerStatuses[key] &&
        typeof printerStatuses[key] ===
          'object'
          ? printerStatuses[key]
          : {}

      printerStatuses[key] = {
        ...currentStatus,

        lastOperationError:
          null
      }

      // ==================================================
      // ATUALIZAR TELEMETRIA
      // ==================================================

      await loadPrinterStatus(
        agent,
        printer
      )
    } catch (
      error
    ) {
      // ==================================================
      // ERRO OPERACIONAL
      // ==================================================

      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível executar o comando.'

      const currentStatus =
        printerStatuses[key] &&
        typeof printerStatuses[key] ===
          'object'
          ? printerStatuses[key]
          : {}

      printerStatuses[key] = {
        ...currentStatus,

        lastOperationError:
          message
      }

      notify(
        message,
        'info'
      )
    } finally {
      // ==================================================
      // LIBERAR CONTROLE
      // ==================================================

      printerControlLoadingKey.value =
        null
    }
  }
// ======================================================
// INICIALIZAÇÃO
// ======================================================

onMounted(() => {
  loadAgents()
})

// ======================================================
// FORMULÁRIO MANUAL
// ======================================================

const saving =
  ref(false)

const nextCode =
  computed(
    () =>
      `PRT-${String(
        printers.value.length +
          1
      ).padStart(
        3,
        '0'
      )}`
  )

const form =
  reactive({
    name: '',
    maker: '',
    model: '',
    serial: '',
    code: '',
    acquired: '',
    purchase: 0,
    power: 350,
    consumption: 0.35,
    x: 220,
    y: 220,
    z: 250,
    nozzle: 0.4,
    firmware: 'Marlin 2.1',
    hours: 0,
    status: 'Disponível',
    location: '',
    filament: 'PLA Preto',
    maintenance: '',
    nextMaintenance: '',
    interval: 250
  })

const errors =
  reactive<
    Record<
      string,
      string
    >
  >({})

const editId =
  computed(() =>
    typeof route.query.id ===
    'string'
      ? route.query.id
      : ''
  )

const isEditing =
  computed(
    () =>
      Boolean(
        editId.value
      )
  )

const hydrated =
  ref(false)

const testHours =
  ref(10)

const energyCost =
  computed(
    () =>
      form.power /
      1000 *
      testHours.value *
      0.68
  )

const touched =
  computed(() =>
    Object.values(
      form
    ).some(
      value =>
        value !== '' &&
        value !== 0 &&
        ![
          'Disponível',
          'PLA Preto',
          'Marlin 2.1',
          350,
          0.35,
          220,
          250,
          0.4
        ].includes(
          value as never
        )
    )
  )

// ======================================================
// CARREGAR IMPRESSORA EM EDIÇÃO
// ======================================================

watchEffect(() => {
  if (
    !editId.value ||
    hydrated.value
  ) {
    return
  }

  const item =
    printers.value.find(
      printer =>
        printer.id ===
        editId.value
    )

  if (!item) {
    return
  }

  Object.assign(
    form,
    {
      name:
        item.name,

      maker:
        item.maker,

      model:
        item.model,

      serial:
        item.serial,

      code:
        item.code,

      acquired:
        toDateInputValue(
          item.acquired
        ),

      power:
        item.power,

      hours:
        item.hours,

      status:
        /Em Impressao|Em Impressão/.test(
          item.status
        )
          ? 'Imprimindo'
          : /Em Manutencao|Em Manutenção/.test(
                item.status
              )
            ? 'Manutenção'
            : item.status ===
                'Disponivel'
              ? 'Disponível'
              : item.status,

      maintenance:
        toDateInputValue(
          item.maintenance
        )
    }
  )

  hydrated.value =
    true
})

// ======================================================
// VALIDAR FORMULÁRIO
// ======================================================

const validate = () => {
  Object.keys(
    errors
  ).forEach(
    key =>
      delete errors[key]
  )

  if (
    !form.name.trim()
  ) {
    errors.name =
      'Informe o nome da impressora.'
  }

  if (
    !form.maker.trim()
  ) {
    errors.maker =
      'Informe o fabricante.'
  }

  if (
    !form.model.trim()
  ) {
    errors.model =
      'Informe o modelo.'
  }

  if (
    !form.power ||
    form.power <= 0
  ) {
    errors.power =
      'Informe a potência média.'
  }

  if (
    !form.status
  ) {
    errors.status =
      'Selecione o status.'
  }

  const first =
    Object.keys(
      errors
    )[0]

  if (first) {
    nextTick(
      () =>
        document
          .querySelector(
            `[data-field="${first}"] input,[data-field="${first}"] select`
          )
          ?.focus()
    )
  }

  return !first
}

// ======================================================
// SALVAR
// ======================================================

const save =
  async (
    again = false
  ) => {
    if (!validate()) {
      return
    }

    if (
      saving.value
    ) {
      return
    }

    saving.value =
      true

    try {
      const payload = {
        id:
          editId.value,

        name:
          form.name,

        code:
          form.code ||
          nextCode.value,

        maker:
          form.maker,

        model:
          form.model,

        acquired:
          form.acquired ||
          null,

        power:
          form.power,

        hours:
          form.hours,

        status:
          form.status ===
          'Imprimindo'
            ? 'Em Impressão'
            : form.status ===
                'Manutenção'
              ? 'Em Manutenção'
              : form.status,

        maintenance:
          form.maintenance ||
          null,

        serial:
          form.serial ||
          '-',

        location:
          form.location,

        volume:
          `${form.x} x ${form.y} x ${form.z} mm`,

        defaultFilament:
          form.filament
      }

      if (
        isEditing.value
      ) {
        await updateItem(
          'printers',
          payload
        )
      } else {
        await createItem(
          'printers',
          payload
        )
      }

      notify(
        isEditing.value
          ? 'Impressora atualizada com sucesso.'
          : 'Impressora cadastrada com sucesso.'
      )

      if (again) {
        form.name = ''
        form.model = ''
        form.serial = ''
        form.code = ''

        return
      }

      navigateTo(
        '/impressoras'
      )
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a impressora.',
        'info'
      )
    } finally {
      saving.value =
        false
    }
  }

// ======================================================
// CANCELAR
// ======================================================

const cancel = () => {
  if (
    !touched.value ||
    window.confirm(
      'Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.'
    )
  ) {
    navigateTo(
      '/impressoras'
    )
  }
}
</script>

<template>
  <div>
    <!-- ================================================= -->
    <!-- CABEÇALHO                                         -->
    <!-- ================================================= -->

    <div class="breadcrumb">
      <span>
        Impressoras
      </span>

      <UiIcon
        name="chevron"
        :size="12"
      />

      <strong>
        {{
          isEditing
            ? 'Editar Impressora'
            : 'Nova Impressora'
        }}
      </strong>
    </div>

    <PageHeader
      :title="
        isEditing
          ? 'Editar Impressora'
          : 'Nova Impressora'
      "
      :subtitle="
        isEditing
          ? 'Atualize operação, potência e manutenção da impressora.'
          : 'Cadastre manualmente ou conecte uma impressora utilizando o PrintFlow Agent.'
      "
    />

    <!-- ================================================= -->
    <!-- ESCOLHER MÉTODO                                   -->
    <!-- ================================================= -->

    <div
      v-if="!isEditing"
      class="form-card"
      style="
        margin-bottom: 16px;
      "
    >
      <h2 class="form-card__title">
        <UiIcon
          name="printer"
        />

        Como deseja adicionar a impressora?
      </h2>

      <div
        style="
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 12px;
        "
      >
        <button
          type="button"
          class="btn"
          :class="{
            'btn--primary':
              connectionMode ===
              'agent'
          }"
          style="
            min-height: 70px;
          "
          @click="
            connectionMode =
              'agent'
          "
        >
          Conectar com PrintFlow Agent
        </button>

        <button
          type="button"
          class="btn"
          :class="{
            'btn--primary':
              connectionMode ===
              'manual'
          }"
          style="
            min-height: 70px;
          "
          @click="
            connectionMode =
              'manual'
          "
        >
          Cadastrar manualmente
        </button>
      </div>
    </div>

    <!-- ================================================= -->
    <!-- PRINTFLOW AGENT                                   -->
    <!-- ================================================= -->

    <div
      v-if="
        !isEditing &&
        connectionMode ===
          'agent'
      "
      class="form-card"
      style="
        margin-bottom: 16px;
      "
    >
      <h2 class="form-card__title">
        <UiIcon
          name="settings"
        />

        PrintFlow Agent
      </h2>

      <div
        class="summary-box"
        style="
          margin-bottom: 14px;
        "
      >
        <div class="detail-list__row">
          <span>
            Conexao automatica
          </span>

          <strong>
            Agent local
          </strong>
        </div>

        <p
          style="
            margin-top: 8px;
          "
        >
          Use esta opcao para encontrar impressoras na rede ou conectadas por cabo USB neste computador.
        </p>

        <div
          style="
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 12px;
          "
        >
          <button
            type="button"
            class="btn btn--primary"
            @click="
              downloadAgentWindows
            "
          >
            Baixar Agent Windows
          </button>

          <button
            type="button"
            class="btn"
            :disabled="
              openingAgent
            "
            @click="
              openInstalledAgent
            "
          >
            {{
              openingAgent
                ? 'Verificando...'
                : 'Conectar Agent instalado'
            }}
          </button>

          <button
            type="button"
            class="btn"
            :disabled="
              agentLoading
            "
            @click="
              loadAgents
            "
          >
            {{
              agentLoading
                ? 'Atualizando...'
                : 'Atualizar'
            }}
          </button>
        </div>

        <p
          v-if="
            agentOpenMessage
          "
          style="
            margin-top: 10px;
          "
        >
          {{
            agentOpenMessage
          }}
        </p>
      </div>

      <div
        v-if="
          agentLoading
        "
      >
        Verificando Agents...
      </div>

      <template v-else>
        <div
          v-if="
            agents.length
          "
        >
          <p
            style="
              margin-bottom: 14px;
            "
          >
            Estes computadores estão conectados à sua conta PrintFlow.
          </p>

          <!-- =========================================== -->
          <!-- CADA AGENT                                  -->
          <!-- =========================================== -->

          <div
            v-for="
              agent in agents
            "
            :key="
              agent.id
            "
            class="summary-box"
            style="
              margin-bottom: 14px;
            "
          >
            <div class="detail-list__row">
              <span>
                Computador
              </span>

              <strong>
                {{
                  agent.machineName
                }}
              </strong>
            </div>

            <div class="detail-list__row">
              <span>
                Status
              </span>

              <strong>
                {{
                  agentIsOnline(
                    agent
                  )
                    ? 'Online'
                    : 'Offline'
                }}
              </strong>
            </div>

            <div class="detail-list__row">
              <span>
                Sistema
              </span>

              <strong>
                {{
                  agent.platform
                }}
                ·
                {{
                  agent.architecture
                }}
              </strong>
            </div>

            <div class="detail-list__row">
              <span>
                Versão do Agent
              </span>

              <strong>
                {{
                  agent.version
                }}
              </strong>
            </div>

            <div class="detail-list__row">
              <span>
                Último contato
              </span>

              <strong>
                {{
                  formatLastSeen(
                    agent.lastSeenAt
                  )
                }}
              </strong>
            </div>

            <!-- ========================================= -->
            <!-- PROCURAR                                  -->
            <!-- ========================================= -->

            <div
              style="
                margin-top: 14px;
              "
            >
              <button
                type="button"
                class="btn btn--primary"
                :disabled="
                  !agentIsOnline(
                    agent
                  ) ||
                  discoveringAgentId ===
                    String(
                      agent.id
                    )
                "
                @click="
                  discoverPrinters(
                    agent
                  )
                "
              >
                {{
                  discoveringAgentId ===
                  String(
                    agent.id
                  )
                    ? 'Procurando...'
                    : agentIsOnline(
                          agent
                        )
                      ? 'Procurar impressoras'
                      : 'Agent offline'
                }}
              </button>
            </div>

            <!-- ========================================= -->
            <!-- RESULTADO DA BUSCA                       -->
            <!-- ========================================= -->

            <div
              v-if="
                discoveryAgentId ===
                  String(
                    agent.id
                  ) &&
                discoveryStatus !==
                  'idle'
              "
              class="summary-box"
              style="
                margin-top: 14px;
              "
            >
              <div class="detail-list__row">
                <span>
                  Busca
                </span>

                <strong>
                  {{
                    discoveryMessage
                  }}
                </strong>
              </div>

              <div
                v-if="
                  discoveryStatus ===
                    'pending' ||
                  discoveryStatus ===
                    'running'
                "
                style="
                  margin-top: 10px;
                "
              >
                Aguarde enquanto o PrintFlow Agent verifica a rede e os dispositivos USB.
              </div>

              <div
                v-if="
                  discoveryStatus ===
                    'completed' &&
                  discoveredPrinters.length ===
                    0
                "
                style="
                  margin-top: 10px;
                "
              >
                Nenhuma impressora compatível foi encontrada neste computador ou na rede local.
              </div>

              <!-- ======================================= -->
              <!-- IMPRESSORAS ENCONTRADAS                 -->
              <!-- ======================================= -->

              <div
                v-if="
                  discoveryStatus ===
                    'completed' &&
                  discoveredPrinters.length >
                    0
                "
                style="
                  margin-top: 14px;
                  display: grid;
                  gap: 12px;
                "
              >
                <div
                  v-for="
                    printer in discoveredPrinters
                  "
                  :key="
                    getPrinterKey(
                      printer
                    )
                  "
                  class="summary-box"
                >
                  <div class="detail-list__row">
                    <span>
                      Impressora
                    </span>

                    <strong>
                      {{
                        printer.name ||
                        printer.software ||
                        'Impressora detectada'
                      }}
                    </strong>
                  </div>

                  <div class="detail-list__row">
                    <span>
                      Conexão
                    </span>

                    <strong>
                      {{
                        printer.connectionType ===
                        'usb'
                          ? 'USB / Serial'
                          : 'Rede'
                      }}
                    </strong>
                  </div>

                  <div
                    v-if="
                      printer.ip
                    "
                    class="detail-list__row"
                  >
                    <span>
                      IP
                    </span>

                    <strong>
                      {{
                        printer.ip
                      }}
                    </strong>
                  </div>

                  <div
                    v-if="
                      printer.port
                    "
                    class="detail-list__row"
                  >
                    <span>
                      {{
                        printer.connectionType ===
                        'usb'
                          ? 'Porta'
                          : 'Porta de rede'
                      }}
                    </span>

                    <strong>
                      {{
                        printer.port
                      }}
                    </strong>
                  </div>

                  <div
                    v-if="
                      printer.protocol
                    "
                    class="detail-list__row"
                  >
                    <span>
                      Protocolo
                    </span>

                    <strong>
                      {{
                        printer.protocol
                      }}
                    </strong>
                  </div>

                  <div
                    v-if="
                      printer.software
                    "
                    class="detail-list__row"
                  >
                    <span>
                      Software
                    </span>

                    <strong>
                      {{
                        printer.software
                      }}
                    </strong>
                  </div>

                  <div
                    v-if="
                      printer.protocol ===
                      'octoprint'
                    "
                    style="
                      margin-top: 14px;
                      display: grid;
                      gap: 10px;
                    "
                  >
                    <div class="field">
                      <label>
                        API Key do OctoPrint
                      </label>

                      <input
                        v-model="
                          getPrinterConnectionOptions(
                            printer
                          ).apiKey
                        "
                        type="password"
                        placeholder="API Key"
                        autocomplete="off"
                      >
                    </div>
                  </div>

                  <div
                    v-if="
                      printer.protocol ===
                      'moonraker'
                    "
                    style="
                      margin-top: 14px;
                      display: grid;
                      gap: 10px;
                    "
                  >
                    <div class="field">
                      <label>
                        Token Moonraker
                      </label>

                      <input
                        v-model="
                          getPrinterConnectionOptions(
                            printer
                          ).apiKey
                        "
                        type="password"
                        placeholder="Opcional"
                        autocomplete="off"
                      >
                    </div>
                  </div>

                  <div
                    v-if="
                      printer.protocol ===
                      'prusalink'
                    "
                    style="
                      margin-top: 14px;
                      display: grid;
                      gap: 10px;
                    "
                  >
                    <div class="field">
                      <label>
                        Usuario PrusaLink
                      </label>

                      <input
                        v-model="
                          getPrinterConnectionOptions(
                            printer
                          ).username
                        "
                        placeholder="maker"
                        autocomplete="off"
                      >
                    </div>

                    <div class="field">
                      <label>
                        Senha/API Key PrusaLink
                      </label>

                      <input
                        v-model="
                          getPrinterConnectionOptions(
                            printer
                          ).password
                        "
                        type="password"
                        placeholder="Senha ou API Key"
                        autocomplete="off"
                      >
                    </div>
                  </div>

                  <!-- =================================== -->
                  <!-- BAMBU                               -->
                  <!-- =================================== -->

                  <div
                    v-if="
                      printer.protocol ===
                      'bambu' &&
                      printer.mock !==
                        true
                    "
                    style="
                      margin-top: 14px;
                      display: grid;
                      gap: 10px;
                    "
                  >
                    <div class="field">
                      <label>
                        Número de série
                      </label>

                      <input
                        v-model="
                          getPrinterConnectionOptions(
                            printer
                          ).serial
                        "
                        placeholder="Serial da Bambu"
                        autocomplete="off"
                      >
                    </div>

                    <div class="field">
                      <label>
                        LAN Access Code
                      </label>

                      <input
                        v-model="
                          getPrinterConnectionOptions(
                            printer
                          ).accessCode
                        "
                        type="password"
                        placeholder="Código LAN"
                        autocomplete="off"
                      >
                    </div>
                  </div>

                  <!-- =================================== -->
                  <!-- AÇÕES DA IMPRESSORA                 -->
                  <!-- =================================== -->

                  <div
                    style="
                      margin-top: 14px;
                      display: flex;
                      gap: 8px;
                      flex-wrap: wrap;
                    "
                  >
                    <button
                      type="button"
                      class="btn btn--primary"
                      :disabled="
                        connectingPrinterKey ===
                        getPrinterKey(
                          printer
                        )
                      "
                      @click="
                        connectDiscoveredPrinter(
                          agent,
                          printer
                        )
                      "
                    >
                      {{
                        connectingPrinterKey ===
                        getPrinterKey(
                          printer
                        )
                          ? 'Conectando...'
                          : 'Conectar'
                      }}
                    </button>

                    <button
                      type="button"
                      class="btn"
                      :disabled="
                        printerStatusLoadingKey ===
                        getPrinterKey(
                          printer
                        )
                      "
                      @click="
                        loadPrinterStatus(
                          agent,
                          printer
                        )
                      "
                    >
                      {{
                        printerStatusLoadingKey ===
                        getPrinterKey(
                          printer
                        )
                          ? 'Atualizando...'
                          : 'Atualizar status'
                      }}
                    </button>
                  </div>

                  <!-- =================================== -->
                  <!-- CONTROLES DE IMPRESSÃO              -->
                  <!-- =================================== -->

                  <div
                    style="
                      margin-top: 10px;
                      display: flex;
                      gap: 8px;
                      flex-wrap: wrap;
                    "
                  >
                    <button
                      type="button"
                      class="btn"
                      :disabled="
                        printerControlLoadingKey !==
                        null
                      "
                      @click="
                        controlPrinter(
                          agent,
                          printer,
                          'pause'
                        )
                      "
                    >
                      {{
                        printerControlLoadingKey ===
                        `${getPrinterKey(printer)}:pause`
                          ? 'Pausando...'
                          : 'Pausar'
                      }}
                    </button>

                    <button
                      type="button"
                      class="btn"
                      :disabled="
                        printerControlLoadingKey !==
                        null
                      "
                      @click="
                        controlPrinter(
                          agent,
                          printer,
                          'resume'
                        )
                      "
                    >
                      {{
                        printerControlLoadingKey ===
                        `${getPrinterKey(printer)}:resume`
                          ? 'Retomando...'
                          : 'Retomar'
                      }}
                    </button>

                    <button
                      type="button"
                      class="btn"
                      :disabled="
                        printerControlLoadingKey !==
                        null
                      "
                      @click="
                        controlPrinter(
                          agent,
                          printer,
                          'cancel'
                        )
                      "
                    >
                      {{
                        printerControlLoadingKey ===
                        `${getPrinterKey(printer)}:cancel`
                          ? 'Cancelando...'
                          : 'Cancelar impressão'
                      }}
                    </button>
                  </div>

                  <!-- =================================== -->
                  <!-- TELEMETRIA                          -->
                  <!-- =================================== -->

                  <div
                    v-if="
                      printerStatuses[
                        getPrinterKey(
                          printer
                        )
                      ]
                    "
                    class="summary-box"
                    style="
                      margin-top: 14px;
                    "
                  >
                    <div class="detail-list__row">
                      <span>
                        Estado
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.state ||
                          'Desconhecido'
                        }}
                      </strong>
                    </div>

                    <div class="detail-list__row">
                      <span>
                        Progresso
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.progress ??
                          '-'
                        }}
                        %
                      </strong>
                    </div>

                    <div class="detail-list__row">
                      <span>
                        Camada
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.currentLayer ??
                          '-'
                        }}
                        /
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.totalLayers ??
                          '-'
                        }}
                      </strong>
                    </div>

                    <div class="detail-list__row">
                      <span>
                        Bico
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.nozzleTemperature ??
                          '-'
                        }}
                        °C
                      </strong>
                    </div>

                    <div class="detail-list__row">
                      <span>
                        Mesa
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.bedTemperature ??
                          '-'
                        }}
                        °C
                      </strong>
                    </div>

                    <div class="detail-list__row">
                      <span>
                        Tempo restante
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.remainingMinutes ??
                          '-'
                        }}
                        min
                      </strong>
                    </div>

                    <div
                      v-if="
                        printerStatuses[
                          getPrinterKey(
                            printer
                          )
                        ]?.file
                      "
                      class="detail-list__row"
                    >
                      <span>
                        Arquivo
                      </span>

                      <strong>
                        {{
                          printerStatuses[
                            getPrinterKey(
                              printer
                            )
                          ]?.file
                        }}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- =================================== -->
<!-- ERRO DE CONEXÃO                     -->
<!-- =================================== -->

<div
  v-if="
    printerStatuses[
      getPrinterKey(
        printer
      )
    ]?.lastConnectionError
  "
  class="summary-box"
  style="
    margin-top: 10px;
  "
>
  <div class="detail-list__row">
    <span>
      Problema de conexão
    </span>

    <strong>
      {{
        printerStatuses[
          getPrinterKey(
            printer
          )
        ]?.lastConnectionError
      }}
    </strong>
  </div>
</div>

<!-- =================================== -->
<!-- ERRO OPERACIONAL                    -->
<!-- =================================== -->

<div
  v-if="
    printerStatuses[
      getPrinterKey(
        printer
      )
    ]?.lastOperationError
  "
  class="summary-box"
  style="
    margin-top: 10px;
  "
>
  <div class="detail-list__row">
    <span>
      Erro operacional
    </span>

    <strong>
      {{
        printerStatuses[
          getPrinterKey(
            printer
          )
        ]?.lastOperationError
      }}
    </strong>
  </div>
</div>

          </div>

          <!-- ============================================= -->
          <!-- SEM AGENT                                     -->
          <!-- ============================================= -->

          <div v-else>
            <p>
              Nenhum PrintFlow Agent esta conectado a esta conta.
            </p>

            <p
              style="
                margin-top: 6px;
              "
            >
              Baixe o Agent Windows ou abra o Agent ja instalado pelos botoes acima. A conexao com esta conta sera preparada automaticamente.
            </p>
          </div>
      </template>
    </div>

    <!-- ================================================= -->
    <!-- CADASTRO MANUAL                                   -->
    <!-- ================================================= -->

    <div
      v-if="
        isEditing ||
        connectionMode ===
          'manual'
      "
      class="split-layout"
      style="
        grid-template-columns:
          minmax(0, 1fr)
          340px;
      "
    >
      <form
        @submit.prevent="
          save(false)
        "
      >
        <!-- ============================================= -->
        <!-- 1. IDENTIFICAÇÃO                              -->
        <!-- ============================================= -->

        <div class="form-card">
          <h2 class="form-card__title">
            <UiIcon
              name="printer"
            />

            1. Identificação
          </h2>

          <div class="form-grid">
            <div
              class="field col-5"
              data-field="name"
              :class="{
                'field--error':
                  errors.name
              }"
            >
              <label>
                Nome da Impressora *
              </label>

              <input
                v-model="
                  form.name
                "
                placeholder="Ender 3 V2 - Produção 01"
              >

              <small
                v-if="
                  errors.name
                "
                class="field__error"
              >
                {{
                  errors.name
                }}
              </small>
            </div>

            <div
              class="field col-4"
              data-field="maker"
              :class="{
                'field--error':
                  errors.maker
              }"
            >
              <label>
                Fabricante *
              </label>

              <input
                v-model="
                  form.maker
                "
                placeholder="Creality"
              >

              <small
                v-if="
                  errors.maker
                "
                class="field__error"
              >
                {{
                  errors.maker
                }}
              </small>
            </div>

            <div
              class="field col-3"
              data-field="model"
              :class="{
                'field--error':
                  errors.model
              }"
            >
              <label>
                Modelo *
              </label>

              <input
                v-model="
                  form.model
                "
                placeholder="Ender 3 V2"
              >

              <small
                v-if="
                  errors.model
                "
                class="field__error"
              >
                {{
                  errors.model
                }}
              </small>
            </div>

            <div class="field col-4">
              <label>
                Número de série
              </label>

              <input
                v-model="
                  form.serial
                "
              >
            </div>

            <div class="field col-4">
              <label>
                Código interno
              </label>

              <input
                v-model="
                  form.code
                "
                :placeholder="
                  nextCode
                "
              >
            </div>
          </div>
        </div>

        <!-- ============================================= -->
        <!-- 2. AQUISIÇÃO                                  -->
        <!-- ============================================= -->

        <div class="form-card">
          <h2 class="form-card__title">
            <UiIcon
              name="money"
            />

            2. Aquisição
          </h2>

          <div class="form-grid">
            <div class="field col-4">
              <label>
                Data de aquisição
              </label>

              <input
                v-model="
                  form.acquired
                "
                type="date"
              >
            </div>

            <div class="field col-4">
              <label>
                Preço de compra
              </label>

              <input
                v-model.number="
                  form.purchase
                "
                type="number"
                step=".01"
              >
            </div>
          </div>
        </div>

        <!-- ============================================= -->
        <!-- 3. ESPECIFICAÇÕES                             -->
        <!-- ============================================= -->

        <div class="form-card">
          <h2 class="form-card__title">
            <UiIcon
              name="settings"
            />

            3. Especificações
          </h2>

          <div class="form-grid">
            <div
              class="field col-3"
              data-field="power"
              :class="{
                'field--error':
                  errors.power
              }"
            >
              <label>
                Potência média *
              </label>

              <input
                v-model.number="
                  form.power
                "
                type="number"
              >

              <small
                v-if="
                  errors.power
                "
                class="field__error"
              >
                {{
                  errors.power
                }}
              </small>
            </div>

            <div class="field col-3">
              <label>
                Consumo médio
              </label>

              <input
                v-model.number="
                  form.consumption
                "
                type="number"
                step=".01"
              >
            </div>

            <div class="field col-2">
              <label>
                X
              </label>

              <input
                v-model.number="
                  form.x
                "
                type="number"
              >
            </div>

            <div class="field col-2">
              <label>
                Y
              </label>

              <input
                v-model.number="
                  form.y
                "
                type="number"
              >
            </div>

            <div class="field col-2">
              <label>
                Z
              </label>

              <input
                v-model.number="
                  form.z
                "
                type="number"
              >
            </div>

            <div class="field col-3">
              <label>
                Diâmetro do bico
              </label>

              <input
                v-model.number="
                  form.nozzle
                "
                type="number"
                step=".1"
              >
            </div>

            <div class="field col-4">
              <label>
                Firmware
              </label>

              <input
                v-model="
                  form.firmware
                "
              >
            </div>
          </div>
        </div>

        <!-- ============================================= -->
        <!-- 4. OPERAÇÃO                                   -->
        <!-- ============================================= -->

        <div class="form-card">
          <h2 class="form-card__title">
            <UiIcon
              name="play"
            />

            4. Operação
          </h2>

          <div class="form-grid">
            <div class="field col-3">
              <label>
                Horas acumuladas
              </label>

              <input
                v-model.number="
                  form.hours
                "
                type="number"
              >
            </div>

            <div
              class="field col-3"
              data-field="status"
              :class="{
                'field--error':
                  errors.status
              }"
            >
              <label>
                Status *
              </label>

              <select
                v-model="
                  form.status
                "
              >
                <option>
                  Disponível
                </option>

                <option>
                  Imprimindo
                </option>

                <option>
                  Manutenção
                </option>

                <option>
                  Inativa
                </option>
              </select>

              <small
                v-if="
                  errors.status
                "
                class="field__error"
              >
                {{
                  errors.status
                }}
              </small>
            </div>

            <div class="field col-3">
              <label>
                Localização
              </label>

              <input
                v-model="
                  form.location
                "
                placeholder="Sala de Produção"
              >
            </div>

            <div class="field col-3">
              <label>
                Filamento padrão
              </label>

              <select
                v-model="
                  form.filament
                "
              >
                <option
                  v-for="
                    f in filaments
                  "
                  :key="
                    f.name
                  "
                >
                  {{
                    f.name
                  }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- ============================================= -->
        <!-- 5. MANUTENÇÃO                                 -->
        <!-- ============================================= -->

        <div class="form-card">
          <h2 class="form-card__title">
            <UiIcon
              name="wrench"
            />

            5. Manutenção
          </h2>

          <div class="form-grid">
            <div class="field col-4">
              <label>
                Última manutenção
              </label>

              <input
                v-model="
                  form.maintenance
                "
                type="date"
              >
            </div>

            <div class="field col-4">
              <label>
                Próxima manutenção
              </label>

              <input
                v-model="
                  form.nextMaintenance
                "
                type="date"
              >
            </div>

            <div class="field col-4">
              <label>
                Intervalo recomendado
              </label>

              <input
                v-model.number="
                  form.interval
                "
                type="number"
              >
            </div>
          </div>
        </div>

        <!-- ============================================= -->
        <!-- BOTÕES                                        -->
        <!-- ============================================= -->

        <div class="form-actions">
          <button
            type="button"
            class="btn"
            @click="
              cancel
            "
          >
            Cancelar
          </button>

          <button
            v-if="
              !isEditing
            "
            type="button"
            class="btn"
            :disabled="
              saving
            "
            @click="
              save(true)
            "
          >
            Salvar e adicionar outra
          </button>

          <button
            type="submit"
            class="btn btn--primary"
            :disabled="
              saving
            "
          >
            {{
              saving
                ? 'Salvando...'
                : isEditing
                  ? 'Salvar Alterações'
                  : 'Salvar Impressora'
            }}
          </button>
        </div>
      </form>

      <!-- ================================================= -->
      <!-- LATERAL                                           -->
      <!-- ================================================= -->

      <aside>
        <div class="detail-card">
          <div class="detail-card__head">
            <span
              class="product-thumb"
              style="
                width: 95px;
                height: 95px;
              "
            >
              <UiIcon
                name="printer"
                :size="58"
              />
            </span>

            <div>
              <h3>
                {{
                  form.name ||
                  'Nova impressora'
                }}
              </h3>

              <p>
                {{
                  form.maker ||
                  'Fabricante'
                }}

                {{
                  form.model
                }}
              </p>

              <p>
                <span
                  class="badge badge--green"
                >
                  {{
                    form.status
                  }}
                </span>
              </p>
            </div>
          </div>
        </div>

        <PanelCard
          title="Estimativa de Energia"
          style="
            margin-top: 12px;
          "
        >
          <div class="field">
            <label>
              Horas de impressão
            </label>

            <input
              v-model.number="
                testHours
              "
              type="number"
            >
          </div>

          <div class="summary-box">
            <div class="detail-list__row">
              <span>
                Potência
              </span>

              <strong>
                {{
                  form.power
                }}
                W
              </strong>
            </div>

            <div class="detail-list__row">
              <span>
                Custo estimado
              </span>

              <strong
                class="money-positive"
              >
                {{
                  formatCurrency(
                    energyCost
                  )
                }}
              </strong>
            </div>
          </div>
        </PanelCard>
      </aside>
    </div>
  </div>
</template>
