import { google } from 'googleapis'
import { getAuthenticatedGoogleClient } from './oauth'

export interface EmailInput {
  to: string
  subject: string
  body: string
  htmlBody?: string
  threadId?: string
  attachments?: EmailAttachment[]
}

export interface EmailAttachment {
  filename: string
  contentType: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface DraftResult {
  draftId: string
  messageId: string
  preview: string
}

export interface SendResult {
  messageId: string
  labelIds: string[]
  preview: string
}

function decodeBase64Url(value?: string | null) {
  if (!value) return ''
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function encodeMimeWord(value: string) {
  if (!/[^\x20-\x7E]/.test(value)) {
    return value
  }

  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join('\r\n') || ''
}

function encodeTextBody(value: string) {
  return wrapBase64(Buffer.from(value, 'utf8').toString('base64'))
}

function encodeHtmlBody(value: string) {
  return wrapBase64(Buffer.from(value, 'utf8').toString('base64'))
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractPlainText(payload: any): string {
  if (!payload) return ''

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return htmlToText(decodeBase64Url(payload.body.data))
  }

  if (Array.isArray(payload.parts)) {
    const plainTextPart = payload.parts.find((part: any) => part.mimeType === 'text/plain' && part.body?.data)
    if (plainTextPart) {
      return decodeBase64Url(plainTextPart.body.data)
    }

    const htmlPart = payload.parts.find((part: any) => part.mimeType === 'text/html' && part.body?.data)
    if (htmlPart) {
      return htmlToText(decodeBase64Url(htmlPart.body.data))
    }

    for (const part of payload.parts) {
      const text = extractPlainText(part)
      if (text.trim()) return text
    }
  }

  return payload.body?.data ? htmlToText(decodeBase64Url(payload.body.data)) : ''
}

/**
 * Create an RFC 2822 formatted email
 */
function createMimeMessage(input: EmailInput): string {
  const { to, subject, body, htmlBody, attachments = [] } = input
  const encodedSubject = encodeMimeWord(subject)
  const encodedBody = encodeTextBody(body)
  const encodedHtmlBody = htmlBody ? encodeHtmlBody(htmlBody) : null

  if (attachments.length === 0 && !encodedHtmlBody) {
    const mimeHeaders = [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
    ].join('\r\n')

    return mimeHeaders + '\r\n' + encodedBody
  }

  if (attachments.length === 0 && encodedHtmlBody) {
    const alternativeBoundary = `alt-${Date.now()}`
    return [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      `--${alternativeBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      encodedBody,
      '',
      `--${alternativeBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      encodedHtmlBody,
      '',
      `--${alternativeBoundary}--`,
      '',
    ].join('\r\n')
  }

  const boundary = `mixed-${Date.now()}`
  const alternativeBoundary = `alt-${Date.now()}`
  const headers = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
  ].join('\r\n')

  const textPart = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody,
    '',
    ...(encodedHtmlBody
      ? [
          `--${alternativeBoundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          'Content-Transfer-Encoding: base64',
          '',
          encodedHtmlBody,
          '',
        ]
      : []),
    `--${alternativeBoundary}--`,
    '',
  ].join('\r\n')

  const attachmentParts = attachments.map((attachment) => {
    const encodedContent =
      attachment.encoding === 'base64'
        ? wrapBase64(attachment.content)
        : wrapBase64(Buffer.from(attachment.content, 'utf8').toString('base64'))
    return [
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${encodeMimeWord(attachment.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeMimeWord(attachment.filename)}"`,
      '',
      encodedContent,
      '',
    ].join('\r\n')
  })

  return [
    headers,
    textPart,
    ...attachmentParts,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

/**
 * Create a draft email in Gmail
 */
export async function createDraftEmail(
  userId: string,
  input: EmailInput
): Promise<DraftResult> {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const mimeMessage = createMimeMessage(input)
    const encodedMessage = Buffer.from(mimeMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: encodedMessage,
          threadId: input.threadId,
        },
      },
    })

    return {
      draftId: response.data.id || '',
      messageId: response.data.message?.id || '',
      preview: input.body.substring(0, 100),
    }
  } catch (error) {
    console.error('Failed to create draft email:', error)
    throw error
  }
}

