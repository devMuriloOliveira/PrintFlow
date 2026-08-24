export const sendJson = (res, status, body, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Origin, X-Requested-With, X-Tenant-Id, X-Agent-Id, X-Agent-Secret, X-PrintFlow-File-Name, X-PrintFlow-File-Format, X-PrintFlow-Webhook-Secret',
    ...extraHeaders
  })

  res.end(status === 204 ? null : JSON.stringify(body))
}
