export const retryUntilStarted = async ({
  start,
  wait,
  initialDelay = 5_000,
  maximumDelay = 60_000,
  onRetry = () => {}
}) => {
  let retryDelay = initialDelay
  while (true) {
    if (await start()) return true
    onRetry(retryDelay)
    await wait(retryDelay)
    retryDelay = Math.min(retryDelay * 2, maximumDelay)
  }
}
