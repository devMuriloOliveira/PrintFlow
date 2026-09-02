import { getTenantData } from '../data.js'
import { getTenantId } from '../config/tenant.js'
import { hasDatabase, withTenant } from '../db/pool.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { listResource } from '../repositories/appDataRepository.js'

const intOrNull = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const normalizeQuantity = (value) => {
  const parsed = Math.floor(Number(value ?? 1))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const itemId = (item) => String(item?.dbId || item?.id || '')

const queuedSort = (a, b) => {
  const priority = Number(b.priority || 0) - Number(a.priority || 0)
  if (priority) return priority
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
}

const localId = () => String(Date.now() + Math.floor(Math.random() * 1000))

const localPrintJobs = async (req) =>
  getTenantData(await getTenantId(req)).printJobs

const sendPrintJobs = async (req, res, status = 200) => {
  const tenantId = await getTenantId(req)
  const list = hasDatabase
    ? await listResource(tenantId, 'printJobs')
    : getTenantData(tenantId).printJobs

  return sendJson(res, status, list)
}

const findLocalJob = (list, id) =>
  list.find((item) => itemId(item) === String(id))

export const handlePrintJobEnqueue = async (req, res) => {
  const body = await readJsonBody(req)
  const tenantId = await getTenantId(req)
  const productId = intOrNull(body?.productId)
  const printerId = intOrNull(body?.printerId)
  const agentPrinterId = intOrNull(body?.agentPrinterId)

  if (!productId) {
    return sendJson(res, 400, { error: 'Produto obrigatorio para adicionar na fila.' })
  }

  if (!printerId) {
    return sendJson(res, 400, { error: 'Impressora obrigatoria para adicionar na fila.' })
  }

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const product = await client.query(
        'select id, name from products where tenant_id = $1 and id = $2 limit 1',
        [tenantId, productId]
      )

      if (!product.rowCount) throw new Error('Registro nao encontrado')

      const printer = await client.query(
        'select id, name, agent_printer_id from printers where tenant_id = $1 and id = $2 limit 1',
        [tenantId, printerId]
      )

      if (!printer.rowCount) throw new Error('Registro nao encontrado')

      if (agentPrinterId) {
        const agentPrinter = await client.query(
          `select id
             from agent_printers
            where tenant_id = $1
              and id = $2
              and printer_id is not distinct from $3::bigint
            limit 1`,
          [tenantId, agentPrinterId, printerId]
        )

        if (!agentPrinter.rowCount) throw new Error('Registro nao encontrado')
      }

      const priorityResult = await client.query(
        `select coalesce(max(priority), 0) + 1 as next_priority
           from print_jobs
          where tenant_id = $1
            and printer_id is not distinct from $2::bigint
            and status = 'queued'`,
        [tenantId, printerId]
      )

      await client.query(
        `insert into print_jobs (
           tenant_id,
           product_id,
           printer_id,
           agent_printer_id,
           source,
           title,
           quantity,
           priority,
           status,
           notes
         ) values (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           'queued',
           $9
         )`,
        [
          tenantId,
          productId,
          printerId,
          agentPrinterId,
          String(body?.source || 'manual'),
          String(body?.title || body?.productName || product.rows[0].name || ''),
          normalizeQuantity(body?.quantity),
          Number(priorityResult.rows[0]?.next_priority || 1),
          String(body?.notes || 'Adicionado manualmente pela tela de impressoras')
        ]
      )
    })

    return sendPrintJobs(req, res, 201)
  }

  const data = getTenantData(tenantId)
  const product = data.products.find((item) => itemId(item) === String(body?.productId))
  const printer = data.printers.find((item) => itemId(item) === String(body?.printerId))
  if (!product) return sendJson(res, 404, { error: 'Produto nao encontrado' })
  if (!printer) return sendJson(res, 404, { error: 'Impressora nao encontrada' })

  const queued = data.printJobs.filter((item) => String(item.printerId || '') === String(printer.id || '') && item.status === 'queued')
  data.printJobs.unshift({
    id: localId(),
    productId: product.id,
    productName: product.name,
    printerId: printer.id,
    printerName: printer.name,
    agentPrinterId: printer.agentPrinterId || body?.agentPrinterId || '',
    source: body?.source || 'manual',
    title: body?.title || product.name,
    quantity: normalizeQuantity(body?.quantity),
    priority: queued.length + 1,
    status: 'queued',
    notes: body?.notes || 'Adicionado manualmente pela tela de impressoras',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })

  return sendPrintJobs(req, res, 201)
}

