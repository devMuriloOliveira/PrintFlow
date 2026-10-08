export const createGracefulShutdown = ({
  stopAccepting = async () => {},
  stopBackgroundWork = async () => {},
  drainCommands = async () => {},
  flushOutbox = async () => {},
  disconnectPrinters = async () => {},
  closeServer = async () => {},
  closeDatabase = async () => {},
  exit = code => process.exit(code),
  log = (...args) => console.log(...args),
  timeoutMs = 20_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => {
  let shutdownPromise = null

  const shutdown = (signal = 'shutdown') => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      log(`[Shutdown] Recebido ${signal}; encerrando o Agent.`)
      let timedOut = false
      let timer
      const timeout = new Promise(resolve => {
        timer = setTimer(() => { timedOut = true; resolve('timeout') }, Math.max(1, timeoutMs))
      })

      const work = (async () => {
        const run = async (label, action) => {
          try { await action() } catch (error) { log(`[Shutdown] ${label}: ${error.message || error}`) }
        }
        await run('falha ao parar entrada de comandos', stopAccepting)
        await run('falha ao parar timers e realtime', stopBackgroundWork)
        await run('falha ao drenar comandos ativos', drainCommands)
        await run('falha ao sincronizar outbox', flushOutbox)
        await run('falha ao desconectar impressoras', disconnectPrinters)
        await run('falha ao fechar servidor local', closeServer)
        await run('falha ao fechar SQLite', closeDatabase)
        return 'complete'
      })()

      const result = await Promise.race([work, timeout])
      clearTimer(timer)
      if (timedOut) log('[Shutdown] Limite de encerramento atingido; algumas operações podem não ter sido drenadas.')
      exit(result === 'timeout' ? 1 : 0)
      return result
    })()
    return shutdownPromise
  }

  return { shutdown, isShuttingDown: () => Boolean(shutdownPromise) }
}
