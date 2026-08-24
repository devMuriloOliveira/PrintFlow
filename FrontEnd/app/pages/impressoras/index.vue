<script setup lang="ts">
const { products, printers, printJobs, filaments, createItem, updateItem, deleteItem, refreshAppData } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const config = useRuntimeConfig()
const selectedIndex = ref(0)
const emptyPrinter = { name: '', code: '', maker: '', model: '', acquired: '', power: 0, hours: 0, status: '', maintenance: '', serial: '' }
const selected = computed(() => printers.value[selectedIndex.value] || emptyPrinter)
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
const displayStatus=(s:string)=>s.replace('Disponivel', 'Disponível').replace('Em Impressao', 'Em Impressão').replace('Em Manutencao', 'Em Manutenção')
const badgeClass=(s:string)=>/Disponivel|Disponível/.test(s)?'badge--green':/Em Manutencao|Em Manutenção/.test(s)?'badge--orange':''
const agentIsOnline = (agent: any) => {
  if (!agent?.lastSeenAt) return false
  return Date.now() - new Date(agent.lastSeenAt).getTime() < 90_000
}
const selectedAgent = computed(() => agents.value.find((agent) => String(agent.id) === String((selected.value as any).agentId)))
const selectedAgentPrinterId = computed(() => String((selected.value as any).agentPrinterId || ''))
const selectedLiveStatus = computed(() => {
  const agentPrinterId = selectedAgentPrinterId.value
  return agentPrinterId ? printerStatuses[String(agentPrinterId)] : null
})
const selectedAgentStatus = computed(() => {
  if (!selectedAgentPrinterId.value) return 'Manual'
  if (!selectedAgent.value) return 'Agent não encontrado'
  return agentIsOnline(selectedAgent.value) ? 'Agent online' : 'Agent offline'
})
const selectedPrinterJobs = computed(() => printJobs.value
  .filter((job: any) => String(job.printerId || '') === String((selected.value as any).id || '') && !['completed', 'cancelled'].includes(String(job.status || '')))
  .sort((a: any, b: any) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))))
