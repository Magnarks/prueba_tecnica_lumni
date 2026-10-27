import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { verifyPassword } from './password'

export type UserRole = 'customer' | 'admin'

export interface AuthenticatedUser {
  id: number
  email: string
  role: UserRole
  customerId: number | null
  fullName: string | null
}

export interface CreatedSession {
  accessToken: string
  expiresAt: string
  user: AuthenticatedUser
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Correo o contraseña incorrectos.')
    this.name = 'InvalidCredentialsError'
  }
}

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex')
}

export async function createLoginSession(
  pool: Pool,
  email: string,
  password: string,
): Promise<CreatedSession> {
  const result = await pool.query<{
    id: number
    email: string
    role: UserRole
    customerId: number | null
    fullName: string | null
    passwordHash: string
  }>(
    `SELECT u.id,
            u.email,
            u.role,
            u.customer_id AS "customerId",
            c.full_name AS "fullName",
            u.password_hash AS "passwordHash"
     FROM app_users u
     LEFT JOIN customers c ON c.id = u.customer_id
     WHERE u.email = lower($1)`,
    [email],
  )
  const row = result.rows[0]

  if (!row || !(await verifyPassword(password, row.passwordHash))) {
    throw new InvalidCredentialsError()
  }

  const accessToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString()

  await pool.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3::timestamptz)`,
    [row.id, hashAccessToken(accessToken), expiresAt],
  )

  return {
    accessToken,
    expiresAt,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      customerId: row.customerId,
      fullName: row.fullName,
    },
  }
}

export async function getSessionUser(
  pool: Pool,
  accessToken: string,
): Promise<AuthenticatedUser | null> {
  const result = await pool.query<AuthenticatedUser>(
    `SELECT u.id,
            u.email,
            u.role,
            u.customer_id AS "customerId",
            c.full_name AS "fullName"
     FROM auth_sessions s
     JOIN app_users u ON u.id = s.user_id
     LEFT JOIN customers c ON c.id = u.customer_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()`,
    [hashAccessToken(accessToken)],
  )

  return result.rows[0] ?? null
}

export async function revokeLoginSession(pool: Pool, accessToken: string): Promise<void> {
  await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashAccessToken(accessToken)],
  )
}