export const handlePrintJobReorder = async (req, res, printJobId) => {
  const body = await readJsonBody(req)
  const direction = String(body?.direction || '').trim()
  const tenantId = await getTenantId(req)

  if (!['up', 'down'].includes(direction)) {
    return sendJson(res, 400, { error: 'Direcao da fila invalida.' })
  }

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const jobResult = await client.query(
        `select id, printer_id, agent_printer_id, status
           from print_jobs
          where tenant_id = $1
            and id = $2
          limit 1
          for update`,
        [tenantId, printJobId]
      )

      const job = jobResult.rows[0]
      if (!job) throw new Error('Registro nao encontrado')
      if (job.status !== 'queued') throw new Error('Somente itens pendentes podem ter a ordem alterada.')

      const queueResult = await client.query(
        `select id
           from print_jobs
          where tenant_id = $1
            and printer_id is not distinct from $2::bigint
            and agent_printer_id is not distinct from $3::bigint
            and status = 'queued'
          order by priority desc, created_at asc
          for update`,
        [tenantId, job.printer_id, job.agent_printer_id]
      )

      const queue = queueResult.rows.map((row) => String(row.id))
      const index = queue.indexOf(String(printJobId))
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || targetIndex < 0 || targetIndex >= queue.length) return

      const [removed] = queue.splice(index, 1)
      queue.splice(targetIndex, 0, removed)

      for (let currentIndex = 0; currentIndex < queue.length; currentIndex += 1) {
        await client.query(
          'update print_jobs set priority = $3, updated_at = now() where tenant_id = $1 and id = $2',
          [tenantId, queue[currentIndex], queue.length - currentIndex]
        )
      }
    })

    return sendPrintJobs(req, res)
  }

  const list = await localPrintJobs(req)
  const job = findLocalJob(list, printJobId)
  if (!job) return sendJson(res, 404, { error: 'Item da fila nao encontrado' })
  if (job.status !== 'queued') return sendJson(res, 400, { error: 'Somente itens pendentes podem ter a ordem alterada.' })

  const queue = list
    .filter((item) => String(item.printerId || '') === String(job.printerId || '') && String(item.agentPrinterId || '') === String(job.agentPrinterId || '') && item.status === 'queued')
    .sort(queuedSort)
  const index = queue.findIndex((item) => itemId(item) === String(printJobId))
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (index >= 0 && targetIndex >= 0 && targetIndex < queue.length) {
    const [removed] = queue.splice(index, 1)
    queue.splice(targetIndex, 0, removed)
    queue.forEach((item, currentIndex) => {
      item.priority = queue.length - currentIndex
      item.updatedAt = new Date().toISOString()
    })
  }

  return sendPrintJobs(req, res)
}

