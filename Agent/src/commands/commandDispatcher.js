const configuredLimit = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const printerResource = command => {
  const payload = command?.payload || {}
  const printer = payload.printer || {}
  const protocol = String(printer.protocol || '').trim().toLowerCase()
  const printerKey = protocol === 'bambu' && printer.serial
    ? `bambu:${String(printer.serial).trim()}`
    : printer.connectionType === 'network' && printer.ip
      ? `${protocol}:${String(printer.ip).trim()}:${String(printer.port || '').trim()}`
      : printer.connectionType === 'usb' && printer.port
        ? `${protocol}:${String(printer.port).trim()}`
        : payload.agentPrinterId || printer.id || printer.serial || [protocol, printer.ip || printer.port].filter(Boolean).join(':')
  const id = printerKey
  return id ? `printer:${id}` : 'global:unassigned-printer'
}

export const commandResourceKey = command => {
  switch (command?.type) {
    case 'discover_printers': return 'global:discovery'
    case 'slice_print_job': return `slicer:${command?.payload?.job?.id || command?.payload?.printJobId || command?.id}`
    case 'check_for_update': return 'global:update'
    default: return printerResource(command)
  }
}

export const createCommandDispatcher = ({
  maxConcurrentPrinterCommands = configuredLimit(process.env.MAX_CONCURRENT_PRINTER_COMMANDS, 4),
  maxConcurrentSlicingJobs = configuredLimit(process.env.MAX_CONCURRENT_SLICING_JOBS, 1),
  maxConcurrentGlobalCommands = 1,
  run
} = {}) => {
  if (typeof run !== 'function') throw new Error('CommandDispatcher requer uma funcao run.')

  const resourceTails = new Map()
  let activePrinterCommands = 0
  let activeSlicingJobs = 0
  let activeGlobalCommands = 0
  let queuedPrinterCommands = 0
  let queuedSlicingJobs = 0
  let queuedGlobalCommands = 0
  const printerWaiters = []
  const slicingWaiters = []
  const globalWaiters = []
  const commandControllers = new Map()

  const acquire = kind => {
    const isSlicing = kind === 'slicer'
    const isGlobal = kind === 'global'
    const limit = isSlicing ? maxConcurrentSlicingJobs : isGlobal ? maxConcurrentGlobalCommands : maxConcurrentPrinterCommands
    const waiters = isSlicing ? slicingWaiters : isGlobal ? globalWaiters : printerWaiters
    const getActive = () => isSlicing ? activeSlicingJobs : isGlobal ? activeGlobalCommands : activePrinterCommands
    const setActive = value => {
      if (isSlicing) activeSlicingJobs = value
      else if (isGlobal) activeGlobalCommands = value
      else activePrinterCommands = value
    }
    const release = () => {
      const next = waiters.shift()
      if (next) next(release)
      else setActive(Math.max(0, getActive() - 1))
    }

    if (getActive() < limit) {
      setActive(getActive() + 1)
      return Promise.resolve(release)
    }
    return new Promise(resolve => waiters.push(resolve))
  }

  const enqueue = command => {
    const resource = commandResourceKey(command)
    const kind = resource.startsWith('slicer:') ? 'slicer' : resource.startsWith('global:') ? 'global' : 'printer'
    const commandId = String(command?.id || '')
    const controller = new AbortController()
    if (commandId) commandControllers.set(commandId, { controller, type: command?.type })
    const previous = resourceTails.get(resource) || Promise.resolve()
    if (kind === 'slicer') queuedSlicingJobs += 1
    else if (kind === 'global') queuedGlobalCommands += 1
    else queuedPrinterCommands += 1

    const execution = previous.catch(() => {}).then(async () => {
      if (controller.signal.aborted) throw controller.signal.reason || new Error('Comando cancelado.')
      const release = await acquire(kind)
      try {
        return await run(command, { signal: controller.signal })
      } finally {
        release()
      }
    })

    const tail = execution.catch(() => {}).finally(() => {
      if (kind === 'slicer') queuedSlicingJobs -= 1
      else if (kind === 'global') queuedGlobalCommands -= 1
      else queuedPrinterCommands -= 1
      if (resourceTails.get(resource) === tail) resourceTails.delete(resource)
      if (commandId && commandControllers.get(commandId)?.controller === controller) commandControllers.delete(commandId)
    })
    resourceTails.set(resource, tail)
    return execution
  }

  return {
    enqueue,
    cancelCommand: (commandId, reason = new Error('Comando cancelado.')) => {
      const controller = commandControllers.get(String(commandId || ''))?.controller
      if (!controller || controller.signal.aborted) return false
      controller.abort(reason)
      return true
    },
    cancelCommandsByType: (type, reason = new Error('Comando cancelado.')) => {
      let cancelled = 0
      for (const entry of commandControllers.values()) {
        if (entry.type === type && !entry.controller.signal.aborted) {
          const controller = entry.controller
          controller.abort(reason)
          cancelled += 1
        }
      }
      return cancelled
    },
    getState: () => ({
      activePrinterCommands,
      activeSlicingJobs,
      queued: queuedPrinterCommands + queuedSlicingJobs + queuedGlobalCommands,
      queuedPrinterCommands,
      queuedSlicingJobs,
      queuedGlobalCommands,
      activeGlobalCommands,
      resources: resourceTails.size,
      maxConcurrentPrinterCommands,
      maxConcurrentSlicingJobs,
      maxConcurrentGlobalCommands
    })
  }
}
