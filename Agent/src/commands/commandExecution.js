import {
  handleCommand
} from './commandHandler.js'
import { sanitizeLogValue } from '../logging/fileLogger.js'

const inProgressResult = () => ({
  success: false,
  error:
    'Comando ja estava em processamento local. A execucao nao foi repetida por seguranca.'
})

export const executeAgentCommand = async (
  {
    command,
    context = {},
    operations,
    execute = handleCommand
  }
) => {
  const claim =
    operations.begin(
      command
    )

  if (
    claim.status ===
    'completed'
  ) {
    operations.queueCompletion(
      command.id,
      claim.result
    )

    return claim.result
  }

  if (
    claim.status ===
    'processing'
  ) {
    const result =
      inProgressResult()

    operations.queueCompletion(
      command.id,
      result
    )

    return result
  }

  const result =
    await execute(
      command,
      context
    )

  if (command.type === 'start_print' && result?.success !== false && typeof context.onPrintJobStarted === 'function') {
    context.onPrintJobStarted({ command, result })
  }

  operations.recordResult(
    command.id,
    result
  )

  if (
    typeof operations.upsertLocalState ===
    'function'
  ) {
    const status =
      result?.status ||
      result?.result?.status ||
      null
    const state = {
      commandId:
        String(command.id),
      commandType:
        String(command.type || 'unknown'),
      success:
        result?.success !== false,
      status
    }
    const printerId =
      command.payload?.agentPrinterId
    const printJobId =
      command.payload?.printJobId

    if (printerId && status) {
      operations.upsertLocalState(
        'printer',
        printerId,
        state
      )
    }

    if (printJobId && status) {
      operations.upsertLocalState(
        'job',
        printJobId,
        state
      )
    }
  }

  if (
    typeof operations.queueEvent ===
    'function'
  ) {
    operations.queueEvent(
      'command.completed',
      {
        commandId:
          String(command.id),
        commandType:
          String(command.type || 'unknown'),
        success:
          result?.success !== false,
        status:
          result?.status?.state ||
          result?.result?.status ||
          null
      }
    )
  }

  return result
}

export const flushPendingEvents = async (
  {
    operations,
    publish,
    limit = 20,
    maxAttempts = Number(process.env.PRINTFLOW_AGENT_OUTBOX_MAX_ATTEMPTS) || 10,
    random = Math.random,
    now = Date.now
  }
) => {
  let synchronized = 0

  if (
    typeof operations.listPendingEvents !==
    'function'
  ) {
    return synchronized
  }

  for (
    const event
    of operations.listPendingEvents(limit, new Date(now()).toISOString())
  ) {
    try {
      await publish({
        id: String(event.id),
        type: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt
      })
      operations.acknowledgeEvent(event.id)
      synchronized += 1
    } catch (error) {
      const attempts = Number(event.attempts || 0) + 1
      const status = Number(error?.response?.status || error?.statusCode || 0)
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429
      const safeError = String(sanitizeLogValue(error?.message || 'Falha ao publicar evento')).slice(0, 500)
      if (permanent || attempts >= maxAttempts) {
        operations.deadLetterEvent?.(event.id, safeError)
      } else {
        const backoff = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(10, attempts - 1)))
        const retryDelay = Math.round(backoff * (0.8 + random() * 0.4))
        operations.markEventAttempted?.(event.id, { nextRetryAt: new Date(now() + retryDelay).toISOString(), error: safeError })
      }
    }
  }

  return synchronized
}

export const flushPendingProductionMetrics = async ({ operations, report, limit = 20, maxAttempts = Number(process.env.PRINTFLOW_AGENT_OUTBOX_MAX_ATTEMPTS) || 10, random = Math.random, now = Date.now }) => {
  if (typeof operations.listPendingProductionMetrics !== 'function') return 0
  let synchronized = 0
  for (const metric of operations.listPendingProductionMetrics(limit, new Date(now()).toISOString())) {
    try {
      await report(metric.printJobId, metric.payload)
      operations.acknowledgeProductionMetric(metric.id)
      synchronized += 1
    } catch (error) {
      const attempts = Number(metric.attempts || 0) + 1
      const status = Number(error?.response?.status || error?.statusCode || 0)
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429
      const safeError = String(sanitizeLogValue(error?.message || 'Falha ao reportar metric')).slice(0, 500)
      if (permanent || attempts >= maxAttempts) operations.deadLetterProductionMetric?.(metric.id, safeError)
      else {
        const backoff = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(10, attempts - 1)))
        const retryDelay = Math.round(backoff * (0.8 + random() * 0.4))
        operations.retryProductionMetric?.(metric.id, { nextRetryAt: new Date(now() + retryDelay).toISOString(), error: safeError })
      }
    }
  }
  return synchronized
}

export const flushPendingCommandCompletions = async (
  {
    operations,
    complete,
    limit = 20,
    random = Math.random,
    now = Date.now
  }
) => {
  let completed = 0

  for (
    const pending
    of operations.listPendingCompletions(
      limit,
      new Date(now()).toISOString()
    )
  ) {
    try {
      await complete(pending.commandId, pending.result)
      operations.acknowledgeCompletion(pending.commandId)
      completed += 1
    } catch (error) {
      const attempts = Number(pending.attempts || 0) + 1
      const backoff = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(10, attempts - 1)))
      const retryDelay = Math.round(backoff * (0.8 + random() * 0.4))
      operations.retryCompletion?.(pending.commandId, {
        nextRetryAt: new Date(now() + retryDelay).toISOString(),
        error: String(sanitizeLogValue(error?.message || 'Falha ao concluir comando no backend')).slice(0, 500)
      })
    }
  }

  return completed
}
