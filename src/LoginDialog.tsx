import { useState, type FormEvent } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle, LockKeyhole, X } from 'lucide-react'
import type { AuthSession } from './contracts'
import './Admin.css'

interface LoginDialogProps {
  onLogin: (session: AuthSession) => void
  onClose: () => void
}

export function LoginDialog({ onLogin, onClose }: LoginDialogProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json() as AuthSession | { error?: string }

      if (!response.ok) {
        throw new Error('error' in payload
          ? payload.error ?? 'No fue posible iniciar sesión.'
          : 'No fue posible iniciar sesión.')
      }

      onLogin(payload as AuthSession)
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'No fue posible conectar con el servicio de acceso.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-overlay">
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <header className="auth-dialog-header">
          <span className="auth-lock-icon"><LockKeyhole size={20} /></span>
          <button
            className="auth-close"
            type="button"
            aria-label="Cerrar inicio de sesión"
            title="Cerrar"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X size={19} />
          </button>
        </header>
        <p className="auth-kicker">LUMNI COWORKING</p>
        <h2 id="login-title">Bienvenido de nuevo</h2>
        <p className="auth-copy">Ingresa con la cuenta asignada para continuar.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor="login-email">
            <span>Correo electrónico</span>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="auth-field" htmlFor="login-password">
            <span>Contraseña</span>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && (
            <div className="auth-error" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
            </div>
          )}

          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="spinner" size={17} /> : null}
            Iniciar sesión
            {!isSubmitting ? <ArrowRight size={17} /> : null}
          </button>
        </form>
      </section>
    </div>
  )
}