import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pool } from './db'

async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const migrationDirectory = resolve(process.cwd(), 'db/migrations')
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file],
    )

    if (applied.rowCount) {
      continue
    }

    const sql = await readFile(resolve(migrationDirectory, file), 'utf8')
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`Migración aplicada: ${file}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

runMigrations()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => pool.end())