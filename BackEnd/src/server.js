import { createServer } from 'node:http'
import { env } from './config/env.js'
import { migrate } from './db/migrate.js'
import { handleRequest } from './routes/index.js'

const server = createServer(handleRequest)

try {
  await migrate()

  server.listen(env.port, () => {
    console.log(`PrintFlow API running at http://localhost:${env.port}`)
  })
} catch (error) {
  console.error('Falha ao inicializar a API', error)
  process.exit(1)
}
