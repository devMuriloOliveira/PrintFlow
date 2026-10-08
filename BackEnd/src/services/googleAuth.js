import { env } from '../config/env.js'

const GOOGLE_TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token='

export const verifyGoogleCredential = async (credential) => {
  if (!env.googleClientId) throw new Error('Login com Google ainda nao foi configurado no servidor.')
  const token = String(credential || '').trim()
  if (!token) throw new Error('Credencial do Google ausente.')

  const response = await fetch(`${GOOGLE_TOKEN_INFO_URL}${encodeURIComponent(token)}`)
  if (!response.ok) throw new Error('Nao foi possivel validar a conta Google.')
  const profile = await response.json()
  const now = Math.floor(Date.now() / 1000)
  if (profile.aud !== env.googleClientId || profile.iss !== 'https://accounts.google.com' || Number(profile.exp || 0) <= now) {
    throw new Error('Credencial do Google invalida ou expirada.')
  }
  if (profile.email_verified !== 'true' || !profile.email || !profile.sub) {
    throw new Error('A conta Google precisa ter um e-mail verificado.')
  }

  return {
    subject: String(profile.sub),
    email: String(profile.email).trim().toLowerCase(),
    name: String(profile.name || profile.email.split('@')[0]).trim().slice(0, 160)
  }
}
