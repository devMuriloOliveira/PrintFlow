const RELEASE_TAG_PATTERN = /^agent-v(\d+)\.(\d+)\.(\d+)$/

export const compareAgentReleaseTags = (left, right) => {
  const leftMatch = RELEASE_TAG_PATTERN.exec(left)
  const rightMatch = RELEASE_TAG_PATTERN.exec(right)
  if (!leftMatch || !rightMatch) throw new TypeError('Agent release tags must use agent-vMAJOR.MINOR.PATCH.')

  const leftVersion = leftMatch.slice(1).map(Number)
  const rightVersion = rightMatch.slice(1).map(Number)
  for (let index = 0; index < leftVersion.length; index++) {
    if (leftVersion[index] !== rightVersion[index]) return leftVersion[index] - rightVersion[index]
  }
  return 0
}
