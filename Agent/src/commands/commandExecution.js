import {
  handleCommand
} from './commandHandler.js'

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
    limit = 20
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
    of operations.listPendingEvents(limit)
  ) {
    operations.markEventAttempted?.(
      event.id
    )

    await publish({
      id:
        String(event.id),
      type:
        event.eventType,
      payload:
        event.payload,
      createdAt:
        event.createdAt
    })

    operations.acknowledgeEvent(
      event.id
    )
    synchronized += 1
  }

  return synchronized
}

export const flushPendingCommandCompletions = async (
  {
    operations,
    complete,
    limit = 20
  }
) => {
  let completed = 0

  for (
    const pending
    of operations.listPendingCompletions(
      limit
    )
  ) {
    await complete(
      pending.commandId,
      pending.result
    )

    operations.acknowledgeCompletion(
      pending.commandId
    )

    completed += 1
  }

  return completed
}
