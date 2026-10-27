import 'dotenv/config'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL. Copia .env.example a .env y configura la conexión.')
}

export const pool = new Pool({ connectionString: databaseUrl })