const activePrintJob = computed(() => selectedPrinterJobs.value.find((job: any) => ['printing', 'paused'].includes(String(job.status || ''))))
const queuedPrintJobs = computed(() => selectedPrinterJobs.value.filter((job: any) => String(job.status || '') === 'queued'))
const selectedQueueProduct = computed(() => products.value.find((product: any) => String(product.id || '') === String(queueProductId.value || '')))
const productForJob = (job: any) => products.value.find((product: any) => String(product.id || '') === String(job.productId || ''))
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
const readyPrintFormats = ['3mf', 'gcode', 'bgcode']
const normalizeList = (value: any) => Array.isArray(value) ? value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
const liveStatusForPrinter = (printer: any) => printer?.agentPrinterId ? printerStatuses[String(printer.agentPrinterId)] : null
const activeJobForPrinter = (printer: any) => printJobs.value.find((job: any) => String(job.printerId || '') === String(printer?.id || '') && ['printing', 'paused'].includes(String(job.status || '')))
const queuedJobsForPrinter = (printer: any) => printJobs.value.filter((job: any) => String(job.printerId || '') === String(printer?.id || '') && String(job.status || '') === 'queued')
const printerBusyLabel = (printer: any) => activeJobForPrinter(printer) ? 'Ocupada' : 'Livre'
const printerQueueSummary = (printer: any) => {
  const active = activeJobForPrinter(printer)
  const queued = queuedJobsForPrinter(printer).length
  return active ? `${printerBusyLabel(printer)}: ${active.title || active.productName || 'item atual'} | fila ${queued}` : `${printerBusyLabel(printer)} | fila ${queued}`
}
const formatDateTime = (value: any) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-'
const printReadinessError = (job: any) => {
  const product = productForJob(job) || job
  const printer = printers.value.find((item: any) => String(item.id || '') === String(job.printerId || (selected.value as any).id || '')) as any
  if (!product) return 'Produto da fila nao encontrado.'
  const quantity = Number(job.quantity || 0)
  if (!Number.isInteger(quantity) || quantity <= 0) return 'Quantidade da fila precisa ser maior que zero.'
  if (product.validationStatus !== 'validated') return product.validationMessage || 'Produto ainda nao possui receita de impressao validada.'
  if (!product.printFileName || !product.printFileFormat) return 'Produto sem arquivo de impressao validado.'
  const format = String(product.printFileFormat || '').toLowerCase()
  if (!readyPrintFormats.includes(format)) return `Formato ${format.toUpperCase()} ainda nao esta liberado para impressao automatica.`
  const extension = String(product.printFileName || '').split('.').pop()?.toLowerCase() || ''
  if (extension && extension !== format) return 'Extensao do arquivo nao confere com o formato informado.'
  const protocol = String(printer?.agentProtocol || '').toLowerCase()
  const allowed = allowedFormatsByProtocol[protocol] || readyPrintFormats
  if (protocol && !allowed.includes(format)) return `Formato ${format.toUpperCase()} nao e recomendado para esta impressora.`
  const productDimensions = parseDimensions(product.dimensions)
  if (!productDimensions) return 'Produto sem dimensoes reais informadas.'
  const printerVolume = parseDimensions(printer?.volume)
  if (printerVolume && (productDimensions.x > printerVolume.x || productDimensions.y > printerVolume.y || productDimensions.z > printerVolume.z)) return `Produto excede o volume da impressora (${printer.volume}).`
  const materials = normalizeList(product.compatibility?.materials)
  const filament = filaments.value.find((item: any) => String(item.id || '') === String(product.filamentId || '')) as any
  const material = String(filament?.material || product.filament || '').trim().toLowerCase()
  if (materials.length && material && !materials.includes(material)) return `Material ${material.toUpperCase()} nao esta liberado para este produto.`
  if (Number(product.compatibility?.nozzleMm || 0) <= 0) return 'Diametro do bico nao informado no produto.'
  if (Number(product.layer || product.printProfile?.layerHeightMm || 0) <= 0) return 'Altura de camada nao informada no produto.'
  if (Number(product.infill || product.printProfile?.infillPercent || 0) <= 0) return 'Preenchimento nao informado no produto.'
  return ''
}
const printJobStatusLabel = (status: string) => ({ queued: 'Na fila', printing: 'Imprimindo', paused: 'Pausado', completed: 'Concluido', cancelled: 'Cancelado' }[status] || status || '-')
const printJobBadgeClass = (status: string) => ({ queued: '', printing: 'badge--orange', paused: 'badge--purple', completed: 'badge--green', cancelled: 'badge--red' }[status] || '')
const editPrinter = (printer: any) => {
  if (!printer.id) return
  router.push(`/impressoras/nova?id=${printer.id}`)
}
const removePrinter = async (printer: any) => {
  if (!printer.id || !window.confirm(`Excluir impressora?\n\n${printer.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('printers', printer.id)
  notify('Impressora excluída com sucesso.')
}
const tokenHeaders = () => {
  const token = localStorage.getItem('printflow-auth-token')
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
  if (!window.confirm(`Revogar o Agent deste computador?\n\n${agent.machineName || agent.name || 'PrintFlow Agent'}\n\nEle deixara de receber comandos ate ser pareado novamente.`)) return
  printerControlLoadingId.value = `agent:${agent.id}:revoke`
  try {
    const response = await fetch(`${config.public.apiBase}/api/agents/${agent.id}`, {
      method: 'DELETE',
      headers: tokenHeaders()
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Nao foi possivel revogar o Agent.')
    notify('Agent revogado. Pareie novamente para usar este computador.')
    await loadAgents()
    await refreshAppData()
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel revogar o Agent.', 'info')
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
    await createItem('printJobs' as any, {
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
const updatePrintJob = async (job: any, patch: Record<string, any>, message: string) => {
  if (!job?.id || queueLoadingId.value) return
  queueLoadingId.value = String(job.id)
  try {
    await updateItem('printJobs' as any, {
      ...job,
      ...patch
    })
    notify(message)
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível atualizar a fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const movePrintJob = async (job: any, direction: 'up' | 'down') => {
  if (!job?.id || queueLoadingId.value) return
  const list = selectedPrinterJobs.value
  const index = list.findIndex((item: any) => String(item.id) === String(job.id))
  const target = direction === 'up' ? list[index - 1] : list[index + 1]
  if (!target) return
  queueLoadingId.value = String(job.id)
  try {
    const currentPriority = Number(job.priority || 0)
    const targetPriority = Number(target.priority || 0)
    await updateItem('printJobs' as any, { ...job, priority: targetPriority })
    await updateItem('printJobs' as any, { ...target, priority: currentPriority })
    notify('Ordem da fila atualizada.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel atualizar a fila.', 'info')
  } finally {
    queueLoadingId.value = ''
  }
}
const changePrintJobPrinter = async (job: any, printerId: string) => {
  const targetPrinter = printers.value.find((printer: any) => String(printer.id || '') === String(printerId || '')) as any
  if (!job?.id || !targetPrinter?.id || queueLoadingId.value) return
  await updatePrintJob(job, {
    printerId: targetPrinter.id,
    printerName: targetPrinter.name,
    agentPrinterId: targetPrinter.agentPrinterId || ''
  }, 'Item movido para outra impressora.')
}
const startPrintJob = async (job: any) => {
  const printer = (printers.value.find((item: any) => String(item.id || '') === String(job.printerId || '')) || selected.value) as any
  if (activePrintJob.value && String(activePrintJob.value.id) !== String(job.id) && !window.confirm('Esta impressora já possui uma impressão em andamento. Deseja iniciar outro item mesmo assim?')) return
  if (!job?.id || queueLoadingId.value) return
  const readinessError = printReadinessError(job)
  if (readinessError) {
    notify(readinessError, 'info')
    return
  }
  if (!printer?.agentId || !printer?.agentPrinterId) {
    await updatePrintJob(job, { status: 'printing', startedAt: new Date().toISOString() }, 'Impressão iniciada na fila.')
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
const completePrintJob = (job: any) => {
  void updatePrintJob(job, { status: 'completed', completedAt: new Date().toISOString() }, 'Impressão concluída.')
}
const cancelPrintJob = (job: any) => {
  if (!window.confirm(`Cancelar item da fila?\n\n${job.title || job.productName || 'Impressão'}`)) return
  void updatePrintJob(job, { status: 'cancelled', cancelledAt: new Date().toISOString() }, 'Item cancelado na fila.')
}
onMounted(() => {
  loadAgents()
  statusRefreshTimer.value = setInterval(() => {
    const printer = selected.value as any
    if (
      printer?.agentId &&
      printer?.agentPrinterId &&
      !printerStatusLoadingId.value &&
      !printerControlLoadingId.value
    ) {
      loadPrinterStatus(printer, { silent: true }).catch(() => {})
    }
  }, 30_000)
})
onBeforeUnmount(() => {
  if (statusRefreshTimer.value) {
    clearInterval(statusRefreshTimer.value)
    statusRefreshTimer.value = null
  }
})
</script>

<template>
  <div>
    <PageHeader title="Impressoras" subtitle="Gerencie suas impressoras 3D, acompanhe o status e o desempenho operacional."><NuxtLink class="btn btn--primary" to="/impressoras/nova"><UiIcon name="plus" />Nova Impressora</NuxtLink></PageHeader>
    <div class="metrics-grid metrics-grid--5"><MetricCard label="Impressoras Ativas" :value="formatNumber(metrics.activePrinters.value)" icon="printer" note="Dados do banco" color="green" /><MetricCard label="Em Impressão" :value="formatNumber(metrics.printingPrinters.value)" icon="play" note="Dados do banco" /><MetricCard label="Em Manutenção" :value="formatNumber(metrics.maintenancePrinters.value)" icon="wrench" note="Dados do banco" color="orange" negative /><MetricCard label="Horas Acumuladas" :value="`${formatNumber(metrics.printerHours.value)} h`" icon="clock" note="Dados do banco" color="purple" /><MetricCard label="Custo Médio de Energia" :value="formatCurrency(0.68)" icon="bolt" note="Config. do sistema" color="cyan" negative /></div>
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 390px">
      <div>
        <div class="filters"><div v-for="f in ['Status','Fabricante','Modelo']" :key="f" class="field"><label>{{f}}</label><select><option>Todos</option></select></div><button class="btn"><UiIcon name="close" />Limpar filtros</button></div>
        <PanelCard>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th></th><th>Nome</th><th>Fabricante</th><th>Modelo</th><th>Data de Aquisição</th><th>Potência</th><th>Horas Acumuladas</th><th>Status</th><th>Última Manutenção</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(p,i) in printers" :key="p.id || p.code" :class="{selected:i===selectedIndex}" @click="selectedIndex=i">
                  <td><input type="radio" :checked="i===selectedIndex"></td>
                  <td><div class="table-product table-product--editable"><span class="product-thumb"><UiIcon name="printer" :size="30" /></span><div><strong>{{p.name}}</strong><small>{{p.code}}</small><small>{{printerQueueSummary(p)}}</small></div><button class="row-action row-action--edit" title="Editar impressora" @click.stop="editPrinter(p)"><UiIcon name="edit" :size="15" /></button></div></td>
                  <td>{{p.maker}}</td>
                  <td>{{p.model}}</td>
                  <td>{{p.acquired}}</td>
                  <td>{{p.power}} W</td>
                  <td>{{p.hours}} h</td>
                  <td><span class="badge" :class="activeJobForPrinter(p) ? 'badge--orange' : badgeClass(p.status)">{{activeJobForPrinter(p) ? 'Ocupada' : displayStatus(p.status)}}</span><small style="display:block;margin-top:4px;color:var(--muted)">{{liveStatusForPrinter(p)?.progress ?? '-'}}% | {{liveStatusForPrinter(p)?.nozzleTemperature ?? '-'}} C</small></td>
                  <td>{{p.maintenance}}</td>
                  <td><button class="row-action" title="Excluir impressora" @click.stop="removePrinter(p)"><UiIcon name="close" :size="16" /></button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-footer"><span>Mostrando 1 a {{printers.length}} de {{printers.length}} impressoras</span><div class="pagination"><button class="page-btn active">1</button></div></div>
        </PanelCard>
      </div>
      <aside class="detail-card">
        <div class="detail-card__head"><span class="product-thumb" style="width:100px;height:100px"><UiIcon name="printer" :size="65" /></span><div><h3>{{selected.name}} <span class="badge badge--green">{{displayStatus(selected.status)}}</span></h3><p>Código: {{selected.code}}</p><p>Fabricante: {{selected.maker}}</p><p>Modelo: {{selected.model}}</p><p>Nº de Série: {{selected.serial}}</p><p>Conexão: {{selectedAgentStatus}}</p></div></div>
        <div class="detail-card__body"><div v-if="selectedAgentPrinterId" class="form-card" style="margin-bottom:12px"><h3 style="margin:0 0 10px;font-size:12px">PrintFlow Agent</h3><div class="detail-list"><div class="detail-list__row"><span>Status</span><strong>{{selectedAgentStatus}}</strong></div><div class="detail-list__row"><span>Estado</span><strong>{{selectedLiveStatus?.state || '-'}}</strong></div><div class="detail-list__row"><span>Item atual</span><strong>{{activePrintJob?.title || activePrintJob?.productName || selectedLiveStatus?.file || '-'}}</strong></div><div class="detail-list__row"><span>Fila vinculada</span><strong>{{queuedPrintJobs.length}} item(ns)</strong></div><div class="detail-list__row"><span>Progresso</span><strong>{{selectedLiveStatus?.progress ?? '-'}}%</strong></div><div class="detail-list__row"><span>Bico / mesa</span><strong>{{selectedLiveStatus?.nozzleTemperature ?? '-'}} / {{selectedLiveStatus?.bedTemperature ?? '-'}} C</strong></div><div class="detail-list__row"><span>Ultimo contato</span><strong>{{formatDateTime(selectedLiveStatus?.fetchedAt)}}</strong></div></div><div v-if="selectedLiveStatus?.lastConnectionError" class="summary-box" style="margin-top:10px"><div class="detail-list__row"><span>Erro</span><strong>{{selectedLiveStatus.lastConnectionError}}</strong></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn" :disabled="printerStatusLoadingId === selectedAgentPrinterId" @click="loadPrinterStatus(selected)">Atualizar</button><button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'pause')">Pausar</button><button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'resume')">Retomar</button><button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'cancel')">Cancelar</button><button type="button" class="btn" :disabled="printerControlLoadingId !== ''" @click="controlPrinter(selected, 'disconnect')">Desconectar</button><button type="button" class="btn btn--danger" :disabled="printerControlLoadingId !== ''" @click="revokeSelectedAgent">Revogar Agent</button></div></div><div v-if="selected.id" class="form-card" style="margin-bottom:12px"><h3 style="margin:0 0 10px;font-size:12px">Fila de impressão</h3><div class="form-grid"><div class="field col-7"><label>Produto</label><select v-model="queueProductId"><option value="">Selecionar produto</option><option v-for="product in products" :key="product.id || product.sku" :value="product.id">{{product.name}}</option></select></div><div class="field col-5"><label>Quantidade</label><input v-model.number="queueQuantity" type="number" min="1"></div><div class="col-12"><button type="button" class="btn btn--primary btn--wide" :disabled="!queueProductId || queueLoadingId !== ''" @click="addProductToQueue">Adicionar na fila</button></div></div><div class="summary-box"><div class="detail-list__row"><span>Em andamento</span><strong>{{activePrintJob?.title || activePrintJob?.productName || '-'}}</strong></div><div class="detail-list__row"><span>Fila</span><strong>{{queuedPrintJobs.length}}</strong></div></div><div v-if="!selectedPrinterJobs.length" style="margin-top:10px;color:var(--muted);font-size:10px">Nenhum item na fila desta impressora.</div><div v-for="job in selectedPrinterJobs" :key="job.id" class="summary-box"><div class="detail-list__row"><span>{{job.title || job.productName}}</span><strong><span class="badge" :class="printJobBadgeClass(job.status)">{{printJobStatusLabel(job.status)}}</span></strong></div><div class="detail-list__row"><span>Receita</span><strong><span class="badge" :class="productValidationBadgeClass(productForJob(job))">{{productValidationLabel(productForJob(job))}}</span></strong></div><div class="detail-list__row"><span>Impressora</span><strong><select :value="job.printerId" style="max-width:170px" @change="changePrintJobPrinter(job, ($event.target as HTMLSelectElement).value)"><option v-for="printer in printers" :key="printer.id || printer.code" :value="printer.id">{{printer.name}}</option></select></strong></div><div class="detail-list__row"><span>Quantidade</span><strong>{{job.quantity}}</strong></div><div v-if="printReadinessError(job)" style="margin-top:8px;color:var(--danger);font-size:10px">{{printReadinessError(job)}}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn" :disabled="queueLoadingId !== ''" @click="movePrintJob(job, 'up')">Subir</button><button type="button" class="btn" :disabled="queueLoadingId !== ''" @click="movePrintJob(job, 'down')">Descer</button><button v-if="job.status !== 'printing'" type="button" class="btn btn--primary" :disabled="queueLoadingId !== '' || Boolean(printReadinessError(job))" @click="startPrintJob(job)">Iniciar</button><button v-if="job.status === 'printing'" type="button" class="btn" :disabled="queueLoadingId !== ''" @click="completePrintJob(job)">Concluir</button><button type="button" class="btn btn--danger" :disabled="queueLoadingId !== ''" @click="cancelPrintJob(job)">Cancelar</button></div></div></div><div class="stat-strip"><div class="stat-box"><small>Potência</small><strong>{{selected.power}} W</strong></div><div class="stat-box"><small>Consumo Médio</small><strong>{{(selected.power/1000).toFixed(2)}} kWh</strong></div><div class="stat-box"><small>Horas (Mês)</small><strong>82 h</strong></div><div class="stat-box"><small>Custo kWh</small><strong>R$ 0,68</strong></div></div><div class="form-card" style="margin-top:12px"><h3 style="margin:0;font-size:12px">Cálculo de Custo de Energia</h3><p style="color:var(--muted);font-size:9px">Potência (kW) x Tempo (h) x Valor do kWh</p><div class="summary-box"><div class="detail-list__row"><span>Custo estimado mensal</span><strong class="money-positive">{{formatCurrency(energyCost)}}</strong></div></div></div><div class="form-card"><h3 style="margin:0 0 10px;font-size:12px">Informações Adicionais</h3><div class="detail-list"><div class="detail-list__row"><span>Localização</span><strong>Lab Principal</strong></div><div class="detail-list__row"><span>Volume de Impressão</span><strong>{{selected.volume || '220 x 220 x 250 mm'}}</strong></div><div class="detail-list__row"><span>Filamento Padrão</span><strong>{{selected.defaultFilament || 'PLA'}}</strong></div></div></div></div>
      </aside>
    </div>
  </div>
</template>