export const handlePrintJobMovePrinter = async (req, res, printJobId) => {
  const body = await readJsonBody(req)
  const tenantId = await getTenantId(req)
  const printerId = intOrNull(body?.printerId)
  const agentPrinterId = intOrNull(body?.agentPrinterId)

  if (!printerId) {
    return sendJson(res, 400, { error: 'Impressora obrigatoria.' })
  }

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const jobResult = await client.query(
        `select id, status
           from print_jobs
          where tenant_id = $1
            and id = $2
          limit 1
          for update`,
        [tenantId, printJobId]
      )

      const job = jobResult.rows[0]
      if (!job) throw new Error('Registro nao encontrado')
      if (!['queued', 'awaiting_confirmation'].includes(job.status)) {
        throw new Error('Somente itens pendentes podem ser movidos para outra impressora.')
      }

      const printer = await client.query(
        'select id from printers where tenant_id = $1 and id = $2 limit 1',
        [tenantId, printerId]
      )

      if (!printer.rowCount) throw new Error('Registro nao encontrado')

      if (agentPrinterId) {
        const agentPrinter = await client.query(
          `select id
             from agent_printers
            where tenant_id = $1
              and id = $2
              and printer_id is not distinct from $3::bigint
            limit 1`,
          [tenantId, agentPrinterId, printerId]
        )

        if (!agentPrinter.rowCount) throw new Error('Registro nao encontrado')
      }

      const priorityResult = await client.query(
        `select coalesce(max(priority), 0) + 1 as next_priority
           from print_jobs
          where tenant_id = $1
            and printer_id is not distinct from $2::bigint
            and status = 'queued'`,
        [tenantId, printerId]
      )

      await client.query(
        `update print_jobs
            set printer_id = $3,
                agent_printer_id = $4,
                priority = $5,
                updated_at = now()
          where tenant_id = $1
            and id = $2`,
        [tenantId, printJobId, printerId, agentPrinterId, Number(priorityResult.rows[0]?.next_priority || 1)]
      )
    })

    return sendPrintJobs(req, res)
  }

  const data = getTenantData(tenantId)
  const job = findLocalJob(data.printJobs, printJobId)
  const printer = data.printers.find((item) => itemId(item) === String(body?.printerId))
  if (!job) return sendJson(res, 404, { error: 'Item da fila nao encontrado' })
  if (!printer) return sendJson(res, 404, { error: 'Impressora nao encontrada' })
  if (!['queued', 'awaiting_confirmation'].includes(String(job.status || ''))) {
    return sendJson(res, 400, { error: 'Somente itens pendentes podem ser movidos para outra impressora.' })
  }

  const queued = data.printJobs.filter((item) => String(item.printerId || '') === String(printer.id || '') && item.status === 'queued')
  job.printerId = printer.id
  job.printerName = printer.name
  job.agentPrinterId = printer.agentPrinterId || ''
  job.priority = queued.length + 1
  job.updatedAt = new Date().toISOString()

  return sendPrintJobs(req, res)
}

export const handlePrintJobCancel = async (req, res, printJobId) => {
  const tenantId = await getTenantId(req)

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const result = await client.query(
        `update print_jobs
            set status = 'cancelled',
                cancelled_at = coalesce(cancelled_at, now()),
                updated_at = now()
          where tenant_id = $1
            and id = $2
            and status in ('awaiting_confirmation', 'queued', 'printing', 'paused')
          returning id`,
        [tenantId, printJobId]
      )

      if (!result.rowCount) throw new Error('Registro nao encontrado')
    })

    return sendPrintJobs(req, res)
  }

  const list = await localPrintJobs(req)
  const job = findLocalJob(list, printJobId)
  if (!job || !['awaiting_confirmation', 'queued', 'printing', 'paused'].includes(String(job.status || ''))) {
    return sendJson(res, 404, { error: 'Item da fila nao encontrado ou nao pode ser cancelado.' })
  }

  job.status = 'cancelled'
  job.cancelledAt ||= new Date().toISOString()
  job.updatedAt = new Date().toISOString()
  return sendPrintJobs(req, res)
}

