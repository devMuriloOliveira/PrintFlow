export const sendJson = (res, status, body, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization',
    ...extraHeaders
  })

  res.end(status === 204 ? null : JSON.stringify(body))
}
