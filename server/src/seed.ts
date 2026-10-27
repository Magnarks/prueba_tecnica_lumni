import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pool } from './db'
import { hashPassword } from './password'

const demoUsers = [
  {
    email: 'cliente@lumni.local',
    fullName: 'Cliente Lumni',
    company: 'Lumni',
    password: 'Cliente-demo-2026!',
    role: 'customer',
  },
  {
    email: 'admin@lumni.local',
    password: 'Admin-demo-2026!',
    role: 'admin',
  },
] as const

async function seed(): Promise<void> {
  const sql = await readFile(resolve(process.cwd(), 'db/seed.sql'), 'utf8')
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(sql)

    for (const user of demoUsers) {
      const passwordHash = await hashPassword(user.password)

      if (user.role === 'customer') {
        const customer = await client.query<{ id: number }>(
          `INSERT INTO customers (email, full_name, company)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE
             SET full_name = EXCLUDED.full_name,
                 company = EXCLUDED.company
           RETURNING id`,
          [user.email, user.fullName, user.company],
        )
        await client.query(
          `INSERT INTO app_users (customer_id, email, password_hash, role)
           VALUES ($1, $2, $3, 'customer')
           ON CONFLICT (email) DO UPDATE
             SET customer_id = EXCLUDED.customer_id,
                 password_hash = EXCLUDED.password_hash,
                 role = 'customer'`,
          [customer.rows[0].id, user.email, passwordHash],
        )
      } else {
        await client.query(
          `INSERT INTO app_users (customer_id, email, password_hash, role)
           VALUES (NULL, $1, $2, 'admin')
           ON CONFLICT (email) DO UPDATE
             SET customer_id = NULL,
                 password_hash = EXCLUDED.password_hash,
                 role = 'admin'`,
          [user.email, passwordHash],
        )
      }
    }

    await client.query('COMMIT')
    console.log('Salas y usuarios demo cargados.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

seed()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => pool.end())