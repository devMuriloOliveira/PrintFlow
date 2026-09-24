<script setup lang="ts">
const { products, printers, printJobs, filaments, deleteItem, refreshAppData, enqueuePrintJob, reorderPrintJob, movePrintJobPrinter, cancelQueuedPrintJob, approveMarketplacePrintJob, startManualPrintJob, completeQueuedPrintJob, retryPrintJob, approveProductionOutput } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const config = useRuntimeConfig()
const selectedIndex = ref(0)
const printerStatusFilter = ref('Todos')
const printerMakerFilter = ref('Todos')
const printerModelFilter = ref('Todos')
const emptyPrinter = { name: '', code: '', maker: '', model: '', acquired: '', power: 0, hours: 0, status: '', maintenance: '', serial: '' }
const selected = computed(() => printers.value[selectedIndex.value] || emptyPrinter)
const printerStatusOptions = computed(() => ['Todos', ...new Set(printers.value.map((printer: any) => String(printer.status || '').trim()).filter(Boolean))])
const printerMakerOptions = computed(() => ['Todos', ...new Set(printers.value.map((printer: any) => String(printer.maker || '').trim()).filter(Boolean))])
const printerModelOptions = computed(() => ['Todos', ...new Set(printers.value.map((printer: any) => String(printer.model || '').trim()).filter(Boolean))])
const filteredPrinters = computed(() => printers.value.filter((printer: any) =>
  (printerStatusFilter.value === 'Todos' || String(printer.status || '') === printerStatusFilter.value) &&
  (printerMakerFilter.value === 'Todos' || String(printer.maker || '') === printerMakerFilter.value) &&
  (printerModelFilter.value === 'Todos' || String(printer.model || '') === printerModelFilter.value)
))
const selectPrinter = (printer: any) => {
  const index = printers.value.findIndex((item: any) => String(item.id || item.code) === String(printer.id || printer.code))
  if (index >= 0) selectedIndex.value = index
}
const clearPrinterFilters = () => {
  printerStatusFilter.value = 'Todos'
  printerMakerFilter.value = 'Todos'
  printerModelFilter.value = 'Todos'
}
const energyCost = computed(() => selected.value ? selected.value.power/1000*82*.68 : 0)
const agents = ref<any[]>([])
const agentLoading = ref(false)
const printerStatusLoadingId = ref('')
const printerControlLoadingId = ref('')
const printerStatuses = reactive<Record<string, any>>({})
const statusRefreshTimer = ref<ReturnType<typeof setInterval> | null>(null)
const queueProductId = ref('')
const queueQuantity = ref(1)
const queueLoadingId = ref('')
const qualityApproved = reactive<Record<string, number>>({})
const displayStatus=(s:string)=>s.replace('Disponivel', 'Disponível').replace('Em Impressao', 'Em Impressão').replace('Em Manutencao', 'Em Manutenção')
const badgeClass=(s:string)=>/Disponivel|Disponível/.test(s)?'badge--green':/Em Manutencao|Em Manutenção/.test(s)?'badge--orange':''
const agentIsOnline = (agent: any) => {
  if (!agent?.lastSeenAt) return false
  return Date.now() - new Date(agent.lastSeenAt).getTime() < 90_000
}
const selectedAgent = computed(() => agents.value.find((agent) => String(agent.id) === String((selected.value as any).agentId)))
const selectedAgentPrinterId = computed(() => String((selected.value as any).agentPrinterId || ''))
const selectedLiveStatus = computed(() => {
  return liveStatusForPrinter(selected.value)
})
const selectedAgentStatus = computed(() => {
  if (!selectedAgentPrinterId.value) return 'Manual'
  if (!selectedAgent.value) return 'Agent não encontrado'
  return agentIsOnline(selectedAgent.value) ? 'Agent online' : 'Agent offline'
})
const selectedPrinterJobs = computed(() => printJobs.value
  .filter((job: any) => String(job.printerId || '') === String((selected.value as any).id || '') && (String(job.status || '') !== 'cancelled') && (String(job.status || '') !== 'completed' || String(job.productionOutputStatus || '') === 'pending_quality'))
  .sort((a: any, b: any) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))))
