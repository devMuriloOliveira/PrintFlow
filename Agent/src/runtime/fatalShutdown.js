export const createFatalShutdownController = ({
  getActivePrintJobs = () => 0,
  isCommandRunning = () => false,
  exit = code => process.exit(code),
  log = (...args) => console.error(...args),
  setTimer = setTimeout,
  retryMs = 1_000
} = {}) => {
  let requested = false
  let waitingLogged = false

  const check = () => {
    if (!requested) return

    let safeToExit = false
    try {
      const activePrintJobs = Number(getActivePrintJobs())
      safeToExit = Number.isFinite(activePrintJobs) &&
        activePrintJobs <= 0 &&
        !isCommandRunning()
    } catch {
      safeToExit = false
    }

    if (safeToExit) {
      log('[Fatal] Nenhum comando ou trabalho de impressao ativo; encerrando para reinicio seguro.')
      exit(1)
      return
    }

    if (!waitingLogged) {
      log('[Fatal] Encerramento aguardando o comando e as impressoes ativas chegarem a um estado seguro.')
      waitingLogged = true
    }
    setTimer(check, retryMs)
  }

  return {
    handle(error) {
      if (requested) return
      requested = true
      log('[Fatal] Erro nao tratado:', error?.stack || error?.message || error)
      check()
    },
    isShutdownRequested: () => requested
  }
}
