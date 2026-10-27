import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pool } from './db'

async function seed(): Promise<void> {
  const sql = await readFile(resolve(process.cwd(), 'db/seed.sql'), 'utf8')
  await pool.query(sql)
  console.log('Salas de ejemplo cargadas.')
}

seed()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => pool.end())