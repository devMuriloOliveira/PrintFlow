import { env } from '../config/env.js'

export const isEmailDeliveryConfigured = () => Boolean(env.resendApiKey && env.emailFrom && env.appPublicUrl)

export const sendAuthEmail = async ({ email, subject, text }) => {
  if (!isEmailDeliveryConfigured()) throw new Error('Envio de e-mails de autenticacao nao configurado.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.emailFrom, to: [email], subject, text })
  })
  if (!response.ok) throw new Error('Nao foi possivel enviar o e-mail de autenticacao.')
}

export const sendInvitationEmail = async ({ email, invitationUrl, role }) => {
  if (!env.resendApiKey || !env.emailFrom || !env.appPublicUrl) {
    throw new Error('Envio de convites nao configurado.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [email],
      subject: 'Convite para acessar o PrintFlow',
      text: `Voce foi convidado como ${role}. Defina sua senha em ate 48 horas: ${invitationUrl}`
    })
  })

  if (!response.ok) throw new Error('Nao foi possivel enviar o convite por e-mail.')
}
