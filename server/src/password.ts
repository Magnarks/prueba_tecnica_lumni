import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => {
      if (error) {
        reject(error)
        return
      }

      resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)

  return `scrypt$${salt.toString('base64url')}$${key.toString('hex')}`
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const [algorithm, saltText, keyText, extra] = passwordHash.split('$')

  if (
    algorithm !== 'scrypt' ||
    !saltText ||
    !keyText ||
    extra !== undefined ||
    !/^[a-f\d]{128}$/i.test(keyText)
  ) {
    return false
  }

  const expectedKey = Buffer.from(keyText, 'hex')
  const actualKey = await deriveKey(password, Buffer.from(saltText, 'base64url'))

  return timingSafeEqual(expectedKey, actualKey)
}