const pendingQualityJobs = computed(() => printJobs.value.filter((job: any) => String(job.productionOutputStatus || '') === 'pending_quality'))
const printerCountPoints = computed(() => printers.value.map(printer => Number(/disponivel|impressao|impressão/i.test(String(printer.status || '')))))
const printingPoints = computed(() => printers.value.map(printer => Number(Boolean(activeJobForPrinter(printer)))))
const maintenancePoints = computed(() => printers.value.map(printer => Number(/manutenc/i.test(String(printer.status || '')))))
const printerHoursPoints = computed(() => printers.value.map(printer => Number(printer.hours || 0)))
const activePrintJob = computed(() => selectedPrinterJobs.value.find((job: any) => ['starting', 'printing', 'paused'].includes(String(job.status || ''))))
const queuedPrintJobs = computed(() => selectedPrinterJobs.value.filter((job: any) => String(job.status || '') === 'queued'))
const selectedQueueProduct = computed(() => products.value.find((product: any) => String(product.id || '') === String(queueProductId.value || '')))
const productForJob = (job: any) => products.value.find((product: any) => String(product.id || '') === String(job.productId || ''))
const jobNeedsGcodePreparation = (job: any) => {
  const product = productForJob(job) || job
  return String(job?.status || '') === 'queued' && String(product?.printFileFormat || '').toLowerCase() === '3mf' && !job?.slicingArtifactStorageKey
}
const nextJobNeedingGcode = computed(() => queuedPrintJobs.value.find(jobNeedsGcodePreparation) || null)
const productValidationLabel = (product: any) => ({ validated: 'Validado', needs_validation: 'Pendente', blocked: 'Bloqueado' }[String(product?.validationStatus || '')] || 'Sem receita')
const productValidationBadgeClass = (product: any) => ({ validated: 'badge--green', needs_validation: 'badge--orange', blocked: 'badge--red' }[String(product?.validationStatus || '')] || 'badge--red')
const parseDimensions = (value: any) => {
  const parts = String(value || '').replace(/,/g, '.').match(/\d+(?:\.\d+)?/g)?.map(Number).filter((item) => Number.isFinite(item) && item > 0) || []
  return parts.length >= 3 ? { x: parts[0], y: parts[1], z: parts[2] } : null
}
const allowedFormatsByProtocol: Record<string, string[]> = {
  bambu: ['3mf', 'gcode', 'bgcode'],
  octoprint: ['gcode'],
  moonraker: ['gcode'],
  prusalink: ['gcode', 'bgcode'],
  marlin: ['gcode']
}
const supportsAgentCapability = (printer: any, capability: string) => {
  const capabilities = printer?.agentCapabilities
  if (!capabilities || typeof capabilities !== 'object' || !Object.keys(capabilities).length) return true
  return capabilities[capability] === true
}
const readyPrintFormats = ['3mf', 'gcode', 'bgcode']
const normalizeList = (value: any) => Array.isArray(value) ? value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
const normalizePrinterStatus = (printer: any, status: any = {}) => ({
  ...(status && typeof status === 'object' ? status : {}),
  lastConnectionError: status?.lastConnectionError || printer?.agentLastConnectionError || null,
  fetchedAt: status?.fetchedAt || printer?.agentLastSeenAt || null
})
const liveStatusForPrinter = (printer: any) => {
  const agentPrinterId = String(printer?.agentPrinterId || '')
  if (!agentPrinterId) return null
  return normalizePrinterStatus(printer, printerStatuses[agentPrinterId] || printer?.agentLastStatus || {})
}
const activeJobForPrinter = (printer: any) => printJobs.value.find((job: any) => String(job.printerId || '') === String(printer?.id || '') && ['starting', 'printing', 'paused'].includes(String(job.status || '')))
const queuedJobsForPrinter = (printer: any) => printJobs.value.filter((job: any) => String(job.printerId || '') === String(printer?.id || '') && String(job.status || '') === 'queued')
const isStatusFresh = (status: any) => status?.fetchedAt ? Date.now() - new Date(status.fetchedAt).getTime() < 120_000 : false
const printerBusyLabel = (printer: any) => {
  const liveStatus = liveStatusForPrinter(printer)
  const liveState = String(liveStatus?.state || '').toLowerCase()
  if (activeJobForPrinter(printer) || ['printing', 'busy', 'paused', 'starting'].includes(liveState)) return 'Ocupada'
  if (printer?.agentPrinterId && !isStatusFresh(liveStatus)) return 'Sem contato'
  return 'Livre'
}
const printerQueueSummary = (printer: any) => {
  const active = activeJobForPrinter(printer)
  const queued = queuedJobsForPrinter(printer).length
  return active ? `${printerBusyLabel(printer)}: ${active.title || active.productName || 'item atual'} | fila ${queued}` : `${printerBusyLabel(printer)} | fila ${queued}`
}
const seedPrinterStatusCache = () => {
  for (const printer of printers.value as any[]) {
    const agentPrinterId = String(printer?.agentPrinterId || '')
    if (!agentPrinterId || printerStatuses[agentPrinterId]) continue
    printerStatuses[agentPrinterId] = normalizePrinterStatus(printer, printer?.agentLastStatus || {})
  }
}
const refreshAllPrinterStatuses = async () => {
  if (printerStatusLoadingId.value || printerControlLoadingId.value) return
  const linkedPrinters = (printers.value as any[]).filter((printer) => printer?.agentId && printer?.agentPrinterId && supportsAgentCapability(printer, 'status'))
  for (const printer of linkedPrinters) {
    if (printerStatusLoadingId.value || printerControlLoadingId.value) break
    await loadPrinterStatus(printer, { silent: true }).catch(() => {})
  }
}
const formatDateTime = (value: any) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-'
const printReadinessError = (job: any) => {
  const product = productForJob(job) || job
  const printer = printers.value.find((item: any) => String(item.id || '') === String(job.printerId || (selected.value as any).id || '')) as any
  if (String(job.status || '') !== 'queued') return 'Somente itens pendentes podem ser iniciados.'
  if (!product) return 'Produto da fila não encontrado.'
  const quantity = Number(job.quantity || 0)
  if (!Number.isInteger(quantity) || quantity <= 0) return 'Quantidade da fila precisa ser maior que zero.'
  if (product.validationStatus !== 'validated') return product.validationMessage || 'Produto ainda não possui receita de impressão validada.'
  if (!product.printFileName || !product.printFileFormat) return 'Produto sem arquivo de impressão validado.'
  const format = String(product.printFileFormat || '').toLowerCase()
  if (!readyPrintFormats.includes(format)) return `Formato ${format.toUpperCase()} ainda não está liberado para impressão automática.`
  const extension = String(product.printFileName || '').split('.').pop()?.toLowerCase() || ''
  if (extension && extension !== format) return 'Extensão do arquivo não confere com o formato informado.'
  if (!supportsAgentCapability(printer, 'startPrint')) return 'Esta impressora não oferece início remoto de impressão.'
  const protocol = String(printer?.agentProtocol || '').toLowerCase()
  const allowed = allowedFormatsByProtocol[protocol] || readyPrintFormats
  if (protocol && !allowed.includes(format)) return `Formato ${format.toUpperCase()} não é recomendado para esta impressora.`
  const productDimensions = parseDimensions(product.dimensions)
  if (!productDimensions) return 'Produto sem dimensoes reais informadas.'
  const printerVolume = parseDimensions(printer?.volume)
  if (printerVolume && (productDimensions.x > printerVolume.x || productDimensions.y > printerVolume.y || productDimensions.z > printerVolume.z)) return `Produto excede o volume da impressora (${printer.volume}).`
  const materials = normalizeList(product.compatibility?.materials)
  const filament = filaments.value.find((item: any) => String(item.id || '') === String(product.filamentId || '')) as any
  const material = String(filament?.material || product.filament || '').trim().toLowerCase()
  if (materials.length && material && !materials.includes(material)) return `Material ${material.toUpperCase()} não está liberado para este produto.`
  const productNozzle = Number(product.compatibility?.nozzleMm || 0)
  const printerNozzle = Number(printer?.nozzleMm || 0)
  if (productNozzle <= 0) return 'Diâmetro do bico não informado no produto.'
  if (printerNozzle > 0 && Math.abs(productNozzle - printerNozzle) > 0.01) return `Receita exige bico de ${productNozzle} mm, mas a impressora usa ${printerNozzle} mm.`
  if (Number(product.layer || product.printProfile?.layerHeightMm || 0) <= 0) return 'Altura de camada não informada no produto.'
  const infill = Number(product.infill || product.printProfile?.infillPercent || 0)
  if (infill <= 0 || infill > 100) return 'Preenchimento precisa estar entre 1% e 100%.'
  return ''
}
const printJobStatusLabel = (status: string) => ({ awaiting_confirmation: 'Aguardando confirmação', queued: 'Na fila', starting: 'Iniciando', printing: 'Imprimindo', paused: 'Pausado', completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado' }[status] || status || '-')
const printJobBadgeClass = (status: string) => ({ awaiting_confirmation: 'badge--orange', queued: '', starting: 'badge--orange', printing: 'badge--orange', paused: 'badge--purple', completed: 'badge--green', failed: 'badge--red', cancelled: 'badge--red' }[status] || '')
const qualityApprovedFor = (job: any) => qualityApproved[String(job.id)] ?? Number(job.quantity || 0)
const approveQuality = async (job: any) => {
  const approved = Number(qualityApprovedFor(job))
  const rejected = Number(job.quantity || 0) - approved
  if (!Number.isInteger(approved) || approved < 0 || rejected < 0) return notify('Informe uma quantidade aprovada válida.', 'info')
  queueLoadingId.value = `quality:${job.id}`
  try { await approveProductionOutput(String(job.id), approved, rejected); notify(`Lote conferido: ${approved} aprovada(s) e ${rejected} refugada(s).`) }
  catch (error: any) { notify(error?.message || 'Não foi possível registrar a conferência.', 'info') }
  finally { queueLoadingId.value = '' }
}
const editPrinter = (printer: any) => {
  if (!printer.id) return
  router.push(`/impressoras/nova?id=${printer.id}`)
}
const newPrinterPath = '/impressoras/nova'
const removePrinter = async (printer: any) => {
  if (!printer.id || !window.confirm(`Excluir impressora?\n\n${printer.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('printers', printer.id)
  notify('Impressora excluída com sucesso.')
}
const tokenHeaders = () => {
  const token = useAuth().token.value
  if (!token) throw new Error('Sessão não encontrada.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}
const loadAgents = async () => {
  agentLoading.value = true
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents`, {
      headers: tokenHeaders()
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar os Agents.')
    agents.value = data.agents || []
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível carregar os Agents.', 'info')
  } finally {
    agentLoading.value = false
  }
}
const waitForCommandResult = async (commandId: string) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${config.public.apiBase}/api/agent-commands/${commandId}`, {
      headers: tokenHeaders()
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Não foi possível consultar o comando.')
    if (data.command?.status === 'completed') return data.command.result
    if (data.command?.status === 'failed') throw new Error(data.command?.result?.error || 'O comando falhou.')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('A operação demorou mais que o esperado.')
}
const assertAgentPrinterReady = (printer: any) => {
  if (!printer?.agentId || !printer?.agentPrinterId) {
    throw new Error('Esta impressora foi cadastrada manualmente e ainda não está vinculada ao Agent.')
  }
  const agent = agents.value.find((item) => String(item.id) === String(printer.agentId))
  if (!agent || !agentIsOnline(agent)) {
    throw new Error('O Agent desta impressora está offline.')
  }
  return agent
}
const loadPrinterStatus = async (printer: any, options: { silent?: boolean } = {}) => {
  if (!supportsAgentCapability(printer, 'status')) throw new Error('Esta impressora não oferece consulta remota de status.')
  const agent = assertAgentPrinterReady(printer)
  const agentPrinterId = String(printer.agentPrinterId)
  if (printerStatusLoadingId.value) return
  printerStatusLoadingId.value = agentPrinterId
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents/${agent.id}/printer-status`, {
      method: 'POST',
      headers: tokenHeaders(),
      body: JSON.stringify({ agentPrinterId })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Não foi possível solicitar o status.')
    const result = await waitForCommandResult(String(data.command.id))
    if (result?.success === false) throw new Error(result.error || 'Não foi possível consultar o status.')
    printerStatuses[agentPrinterId] = {
      ...(result?.status || {}),
      lastConnectionError: null,
      fetchedAt: new Date().toISOString()
    }
    if (!options.silent) notify('Status atualizado.')
    await refreshAppData()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível consultar o status.'
    printerStatuses[agentPrinterId] = {
      ...(printerStatuses[agentPrinterId] || {}),
      lastConnectionError: message
    }
    if (!options.silent) notify(message, 'info')
  } finally {
    printerStatusLoadingId.value = ''
  }
}
const controlPrinter = async (printer: any, action: 'pause' | 'resume' | 'cancel' | 'disconnect') => {
  if (!supportsAgentCapability(printer, action)) throw new Error(`Esta impressora não oferece o comando remoto: ${action}.`)
  const agent = assertAgentPrinterReady(printer)
  const agentPrinterId = String(printer.agentPrinterId)
  if (printerControlLoadingId.value) return
  if (action === 'cancel' && !window.confirm('Deseja realmente cancelar a impressão atual?')) return
  if (action === 'disconnect' && !window.confirm('Deseja desconectar esta impressora do Agent?')) return
  printerControlLoadingId.value = `${agentPrinterId}:${action}`
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents/${agent.id}/printer-${action}`, {
      method: 'POST',
      headers: tokenHeaders(),
      body: JSON.stringify({ agentPrinterId })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar o comando.')
    const result = await waitForCommandResult(String(data.command.id))
    if (result?.success === false) throw new Error(result.error || 'O comando não pôde ser executado.')
    const messages = { pause: 'Impressão pausada.', resume: 'Impressão retomada.', cancel: 'Impressão cancelada.', disconnect: 'Impressora desconectada do Agent.' }
    notify(messages[action])
    if (action === 'disconnect') {
      printerStatuses[agentPrinterId] = {
        state: 'disconnected',
        progress: '-',
        nozzleTemperature: '-',
        lastConnectionError: null
      }
      await refreshAppData()
    } else {
      await loadPrinterStatus(printer, { silent: true })
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível executar o comando.', 'info')
  } finally {
    printerControlLoadingId.value = ''
  }
}
const revokeSelectedAgent = async () => {
  const agent = selectedAgent.value
  if (!agent?.id || printerControlLoadingId.value) return
  if (!window.confirm(`Revogar o Agent deste computador?\n\n${agent.machineName || agent.name || 'PrintFlow Agent'}\n\nEle deixará de receber comandos até ser pareado novamente.`)) return
  printerControlLoadingId.value = `agent:${agent.id}:revoke`
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents/${agent.id}`, {
      method: 'DELETE',
      headers: tokenHeaders()
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Não foi possível revogar o Agent.')
    notify('Agent revogado. Pareie novamente para usar este computador.')
    await loadAgents()
    await refreshAppData()
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível revogar o Agent.', 'info')
  } finally {
    printerControlLoadingId.value = ''
  }
}
const addProductToQueue = async () => {
  const printer = selected.value as any
  const product = selectedQueueProduct.value as any
  if (!printer?.id) return
  if (!product?.id) {
    notify('Selecione um produto para adicionar na fila.', 'info')
    return
  }
  queueLoadingId.value = `add:${printer.id}`
  try {
    await enqueuePrintJob({
      productId: product.id,
      printerId: printer.id,
      agentPrinterId: printer.agentPrinterId || '',
      source: 'manual',
      title: product.name,
      productName: product.name,
      quantity: Math.max(1, Math.floor(Number(queueQuantity.value || 1))),
      priority: selectedPrinterJobs.value.length,
      status: 'queued',
      notes: 'Adicionado manualmente pela tela de impressoras'
    })
    queueProductId.value = ''
    queueQuantity.value = 1
    notify('Produto adicionado na fila da impressora.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível adicionar na fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const movePrintJob = async (job: any, direction: 'up' | 'down') => {
  if (!job?.id || queueLoadingId.value) return
  if (String(job.status || '') !== 'queued') {
    notify('Somente itens pendentes podem ter a ordem alterada.', 'info')
    return
  }
  const list = queuedPrintJobs.value
  const index = list.findIndex((item: any) => String(item.id) === String(job.id))
  const target = direction === 'up' ? list[index - 1] : list[index + 1]
  if (!target) return
  queueLoadingId.value = String(job.id)
  try {
    await reorderPrintJob(String(job.id), direction)
    notify('Ordem da fila atualizada.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível atualizar a fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const changePrintJobPrinter = async (job: any, printerId: string) => {
  const targetPrinter = printers.value.find((printer: any) => String(printer.id || '') === String(printerId || '')) as any
  if (!job?.id || !targetPrinter?.id || queueLoadingId.value) return
  if (!['queued', 'awaiting_confirmation'].includes(String(job.status || ''))) {
    notify('Somente itens pendentes podem ser movidos para outra impressora.', 'info')
    return
  }
  queueLoadingId.value = String(job.id)
  try {
    await movePrintJobPrinter(String(job.id), String(targetPrinter.id), String(targetPrinter.agentPrinterId || ''))
    notify('Item movido para outra impressora.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível atualizar a fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const startPrintJob = async (job: any) => {
  const printer = (printers.value.find((item: any) => String(item.id || '') === String(job.printerId || '')) || selected.value) as any
  if (activePrintJob.value && String(activePrintJob.value.id) !== String(job.id) && !window.confirm('Esta impressora já possui uma impressão em andamento. Deseja iniciar outro item mesmo assim?')) return
  if (!job?.id || queueLoadingId.value) return
  if (String(job.status || '') !== 'queued') {
    notify('Somente itens na fila podem ser iniciados.', 'info')
    return
  }
  const readinessError = printReadinessError(job)
  if (readinessError) {
    notify(readinessError, 'info')
    return
  }
  if (!printer?.agentId || !printer?.agentPrinterId) {
    queueLoadingId.value = String(job.id)
    try {
      await startManualPrintJob(String(job.id))
      notify('Impressão iniciada na fila.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível iniciar a impressão.', 'info')
    } finally {
      queueLoadingId.value = ''
    }
    return
  }
  const agent = assertAgentPrinterReady(printer)
  queueLoadingId.value = String(job.id)
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents/${agent.id}/printer-start`, {
      method: 'POST',
      headers: tokenHeaders(),
      body: JSON.stringify({
        agentPrinterId: printer.agentPrinterId,
        printJobId: job.id
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Não foi possível iniciar a impressão.')
    const result = await waitForCommandResult(String(data.command.id))
    if (result?.success === false) throw new Error(result.error || 'O Agent não conseguiu iniciar a impressão.')
    notify('Impressão iniciada pelo Agent.')
    await refreshAppData()
    await loadPrinterStatus(printer, { silent: true })
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível iniciar a impressão.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const prepareNextGcode = async () => {
  const job = nextJobNeedingGcode.value as any
  const printer = selected.value as any
  if (!job || !printer?.agentId || !printer?.agentPrinterId || queueLoadingId.value) return
  if (!window.confirm(`Preparar G-code com OrcaSlicer?\n\n${job.title || job.productName || 'Production Job'}\n\nA impressora nao sera iniciada.`)) return
  const agent = assertAgentPrinterReady(printer)
  queueLoadingId.value = String(job.id)
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents/${agent.id}/printer-slice`, {
      method: 'POST', headers: tokenHeaders(),
      body: JSON.stringify({ agentPrinterId: printer.agentPrinterId, printJobId: job.id })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Nao foi possivel preparar o G-code.')
    const result = await waitForCommandResult(String(data.command.id))
    if (result?.success === false) throw new Error(result.error || 'O Agent nao conseguiu preparar o G-code.')
    notify('G-code preparado pelo Agent. A impressora nao foi iniciada.')
    await refreshAppData()
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel preparar o G-code.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const approvePrintJob = async (job: any) => {
  if (!job?.id || queueLoadingId.value) return
  if (String(job.status || '') !== 'awaiting_confirmation') {
    notify('Este item não está aguardando confirmação.', 'info')
    return
  }
  if (!window.confirm(`Liberar pedido para impressão?\n\n${job.title || job.productName || 'Pedido'}\n\nDepois da confirmação ele entrará na fila desta impressora.`)) return
  queueLoadingId.value = String(job.id)
  try {
    await approveMarketplacePrintJob(String(job.id))
    notify('Pedido liberado para a fila de impressão.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível liberar o pedido.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const completePrintJob = async (job: any) => {
  if (!job?.id || queueLoadingId.value) return
  queueLoadingId.value = String(job.id)
  try {
    await completeQueuedPrintJob(String(job.id))
    notify('Impressão concluída.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível concluir o item da fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const cancelPrintJob = async (job: any) => {
  const title = job.title || job.productName || 'Impressão'
  const status = printJobStatusLabel(String(job.status || ''))
  if (String(job.status || '') === 'starting') {
    notify('A impressão está iniciando. Aguarde a resposta do Agent ou cancele pela impressora.', 'info')
    return
  }
  if (!window.confirm(`Confirmar cancelamento de impressão?\n\nItem: ${title}\nStatus: ${status}\n\nEsta ação remove o item da fila. Se a impressão já estiver rodando fisicamente, use também o botão Cancelar da impressora.`)) return
  if (!job?.id || queueLoadingId.value) return
  queueLoadingId.value = String(job.id)
  try {
    await cancelQueuedPrintJob(String(job.id))
    notify('Item cancelado na fila.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível cancelar o item da fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const retryJob = async (job: any) => {
  if (!job?.id || queueLoadingId.value) return
  if (!window.confirm(`Criar uma nova tentativa de impressão?\n\n${job.title || job.productName || 'Impressão'}\n\nO histórico anterior será preservado.`)) return
  queueLoadingId.value = String(job.id)
  try {
    await retryPrintJob(String(job.id))
    notify('Nova tentativa adicionada à fila.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível criar uma nova tentativa.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
onMounted(() => {
  seedPrinterStatusCache()
  loadAgents().then(() => refreshAllPrinterStatuses()).catch(() => {})
  statusRefreshTimer.value = setInterval(() => {
    refreshAllPrinterStatuses().catch(() => {})
  }, 30_000)
})
watch(printers, () => {
  seedPrinterStatusCache()
})
onBeforeUnmount(() => {
  if (statusRefreshTimer.value) {
    clearInterval(statusRefreshTimer.value)
    statusRefreshTimer.value = null
  }
})
</script>

<template>
  <div class="printer-page">
    <PageHeader title="Impressoras" subtitle="Acompanhe o parque de máquinas, a produção em andamento e as próximas peças da fila.">
      <NuxtLink class="btn btn--primary" :to="newPrinterPath"><UiIcon name="plus" />Nova impressora</NuxtLink>
    </PageHeader>

    <section v-if="pendingQualityJobs.length" class="quality-workbench">
      <div class="quality-workbench__intro">
        <span class="quality-workbench__icon"><UiIcon name="alert" :size="20" /></span>
        <div><strong>Peças aguardando conferência</strong><small>Aprove o lote antes de liberar as unidades para o estoque.</small></div>
        <span class="quality-workbench__count">{{ pendingQualityJobs.length }}</span>
      </div>
      <div class="quality-workbench__jobs">
        <article v-for="job in pendingQualityJobs" :key="job.id" class="quality-job">
          <div><strong>{{ job.title || job.productName }}</strong><small>{{ job.quantity }} produzida(s) · {{ job.fulfillmentStatus || 'produção avulsa' }}</small></div>
          <label class="quality-job__field"><span>Peças boas</span><input v-model.number="qualityApproved[String(job.id)]" type="number" min="0" :max="job.quantity"></label>
          <div class="quality-job__reject"><small>Refugo</small><strong>{{ Math.max(0, Number(job.quantity || 0) - Number(qualityApprovedFor(job))) }}</strong></div>
          <button type="button" class="btn btn--primary" :disabled="queueLoadingId !== ''" @click="approveQuality(job)">{{ queueLoadingId === `quality:${job.id}` ? 'Salvando...' : 'Conferir lote' }}</button>
        </article>
      </div>
    </section>

    <div class="metrics-grid metrics-grid--5">
      <MetricCard label="Impressoras Ativas" :value="formatNumber(metrics.activePrinters.value)" icon="printer" note="Dados do banco" color="green" :points="printerCountPoints" />
      <MetricCard label="Em Impressão" :value="formatNumber(metrics.printingPrinters.value)" icon="play" note="Filas ativas" :points="printingPoints" />
      <MetricCard label="Em Manutenção" :value="formatNumber(metrics.maintenancePrinters.value)" icon="wrench" note="Dados do banco" color="orange" negative :points="maintenancePoints" />
      <MetricCard label="Horas Acumuladas" :value="`${formatNumber(metrics.printerHours.value)} h`" icon="clock" note="Horas registradas" color="purple" :points="printerHoursPoints" />
      <MetricCard label="Custo do kWh" :value="formatCurrency(0.68)" icon="bolt" note="Config. do sistema" color="cyan" negative :points="[0.68]" />
    </div>

    <section class="fleet-workspace">
      <header class="fleet-toolbar">
        <div class="fleet-toolbar__title">
          <span class="fleet-toolbar__eyebrow">Chão de fábrica</span>
          <h2>Parque de máquinas</h2>
          <p>Selecione um equipamento para abrir o console operacional.</p>
        </div>
        <div class="fleet-toolbar__count"><strong>{{ filteredPrinters.length }}</strong><span>de {{ printers.length }}<br>visíveis</span></div>
      </header>
      <div class="fleet-filterbar">
        <div class="fleet-filterbar__label"><UiIcon name="printer" :size="16" /><span><strong>Filtrar parque</strong><small>Refine a lista de equipamentos</small></span></div>
        <div class="fleet-filters">
          <label><span>Status</span><select v-model="printerStatusFilter"><option v-for="option in printerStatusOptions" :key="option">{{ option }}</option></select></label>
          <label><span>Fabricante</span><select v-model="printerMakerFilter"><option v-for="option in printerMakerOptions" :key="option">{{ option }}</option></select></label>
          <label><span>Modelo</span><select v-model="printerModelFilter"><option v-for="option in printerModelOptions" :key="option">{{ option }}</option></select></label>
          <button class="btn fleet-filters__clear" type="button" @click="clearPrinterFilters"><UiIcon name="close" />Limpar</button>
        </div>
      </div>

      <div class="fleet-grid">
        <div class="machine-roster">
          <div v-if="!filteredPrinters.length" class="machine-roster__empty">
            <span><UiIcon name="printer" :size="28" /></span>
            <h3>Nenhuma impressora encontrada</h3>
            <p>Ajuste os filtros ou cadastre o primeiro equipamento.</p>
          </div>

          <article
            v-for="p in filteredPrinters"
            :key="p.id || p.code"
            class="machine-card"
            :class="{ 'machine-card--selected': String(p.id || p.code) === String(selected.id || selected.code) }"
            tabindex="0"
            @click="selectPrinter(p)"
            @keydown.enter="selectPrinter(p)"
          >
            <div class="machine-card__identity">
              <span class="machine-card__icon"><UiIcon name="printer" :size="25" /><i :class="{ 'is-busy': activeJobForPrinter(p), 'is-offline': p.agentPrinterId && !isStatusFresh(liveStatusForPrinter(p)) }" /></span>
              <div><strong>{{ p.name }}</strong><small>{{ p.maker || 'Fabricante não informado' }} · {{ p.model || 'Modelo não informado' }}</small><code>{{ p.code || 'Sem código' }}</code></div>
            </div>
            <div class="machine-card__state">
              <span class="badge" :class="activeJobForPrinter(p) ? 'badge--orange' : badgeClass(p.status)">{{ activeJobForPrinter(p) ? 'Ocupada' : displayStatus(p.status) }}</span>
              <strong>{{ liveStatusForPrinter(p)?.progress ?? 0 }}%</strong>
              <small>{{ queuedJobsForPrinter(p).length }} na fila</small>
            </div>
            <div class="machine-card__job">
              <div><span>{{ activeJobForPrinter(p)?.title || activeJobForPrinter(p)?.productName || 'Sem trabalho em andamento' }}</span><small>{{ p.agentPrinterId ? printerBusyLabel(p) : 'Operação manual' }}</small></div>
              <div class="machine-card__progress"><i :style="{ width: `${Math.min(100, Math.max(0, Number(liveStatusForPrinter(p)?.progress || 0)))}%` }" /></div>
            </div>
            <div class="machine-card__telemetry">
              <span><small>Bico</small><strong>{{ liveStatusForPrinter(p)?.nozzleTemperature ?? '—' }}°</strong></span>
              <span><small>Mesa</small><strong>{{ liveStatusForPrinter(p)?.bedTemperature ?? '—' }}°</strong></span>
              <span><small>Uso</small><strong>{{ p.hours || 0 }} h</strong></span>
              <span><small>Última manutenção</small><strong>{{ p.maintenance || 'Não informada' }}</strong></span>
            </div>
            <div class="machine-card__actions">
              <button class="row-action row-action--edit" type="button" title="Editar impressora" @click.stop="editPrinter(p)"><UiIcon name="edit" :size="15" /></button>
              <button class="row-action" type="button" title="Excluir impressora" @click.stop="removePrinter(p)"><UiIcon name="close" :size="16" /></button>
            </div>
          </article>
        </div>

        <aside class="machine-console">
          <template v-if="selected.id">
            <header class="machine-console__head">
              <div class="machine-console__identity">
                <span><UiIcon name="printer" :size="32" /></span>
                <div><small>Console da máquina</small><h2>{{ selected.name }}</h2><p>{{ selected.maker }} {{ selected.model }} · {{ selected.code }}</p></div>
              </div>
              <button class="btn" type="button" @click="editPrinter(selected)"><UiIcon name="edit" :size="15" />Editar</button>
            </header>

            <div class="machine-console__signal" :class="{ 'machine-console__signal--offline': selectedAgentPrinterId && selectedAgentStatus !== 'Agent online' }">
              <span class="signal-pulse" />
              <div><strong>{{ selectedAgentStatus }}</strong><small>{{ selectedAgentPrinterId ? `Último contato: ${formatDateTime(selectedLiveStatus?.fetchedAt)}` : 'Controle e apontamento feitos manualmente' }}</small></div>
              <span class="badge" :class="activePrintJob ? 'badge--orange' : badgeClass(selected.status)">{{ activePrintJob ? printJobStatusLabel(activePrintJob.status) : displayStatus(selected.status) }}</span>
            </div>

            <div v-if="nextJobNeedingGcode && selected?.agentId && selected?.agentPrinterId" class="machine-callout">
              <div><strong>3MF aguardando preparo</strong><small>O OrcaSlicer pode gerar o G-code do próximo item sem iniciar a impressora.</small></div>
              <button type="button" class="btn" :disabled="queueLoadingId !== ''" @click="prepareNextGcode">Preparar G-code</button>
            </div>

            <section class="production-focus">
              <div class="section-label"><span>Produção atual</span><small>{{ activePrintJob ? 'Em acompanhamento' : 'Máquina disponível' }}</small></div>
              <div v-if="activePrintJob" class="current-job">
                <div class="current-job__top"><div><small>Peça em produção</small><h3>{{ activePrintJob.title || activePrintJob.productName }}</h3></div><strong>{{ selectedLiveStatus?.progress ?? 0 }}%</strong></div>
                <div class="current-job__track"><i :style="{ width: `${Math.min(100, Math.max(0, Number(selectedLiveStatus?.progress || 0)))}%` }" /></div>
                <div class="current-job__meta"><span><small>Quantidade</small><strong>{{ activePrintJob.quantity || 1 }}</strong></span><span><small>Estado</small><strong>{{ selectedLiveStatus?.state || printJobStatusLabel(activePrintJob.status) }}</strong></span><span><small>Arquivo</small><strong>{{ selectedLiveStatus?.file || productForJob(activePrintJob)?.printFileName || '—' }}</strong></span></div>
              </div>
              <div v-else class="production-idle"><span><UiIcon name="play" :size="22" /></span><div><strong>Pronta para o próximo trabalho</strong><small>{{ queuedPrintJobs.length ? `${queuedPrintJobs.length} item(ns) aguardando na fila.` : 'A fila desta máquina está vazia.' }}</small></div></div>
            </section>

            <section v-if="selectedAgentPrinterId" class="telemetry-panel">
              <div class="section-label"><span>Telemetria ao vivo</span><button type="button" class="text-action" :disabled="printerStatusLoadingId === selectedAgentPrinterId" @click="loadPrinterStatus(selected)">{{ printerStatusLoadingId === selectedAgentPrinterId ? 'Atualizando...' : 'Atualizar leitura' }}</button></div>
              <div class="telemetry-grid">
                <div><small>Bico</small><strong>{{ selectedLiveStatus?.nozzleTemperature ?? '—' }}<span>°C</span></strong></div>
                <div><small>Mesa</small><strong>{{ selectedLiveStatus?.bedTemperature ?? '—' }}<span>°C</span></strong></div>
                <div><small>Progresso</small><strong>{{ selectedLiveStatus?.progress ?? '—' }}<span>%</span></strong></div>
                <div><small>Estado</small><strong class="telemetry-grid__state">{{ selectedLiveStatus?.state || 'Sem leitura' }}</strong></div>
              </div>
              <p v-if="selectedLiveStatus?.lastConnectionError" class="machine-error">{{ selectedLiveStatus.lastConnectionError }}</p>
              <div class="machine-controls">
                <button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'pause')">Pausar</button>
                <button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'resume')">Retomar</button>
                <button type="button" class="btn btn--danger" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'cancel')">Cancelar impressão</button>
                <button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'disconnect')">Desconectar</button>
                <button type="button" class="btn btn--danger" :disabled="printerControlLoadingId !== ''" @click="revokeSelectedAgent">Revogar Agent</button>
              </div>
            </section>

            <section class="queue-workbench">
              <div class="section-label"><span>Fila desta máquina</span><small>{{ selectedPrinterJobs.length }} item(ns)</small></div>
              <div class="queue-composer">
                <label><span>Produto</span><select v-model="queueProductId"><option value="">Selecionar produto</option><option v-for="product in products" :key="product.id || product.sku" :value="product.id">{{ product.name }}</option></select></label>
                <label class="queue-composer__qty"><span>Qtd.</span><input v-model.number="queueQuantity" type="number" min="1"></label>
                <button type="button" class="btn btn--primary" :disabled="!queueProductId || queueLoadingId !== ''" @click="addProductToQueue">Adicionar</button>
              </div>
              <div v-if="!selectedPrinterJobs.length" class="queue-empty"><strong>Fila livre</strong><small>Adicione um produto para preparar o próximo trabalho.</small></div>
              <article v-for="(job, index) in selectedPrinterJobs" :key="job.id" class="queue-item">
                <div class="queue-item__order">{{ index + 1 }}</div>
                <div class="queue-item__body">
                  <div class="queue-item__head"><div><strong>{{ job.title || job.productName }}</strong><small>{{ job.quantity }} unidade(s)</small></div><span class="badge" :class="printJobBadgeClass(job.status)">{{ printJobStatusLabel(job.status) }}</span></div>
                  <div class="queue-item__checks"><span class="badge" :class="productValidationBadgeClass(productForJob(job))">Receita: {{ productValidationLabel(productForJob(job)) }}</span><select :value="job.printerId" @change="changePrintJobPrinter(job, ($event.target as HTMLSelectElement).value)"><option v-for="printer in printers" :key="printer.id || printer.code" :value="printer.id">{{ printer.name }}</option></select></div>
                  <p v-if="printReadinessError(job)" class="queue-item__error">{{ printReadinessError(job) }}</p>
                  <div class="queue-item__actions">
                    <button v-if="job.status === 'queued'" type="button" class="text-action" :disabled="queueLoadingId !== ''" @click="movePrintJob(job, 'up')">Subir</button>
                    <button v-if="job.status === 'queued'" type="button" class="text-action" :disabled="queueLoadingId !== ''" @click="movePrintJob(job, 'down')">Descer</button>
                    <button v-if="job.status === 'awaiting_confirmation'" type="button" class="btn btn--primary" :disabled="queueLoadingId !== '' || Boolean(printReadinessError(job))" @click="approvePrintJob(job)">Confirmar pedido</button>
                    <button v-if="job.status === 'queued'" type="button" class="btn btn--primary" :disabled="queueLoadingId !== '' || Boolean(printReadinessError(job))" @click="startPrintJob(job)">Iniciar</button>
                    <button v-if="job.status === 'printing'" type="button" class="btn" :disabled="queueLoadingId !== ''" @click="completePrintJob(job)">Concluir</button>
                    <button v-if="['failed', 'cancelled'].includes(job.status) || (job.status === 'completed' && Number(job.rejectedQuantity || 0) > 0)" type="button" class="btn" :disabled="queueLoadingId !== ''" @click="retryJob(job)">Tentar novamente</button>
                    <button v-if="['awaiting_confirmation', 'queued', 'printing', 'paused', 'starting'].includes(job.status)" type="button" class="text-action text-action--danger" :disabled="queueLoadingId !== ''" @click="cancelPrintJob(job)">Remover</button>
                  </div>
                </div>
              </article>
            </section>

            <section class="machine-specs">
              <div><small>Potência</small><strong>{{ selected.power || 0 }} W</strong></div>
              <div><small>Volume útil</small><strong>{{ selected.volume || 'Não informado' }}</strong></div>
              <div><small>Filamento padrão</small><strong>{{ selected.defaultFilament || 'Não informado' }}</strong></div>
              <div><small>Custo mensal estimado</small><strong class="money-positive">{{ formatCurrency(energyCost) }}</strong></div>
              <div><small>Número de série</small><strong>{{ selected.serial || 'Não informado' }}</strong></div>
              <div><small>Horas acumuladas</small><strong>{{ selected.hours || 0 }} h</strong></div>
            </section>
          </template>

          <div v-else class="machine-console__empty">
            <span><UiIcon name="printer" :size="36" /></span>
            <h3>Selecione uma impressora</h3>
            <p>O console exibirá o trabalho atual, a telemetria e a fila do equipamento.</p>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.printer-page { --machine-navy:#101a2c; --machine-panel:#f7f9fc; }
.quality-workbench { margin-bottom:16px; overflow:hidden; border:1px solid #f2d09a; border-radius:14px; background:#fffdf8; box-shadow:var(--shadow); }
.quality-workbench__intro { display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid #f3e4c8; }
.quality-workbench__icon { display:grid; width:38px; height:38px; place-items:center; border-radius:10px; color:#a65d00; background:#fff0d2; }
.quality-workbench__intro div { min-width:0; flex:1; }.quality-workbench__intro strong,.quality-workbench__intro small { display:block; }.quality-workbench__intro strong { font-size:13px; }.quality-workbench__intro small { margin-top:3px; color:var(--muted); font-size:10px; }
.quality-workbench__count { display:grid; min-width:28px; height:28px; place-items:center; border-radius:50%; color:#8a4c00; background:#ffe8bd; font-size:11px; font-weight:800; }
.quality-workbench__jobs { display:grid; gap:1px; background:#f3e4c8; }.quality-job { display:grid; grid-template-columns:minmax(180px,1fr) 100px 68px auto; align-items:end; gap:12px; padding:13px 16px; background:#fff; }
.quality-job > div:first-child strong,.quality-job > div:first-child small { display:block; }.quality-job > div:first-child small { margin-top:3px; color:var(--muted); font-size:10px; }
.quality-job__field span,.quality-job__reject small { display:block; margin-bottom:5px; color:var(--muted); font-size:9px; font-weight:700; }.quality-job__field input { width:100%; }.quality-job__reject strong { font-size:16px; }
.fleet-workspace { overflow:hidden; border:1px solid var(--line); border-radius:16px; background:#fff; box-shadow:var(--shadow); }
.fleet-toolbar { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:18px 20px 15px; background:linear-gradient(135deg,#fff 0%,#f7faff 100%); }
.fleet-toolbar__eyebrow { color:var(--blue); font-size:9px; font-weight:850; letter-spacing:.13em; text-transform:uppercase; }.fleet-toolbar__title h2 { margin:4px 0 2px; font-size:18px; }.fleet-toolbar__title p { margin:0; color:var(--muted); font-size:10px; }
.fleet-toolbar__count { display:flex; align-items:center; gap:8px; min-width:92px; justify-content:flex-end; }.fleet-toolbar__count strong { font-size:25px; line-height:1; font-variant-numeric:tabular-nums; }.fleet-toolbar__count span { color:var(--muted); font-size:8px; font-weight:700; line-height:1.25; text-transform:uppercase; }
.fleet-filterbar { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; border-top:1px solid #edf1f6; border-bottom:1px solid var(--line); background:#f8fafc; padding:11px 20px; }
.fleet-filterbar__label { display:flex; align-items:center; gap:9px; color:#52627a; }.fleet-filterbar__label > .ui-icon { color:var(--blue); }.fleet-filterbar__label span,.fleet-filterbar__label strong,.fleet-filterbar__label small { display:block; }.fleet-filterbar__label strong { color:var(--ink); font-size:10px; }.fleet-filterbar__label small { margin-top:2px; color:var(--muted); font-size:8px; }
.fleet-filters { display:flex; align-items:flex-end; gap:8px; }.fleet-filters label { display:grid; gap:5px; }.fleet-filters label span { color:var(--muted); font-size:9px; font-weight:700; }.fleet-filters select { min-width:125px; height:35px; }.fleet-filters__clear { height:35px; }
.fleet-grid { display:grid; grid-template-columns:minmax(360px,.92fr) minmax(480px,1.35fr); min-height:620px; }
.machine-roster { display:grid; align-content:start; gap:9px; padding:14px; border-right:1px solid var(--line); background:#f5f7fa; }
.machine-card { position:relative; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:11px 14px; border:1px solid #dfe4eb; border-radius:13px; background:#fff; padding:14px; cursor:pointer; outline:none; transition:border-color .16s var(--ease-out),box-shadow .16s var(--ease-out),transform .16s var(--ease-out); }
.machine-card:hover,.machine-card:focus-visible { border-color:#a9c7fb; box-shadow:0 8px 24px rgba(25,44,84,.08); transform:translateY(-1px); }.machine-card--selected { border-color:var(--blue); box-shadow:inset 3px 0 0 var(--blue),0 9px 26px rgba(23,104,242,.11); }
.machine-card__identity { display:flex; align-items:center; gap:11px; min-width:0; }.machine-card__icon { position:relative; display:grid; width:44px; height:44px; flex:0 0 auto; place-items:center; border-radius:11px; color:var(--blue); background:var(--blue-soft); }
.machine-card__icon i { position:absolute; right:-1px; bottom:-1px; width:10px; height:10px; border:2px solid #fff; border-radius:50%; background:var(--green); }.machine-card__icon i.is-busy { background:var(--orange); }.machine-card__icon i.is-offline { background:var(--red); }
.machine-card__identity div { min-width:0; }.machine-card__identity strong,.machine-card__identity small,.machine-card__identity code { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.machine-card__identity strong { font-size:13px; }.machine-card__identity small { margin-top:3px; color:var(--muted); font-size:10px; }.machine-card__identity code { margin-top:5px; color:#52627a; font:700 9px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.06em; }
.machine-card__state { display:grid; justify-items:end; align-content:start; gap:5px; }.machine-card__state > strong { font-size:17px; font-variant-numeric:tabular-nums; }.machine-card__state > small { color:var(--muted); font-size:9px; }
.machine-card__job { grid-column:1/-1; }.machine-card__job > div:first-child { display:flex; justify-content:space-between; gap:12px; }.machine-card__job span { overflow:hidden; color:#334155; font-size:10px; font-weight:750; text-overflow:ellipsis; white-space:nowrap; }.machine-card__job small { flex:0 0 auto; color:var(--muted); font-size:9px; }
.machine-card__progress { height:5px; overflow:hidden; border-radius:99px; background:#e9edf3; margin-top:7px; }.machine-card__progress i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--blue),#47a2ff); transition:width .3s ease; }
.machine-card__telemetry { grid-column:1/-1; display:grid; grid-template-columns:repeat(4,1fr); gap:1px; overflow:hidden; border:1px solid #edf0f4; border-radius:8px; background:#edf0f4; }.machine-card__telemetry span { min-width:0; padding:7px 8px; background:#fafbfd; }.machine-card__telemetry small,.machine-card__telemetry strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.machine-card__telemetry small { color:var(--muted); font-size:8px; }.machine-card__telemetry strong { margin-top:2px; font-size:9px; }
.machine-card__actions { position:absolute; top:10px; right:88px; display:flex; gap:3px; opacity:0; transition:opacity .16s ease; }.machine-card:hover .machine-card__actions,.machine-card:focus-within .machine-card__actions { opacity:1; }
.machine-roster__empty { display:grid; min-height:280px; place-items:center; align-content:center; text-align:center; }.machine-roster__empty > span,.machine-console__empty > span { display:grid; width:64px; height:64px; place-items:center; border-radius:18px; color:var(--blue); background:var(--blue-soft); }.machine-roster__empty h3,.machine-console__empty h3 { margin:14px 0 5px; font-size:14px; }.machine-roster__empty p,.machine-console__empty p { max-width:260px; margin:0; color:var(--muted); font-size:10px; line-height:1.55; }
.machine-console { min-width:0; background:#fff; }.machine-console__head { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:18px 20px; border-bottom:1px solid var(--line); }
.machine-console__identity { display:flex; align-items:center; gap:12px; min-width:0; }.machine-console__identity > span { display:grid; width:50px; height:50px; flex:0 0 auto; place-items:center; border-radius:13px; color:#fff; background:var(--machine-navy); }.machine-console__identity div { min-width:0; }.machine-console__identity small { color:var(--blue); font-size:8px; font-weight:850; letter-spacing:.12em; text-transform:uppercase; }.machine-console__identity h2 { margin:4px 0 2px; overflow:hidden; font-size:17px; text-overflow:ellipsis; white-space:nowrap; }.machine-console__identity p { margin:0; overflow:hidden; color:var(--muted); font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
.machine-console__signal { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; padding:11px 20px; border-bottom:1px solid #dcefe6; background:#f2fbf6; }.machine-console__signal--offline { border-color:#f4d9d9; background:#fff6f6; }.signal-pulse { width:9px; height:9px; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px rgba(13,165,102,.13); }.machine-console__signal--offline .signal-pulse { background:var(--red); box-shadow:0 0 0 4px rgba(215,45,54,.1); }.machine-console__signal strong,.machine-console__signal small { display:block; }.machine-console__signal strong { font-size:10px; }.machine-console__signal small { margin-top:2px; color:var(--muted); font-size:9px; }
.machine-callout { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:14px 18px 0; border:1px solid #d8e6ff; border-radius:10px; background:#f5f9ff; padding:11px 12px; }.machine-callout strong,.machine-callout small { display:block; }.machine-callout strong { font-size:10px; }.machine-callout small { margin-top:3px; color:var(--muted); font-size:9px; }
.production-focus,.telemetry-panel,.queue-workbench { padding:18px 20px; border-bottom:1px solid var(--line); }.section-label { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:11px; }.section-label > span { font-size:10px; font-weight:850; letter-spacing:.08em; text-transform:uppercase; }.section-label > small { color:var(--muted); font-size:9px; }
.current-job { border-radius:13px; color:#fff; background:linear-gradient(135deg,#101a2c,#1e3456); padding:16px; box-shadow:0 12px 26px rgba(16,26,44,.18); }.current-job__top { display:flex; justify-content:space-between; gap:16px; }.current-job__top small { color:#aebbd0; font-size:9px; }.current-job__top h3 { margin:4px 0 0; font-size:15px; }.current-job__top > strong { font-size:24px; font-variant-numeric:tabular-nums; }.current-job__track { height:6px; overflow:hidden; border-radius:99px; background:rgba(255,255,255,.16); margin:14px 0; }.current-job__track i { display:block; height:100%; border-radius:inherit; background:#4c9bff; }.current-job__meta { display:grid; grid-template-columns:.7fr .9fr 1.4fr; gap:10px; }.current-job__meta small,.current-job__meta strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.current-job__meta small { color:#91a1ba; font-size:8px; }.current-job__meta strong { margin-top:3px; font-size:9px; }
.production-idle { display:flex; align-items:center; gap:12px; border:1px dashed #bfd0e7; border-radius:12px; background:#f8fbff; padding:16px; }.production-idle > span { display:grid; width:38px; height:38px; place-items:center; border-radius:50%; color:var(--green); background:var(--green-soft); }.production-idle strong,.production-idle small { display:block; }.production-idle strong { font-size:11px; }.production-idle small { margin-top:3px; color:var(--muted); font-size:9px; }
.telemetry-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }.telemetry-grid > div { min-width:0; border:1px solid var(--line); border-radius:10px; background:var(--machine-panel); padding:11px; }.telemetry-grid small { display:block; color:var(--muted); font-size:8px; text-transform:uppercase; }.telemetry-grid strong { display:block; margin-top:7px; font-size:19px; font-variant-numeric:tabular-nums; }.telemetry-grid strong span { margin-left:2px; color:var(--muted); font-size:9px; }.telemetry-grid__state { overflow:hidden; font-size:11px !important; text-overflow:ellipsis; white-space:nowrap; }.text-action { border:0; color:var(--blue); background:transparent; padding:3px; font-size:9px; font-weight:800; cursor:pointer; }.text-action:disabled { opacity:.45; cursor:not-allowed; }.text-action--danger { color:var(--red); }.machine-error { border-radius:8px; color:#a32931; background:#fff0f0; margin:10px 0 0; padding:9px; font-size:9px; }.machine-controls { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
.queue-composer { display:grid; grid-template-columns:minmax(0,1fr) 74px auto; align-items:end; gap:8px; margin-bottom:12px; }.queue-composer label { display:grid; gap:5px; }.queue-composer label span { color:var(--muted); font-size:9px; font-weight:700; }.queue-composer select,.queue-composer input { width:100%; }.queue-empty { display:grid; place-items:center; min-height:90px; border:1px dashed #cbd5e1; border-radius:10px; color:var(--muted); text-align:center; }.queue-empty strong,.queue-empty small { display:block; }.queue-empty strong { color:var(--ink); font-size:11px; }.queue-empty small { margin-top:3px; font-size:9px; }
.queue-item { display:grid; grid-template-columns:28px minmax(0,1fr); gap:10px; border-top:1px solid #edf0f4; padding:12px 0; }.queue-item__order { display:grid; width:28px; height:28px; place-items:center; border-radius:8px; color:#52627a; background:#eef2f7; font-size:10px; font-weight:850; }.queue-item__body { min-width:0; }.queue-item__head,.queue-item__checks,.queue-item__actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }.queue-item__head strong,.queue-item__head small { display:block; }.queue-item__head strong { font-size:11px; }.queue-item__head small { margin-top:3px; color:var(--muted); font-size:9px; }.queue-item__checks { justify-content:flex-start; margin-top:8px; }.queue-item__checks select { max-width:170px; height:28px; font-size:9px; }.queue-item__error { color:var(--red); margin:8px 0 0; font-size:9px; line-height:1.45; }.queue-item__actions { justify-content:flex-end; margin-top:9px; }
.machine-specs { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); }.machine-specs > div { min-width:0; padding:13px 16px; background:#fafbfd; }.machine-specs small,.machine-specs strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.machine-specs small { color:var(--muted); font-size:8px; text-transform:uppercase; }.machine-specs strong { margin-top:5px; font-size:10px; }.machine-console__empty { display:grid; min-height:620px; place-items:center; align-content:center; text-align:center; }
@media (max-width:1180px) { .fleet-filterbar { align-items:flex-start; flex-direction:column; }.fleet-filters { width:100%; flex-wrap:wrap; }.fleet-filters label { flex:1; }.fleet-filters select { width:100%; }.fleet-grid { grid-template-columns:340px minmax(0,1fr); }.machine-card__telemetry { grid-template-columns:1fr 1fr; }.telemetry-grid { grid-template-columns:1fr 1fr; } }
@media (max-width:900px) { .fleet-grid { grid-template-columns:1fr; }.machine-roster { border-right:0; border-bottom:1px solid var(--line); }.machine-console__empty { min-height:260px; }.quality-job { grid-template-columns:1fr 90px 60px; }.quality-job .btn { grid-column:1/-1; }.machine-card__actions { opacity:1; } }
@media (max-width:640px) { .fleet-toolbar { padding:15px; }.fleet-toolbar__count { min-width:auto; }.fleet-filterbar { padding:11px 15px; }.fleet-filterbar__label { display:none; }.fleet-filters { display:grid; grid-template-columns:1fr 1fr; }.fleet-filters label:last-of-type { grid-column:1/-1; }.fleet-filters__clear { width:100%; }.machine-roster { padding:9px; }.machine-card__telemetry { grid-template-columns:1fr 1fr; }.machine-console__head { align-items:flex-start; }.machine-console__head > .btn { padding-inline:9px; }.production-focus,.telemetry-panel,.queue-workbench { padding:15px; }.queue-composer { grid-template-columns:1fr 68px; }.queue-composer .btn { grid-column:1/-1; }.telemetry-grid,.machine-specs { grid-template-columns:1fr 1fr; }.current-job__meta { grid-template-columns:1fr 1fr; }.current-job__meta span:last-child { grid-column:1/-1; }.quality-job { grid-template-columns:1fr 1fr; }.quality-job > div:first-child,.quality-job .btn { grid-column:1/-1; } }
</style>
