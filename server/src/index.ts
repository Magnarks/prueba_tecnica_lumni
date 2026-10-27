import { createApp } from './app'
import { pool } from './db'
import { startEmailWorker } from './email-worker'

const port = Number(process.env.PORT ?? 3001)
const stopEmailWorker = startEmailWorker(pool)
const server = createApp(pool).listen(port, () => {
  console.log(`API disponible en http://localhost:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopEmailWorker()
    server.close(() => void pool.end())
  })
}