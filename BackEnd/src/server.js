import { createServer } from 'node:http'
import { env } from './config/env.js'
import { migrate } from './db/migrate.js'
import { handleRequest } from './routes/index.js'

process.on('uncaughtException', (error) => {
  console.error('Excecao nao capturada', error)
})

process.on('unhandledRejection', (error) => {
  console.error('Promise rejeitada sem tratamento', error)
})

const server = createServer(handleRequest)
server.keepAliveTimeout = 120_000
server.headersTimeout = 120_000

try {
  await migrate()

  server.listen(env.port, '0.0.0.0', () => {
    console.log(`PrintFlow API running at http://localhost:${env.port}`)
  })
} catch (error) {
  console.error('Falha ao inicializar a API', error)
  process.exit(1)
}
