import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('verifies the correct password without storing it as plain text', async () => {
    const password = 'Cliente-demo-2026!'
    const passwordHash = await hashPassword(password)

    expect(passwordHash).not.toContain(password)
    expect(await verifyPassword(password, passwordHash)).toBe(true)
  })

  it('rejects a wrong password and malformed hash', async () => {
    const passwordHash = await hashPassword('Admin-demo-2026!')

    expect(await verifyPassword('otra-clave', passwordHash)).toBe(false)
    expect(await verifyPassword('Admin-demo-2026!', 'plain-text')).toBe(false)
  })
})