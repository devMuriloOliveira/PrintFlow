export const startCommandRealtime = ({
  startWebSocket,
  startSse,
  onError = () => {},
  onModeChange = () => {}
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
    onModeChange('sse')
    stopSse = startSse({
      onOpen: () => onModeChange('sse'),
      onClose: () => { if (!stopped) onModeChange('offline') },
      onError: () => { if (!stopped) onModeChange('offline') }
    })
  }

  const stopWebSocket = startWebSocket({
    onOpen: () => { stopFallback(); onModeChange('websocket') },
    onClose: startFallback,
    onError: startFallback
  })

  return () => {
    stopped = true
    stopFallback()
    stopWebSocket?.()
    onModeChange('offline')
  }
}
