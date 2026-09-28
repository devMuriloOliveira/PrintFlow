export const createSingleFlightScheduler = ({
  run,
  getDefaultDelay = () => 0,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) => {
  let timer = null
  let running = false
  let requested = false
  let stopped = false

  const execute = async () => {
    if (stopped) return
    if (running) {
      requested = true
      return
    }

    running = true
    try {
      await run()
    } finally {
      running = false
      if (!stopped) {
        const delay = requested ? 0 : getDefaultDelay()
        requested = false
        schedule(delay)
      }
    }
  }

  const schedule = (delay = getDefaultDelay()) => {
    if (stopped) return
    if (running) {
      requested = true
      return
    }
    if (timer) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      return execute()
    }, Math.max(0, Number(delay) || 0))
  }

  const stop = () => {
    stopped = true
    if (timer) clearTimer(timer)
    timer = null
  }

  return {
    schedule,
    stop,
    getState: () => ({ running, requested, scheduled: Boolean(timer) })
  }
}
