export type EmailPayload = {
  to: string
  subject: string
  html: string
}

export type EmailService = {
  send: (payload: EmailPayload) => Promise<void>
}

/**
 * Console email service — logs email content to stdout.
 * Used in development. Replace with createResendEmailService() in production.
 */
export function createConsoleEmailService(): EmailService {
  return {
    async send(payload) {
      console.log("========================================")
      console.log(`[EMAIL] To: ${payload.to}`)
      console.log(`[EMAIL] Subject: ${payload.subject}`)
      console.log(`[EMAIL] Body:\n${payload.html}`)
      console.log("========================================")
    },
  }
}

/**
 * Production email service using Resend (https://resend.com).
 * Uses fetch — no SDK needed, works on Cloudflare Workers.
 *
 * export function createResendEmailService(apiKey: string): EmailService {
 *   return {
 *     async send(payload) {
 *       await fetch("https://api.resend.com/emails", {
 *         method: "POST",
 *         headers: {
 *           Authorization: `Bearer ${apiKey}`,
 *           "Content-Type": "application/json",
 *         },
 *         body: JSON.stringify({
 *           from: "RGBA <noreply@rgba.dev>",
 *           to: payload.to,
 *           subject: payload.subject,
 *           html: payload.html,
 *         }),
 *       })
 *     },
 *   }
 * }
 */
