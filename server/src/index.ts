import { createApp } from './app'
import { pool } from './db'

const port = Number(process.env.PORT ?? 3001)

createApp(pool).listen(port, () => {
  console.log(`API disponible en http://localhost:${port}`)
})