export const handlePrintJobApprove = async (req, res, printJobId) => {
  const tenantId = await getTenantId(req)

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const jobResult = await client.query(
        `select id, printer_id, agent_printer_id, status
           from print_jobs
          where tenant_id = $1
            and id = $2
          limit 1
          for update`,
        [tenantId, printJobId]
      )

      const job = jobResult.rows[0]
      if (!job) throw new Error('Registro nao encontrado')
      if (job.status !== 'awaiting_confirmation') throw new Error('Este item nao esta aguardando confirmacao.')

      const priorityResult = await client.query(
        `select coalesce(max(priority), 0) + 1 as next_priority
           from print_jobs
          where tenant_id = $1
            and printer_id is not distinct from $2::bigint
            and agent_printer_id is not distinct from $3::bigint
            and status = 'queued'`,
        [tenantId, job.printer_id, job.agent_printer_id]
      )

      await client.query(
        `update print_jobs
            set status = 'queued',
                priority = $3,
                updated_at = now()
          where tenant_id = $1
            and id = $2`,
        [tenantId, printJobId, Number(priorityResult.rows[0]?.next_priority || 1)]
      )
    })

    return sendPrintJobs(req, res)
  }

  const list = await localPrintJobs(req)
  const job = findLocalJob(list, printJobId)
  if (!job) return sendJson(res, 404, { error: 'Item da fila nao encontrado' })
  if (job.status !== 'awaiting_confirmation') {
    return sendJson(res, 400, { error: 'Este item nao esta aguardando confirmacao.' })
  }

  const queued = list.filter((item) =>
    String(item.printerId || '') === String(job.printerId || '') &&
    String(item.agentPrinterId || '') === String(job.agentPrinterId || '') &&
    item.status === 'queued'
  )

  job.status = 'queued'
  job.priority = queued.length + 1
  job.updatedAt = new Date().toISOString()
  return sendPrintJobs(req, res)
}

export const handlePrintJobStartManual = async (req, res, printJobId) => {
  const tenantId = await getTenantId(req)

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const result = await client.query(
        `update print_jobs
            set status = 'printing',
                started_at = coalesce(started_at, now()),
                updated_at = now()
          where tenant_id = $1
            and id = $2
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
          returning id`,
        [tenantId, printJobId]
      )

      if (!result.rowCount) {
        throw new Error('Esta impressora ja possui uma impressao em andamento ou este item nao esta mais na fila.')
      }
    })

    return sendPrintJobs(req, res)
  }

  const list = await localPrintJobs(req)
  const job = findLocalJob(list, printJobId)
  if (!job) return sendJson(res, 404, { error: 'Item da fila nao encontrado' })
  if (job.status !== 'queued') return sendJson(res, 400, { error: 'Somente itens pendentes podem ser iniciados.' })

  const hasActive = list.some((item) =>
    itemId(item) !== String(printJobId) &&
    String(item.printerId || '') === String(job.printerId || '') &&
    String(item.agentPrinterId || '') === String(job.agentPrinterId || '') &&
    ['starting', 'printing', 'paused'].includes(String(item.status || ''))
  )

  if (hasActive) {
    return sendJson(res, 409, { error: 'Esta impressora ja possui uma impressao em andamento.' })
  }

  job.status = 'printing'
  job.startedAt ||= new Date().toISOString()
  job.updatedAt = new Date().toISOString()
  return sendPrintJobs(req, res)
}

export const handlePrintJobComplete = async (req, res, printJobId) => {
  const tenantId = await getTenantId(req)

  if (hasDatabase) {
    await withTenant(tenantId, async (client) => {
      const result = await client.query(
        `update print_jobs
            set status = 'completed',
                completed_at = coalesce(completed_at, now()),
                updated_at = now()
          where tenant_id = $1
            and id = $2
            and status in ('printing', 'paused')
          returning id`,
        [tenantId, printJobId]
      )

      if (!result.rowCount) throw new Error('Registro nao encontrado')
    })

    return sendPrintJobs(req, res)
  }

  const list = await localPrintJobs(req)
  const job = findLocalJob(list, printJobId)
  if (!job || !['printing', 'paused'].includes(String(job.status || ''))) {
    return sendJson(res, 404, { error: 'Item da fila nao encontrado ou nao pode ser concluido.' })
  }

  job.status = 'completed'
  job.completedAt ||= new Date().toISOString()
  job.updatedAt = new Date().toISOString()
  return sendPrintJobs(req, res)
}
