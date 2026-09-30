export const startCommandRealtime = ({
  startWebSocket,
  startSse,
  onError = () => {}
}) => {
  let stopSse = null
  let stopped = false

  const stopFallback = () => {
    stopSse?.()
    stopSse = null
  }

  const startFallback = error => {
    if (stopped || stopSse) return
    if (error) onError(error)
    stopSse = startSse()
  }

  const stopWebSocket = startWebSocket({
    onOpen: stopFallback,
    onClose: startFallback,
    onError: startFallback
  })

  return () => {
    stopped = true
    stopFallback()
    stopWebSocket?.()
  }
}