/**
 * Send an email through Gmail
 */
export async function sendEmail(
  userId: string,
  input: EmailInput
): Promise<SendResult> {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const mimeMessage = createMimeMessage(input)
    const encodedMessage = Buffer.from(mimeMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: input.threadId,
      },
    })

    return {
      messageId: response.data.id || '',
      labelIds: response.data.labelIds || [],
      preview: input.body.substring(0, 100),
    }
  } catch (error) {
    console.error('Failed to send email:', error)
    throw error
  }
}

/**
 * Get draft message details
 */
export async function getDraftMessage(userId: string, draftId: string) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.drafts.get({
      userId: 'me',
      id: draftId,
      format: 'full',
    })

    const headers = response.data.message?.payload?.headers || []
    const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)'
    const to = headers.find((h) => h.name === 'To')?.value || ''

    // Extract body (basic - may need enhancement for multipart)
    const body = response.data.message?.snippet || ''

    return {
      draftId,
      subject,
      to,
      body,
    }
  } catch (error) {
    console.error('Failed to get draft message:', error)
    throw error
  }
}

/**
 * Send a draft and delete it
 */
export async function sendDraft(userId: string, draftId: string) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: {
        id: draftId,
      },
    })

    return {
      messageId: response.data.id || '',
      labelIds: response.data.labelIds || [],
    }
  } catch (error) {
    console.error('Failed to send draft:', error)
    throw error
  }
}

/**
 * Delete a draft
 */
export async function deleteDraft(userId: string, draftId: string) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    await gmail.users.drafts.delete({
      userId: 'me',
      id: draftId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete draft:', error)
    throw error
  }
}

export async function listRecentEmails(userId: string, maxResults = 20) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'in:inbox',
      labelIds: ['INBOX'],
    })

    const messages = response.data.messages || []

    const expanded = await Promise.all(
      messages.map(async (msg) => {
        const msgDetail = await gmail.users.messages.get({ userId: 'me', id: msg.id || '', format: 'full' })
        const headers = msgDetail.data.payload?.headers || []
        const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)'
        const from = headers.find((h) => h.name === 'From')?.value || ''
        const date = headers.find((h) => h.name === 'Date')?.value || ''

        return {
          id: msg.id,
          threadId: msgDetail.data.threadId || '',
          subject,
          from,
          date,
          snippet: msgDetail.data.snippet || '',
          labelIds: msgDetail.data.labelIds || [],
        }
      })
    )

    return expanded
  } catch (error) {
    console.error('Failed to list recent emails:', error)
    const message = (error as any)?.response?.data?.error?.message || (error as any)?.message || ''
    if (message.includes('insufficient authentication scopes') || message.includes('insufficientPermissions')) {
      throw new Error('Gmail read permissions are missing. Please reconnect your Google account and allow gmail.readonly access.')
    }
    throw error
  }
}

export async function getEmailThread(userId: string, threadId: string) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })

    const messages = (response.data.messages || []).map((msg) => {
      const headers = msg.payload?.headers || []
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)'
      const from = headers.find((h) => h.name === 'From')?.value || ''
      const date = headers.find((h) => h.name === 'Date')?.value || ''
      const snippet = msg.snippet || ''
      const body = extractPlainText(msg.payload)

      return {
        id: msg.id,
        subject,
        from,
        date,
        snippet,
        body,
      }
    })

    return {
      threadId,
      messages,
    }
  } catch (error) {
    console.error('Failed to get email thread:', error)
    const message = (error as any)?.response?.data?.error?.message || (error as any)?.message || ''
    if (message.includes('insufficient authentication scopes') || message.includes('insufficientPermissions')) {
      throw new Error('Gmail read permissions are missing. Please reconnect your Google account and allow gmail.readonly access.')
    }
    throw error
  }
}

export async function replyToEmailThread(userId: string, threadId: string, to: string, subject: string, body: string) {
  try {
    return await sendEmail(userId, { to, subject, body, threadId })
  } catch (error) {
    console.error('Failed to reply to email thread:', error)
    throw error
  }
}
