import { getCalendarAvailability, suggestMeetingSlots, createCalendarEvent, getCalendarEventsInRange, updateCalendarEvent, deleteCalendarEvent } from './google/calendar'
import { createDraftEmail, sendEmail, listRecentEmails, getEmailThread, replyToEmailThread, type EmailAttachment } from './google/gmail'
import { getConnectionStatus, logAction } from './google/oauth'

const SESSION_USER_ID = process.env.SESSION_USER_ID || 'default-user'

/**
 * Get Google Calendar availability for the requested time range
 */
export async function get_calendar_availability(
  start: string,
  end: string,
  durationMinutes: number = 30
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar not connected. Please connect your Google account first.')
  }

  const result = await getCalendarAvailability(SESSION_USER_ID, start, end, durationMinutes)
  
  await logAction(SESSION_USER_ID, 'calendar_availability_lookup', 'google', 'success', {
    start,
    end,
    durationMinutes,
    freeSlots: result.freeSlots.length,
  })

  return {
    requestedRange: result.requestedRange,
    freeSlots: result.freeSlots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    })),
    suggestedSlots: result.suggestedSlots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    })),
  }
}

/**
 * Get suggested meeting slots for the requested time range
 */
export async function suggest_meeting_slots(
  start: string,
  end: string,
  durationMinutes: number = 30,
  maxSuggestions: number = 3
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar not connected. Please connect your Google account first.')
  }

  const slots = await suggestMeetingSlots(
    SESSION_USER_ID,
    start,
    end,
    durationMinutes,
    maxSuggestions
  )

  await logAction(SESSION_USER_ID, 'suggest_meeting_slots', 'google', 'success', {
    start,
    end,
    durationMinutes,
    maxSuggestions,
    suggested: slots.length,
  })

  return slots.map((slot) => ({
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
  }))
}

/**
 * Create a Gmail draft email
 */
export async function draft_email(
  to: string,
  subject: string,
  body: string
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Gmail not connected. Please connect your Google account first.')
  }

  const result = await createDraftEmail(SESSION_USER_ID, { to, subject, body })

  await logAction(SESSION_USER_ID, 'draft_email', 'google', 'success', {
    to,
    subject: subject.substring(0, 100),
    draftId: result.draftId,
  })

  return {
    draftId: result.draftId,
    messageId: result.messageId,
    preview: result.preview,
    status: 'DRAFT',
    message: `Email draft created successfully. To send this email, ask me to send it.`,
  }
}

/**
 * Send a Gmail email (requires explicit confirmation from user prompt)
 */
export async function send_email(
  to: string,
  subject: string,
  body: string,
  attachments?: EmailAttachment[]
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Gmail not connected. Please connect your Google account first.')
  }

  const result = await sendEmail(SESSION_USER_ID, { to, subject, body, attachments })

  await logAction(SESSION_USER_ID, 'send_email', 'google', 'success', {
    to,
    subject: subject.substring(0, 100),
    messageId: result.messageId,
  })

  return {
    messageId: result.messageId,
    status: 'SENT',
    message: `Email sent successfully to ${to}`,
  }
}

export async function list_recent_emails(maxResults: number = 20) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Gmail not connected. Please connect your Google account first.')
  }

  const emails = await listRecentEmails(SESSION_USER_ID, maxResults)

  await logAction(SESSION_USER_ID, 'list_recent_emails', 'google', 'success', {
    maxResults,
    count: emails.length,
  })

  return emails
}

export async function get_email_thread(threadId: string) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Gmail not connected. Please connect your Google account first.')
  }

  const thread = await getEmailThread(SESSION_USER_ID, threadId)

  await logAction(SESSION_USER_ID, 'get_email_thread', 'google', 'success', {
    threadId,
    messages: thread.messages.length,
  })

  return thread
}

export async function reply_to_email_thread(threadId: string, to: string, subject: string, body: string) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Gmail not connected. Please connect your Google account first.')
  }

  const result = await replyToEmailThread(SESSION_USER_ID, threadId, to, subject, body)

  await logAction(SESSION_USER_ID, 'reply_to_email_thread', 'google', 'success', {
    threadId,
    to,
    subject,
    messageId: result.messageId,
  })

  return {
    messageId: result.messageId,
    status: 'SENT',
    message: `Reply sent successfully to ${to}`,
  }
}

/**
 * Create a Google Calendar event
 */
export async function create_calendar_event(
  summary: string,
  start: string,
  end: string,
  description?: string,
  attendeeEmails?: string[]
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar not connected. Please connect your Google account first.')
  }

  const result = await createCalendarEvent(SESSION_USER_ID, {
    summary,
    description,
    start,
    end,
    attendeeEmails,
  })

  await logAction(SESSION_USER_ID, 'create_calendar_event', 'google', 'success', {
    summary,
    start,
    end,
    eventId: result.eventId,
  })

  return {
    eventId: result.eventId,
    htmlLink: result.htmlLink,
    message: `Calendar event "${summary}" created successfully`,
  }
}

export async function get_calendar_events_in_range(start: string, end: string) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar not connected. Please connect your Google account first.')
  }

  const events = await getCalendarEventsInRange(SESSION_USER_ID, start, end)

  await logAction(SESSION_USER_ID, 'list_calendar_events', 'google', 'success', {
    start,
    end,
    events: events.length,
  })

  return events
}

export async function update_calendar_event(
  eventId: string,
  updates: { summary?: string; description?: string; start?: string; end?: string; attendeeEmails?: string[] }
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar not connected. Please connect your Google account first.')
  }

  const result = await updateCalendarEvent(SESSION_USER_ID, eventId, updates)

  await logAction(SESSION_USER_ID, 'update_calendar_event', 'google', 'success', {
    eventId,
    updates,
  })

  return result
}

export async function delete_calendar_event(eventId: string) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar not connected. Please connect your Google account first.')
  }

  const result = await deleteCalendarEvent(SESSION_USER_ID, eventId)

  await logAction(SESSION_USER_ID, 'delete_calendar_event', 'google', 'success', {
    eventId,
  })

  return result
}

/**
 * Draft an email with suggested meeting slots (composite tool)
 */
export async function draft_viewing_email_from_availability(
  recipientName: string,
  recipientEmail: string,
  start: string,
  end: string,
  durationMinutes: number = 30,
  context?: string
) {
  const status = await getConnectionStatus(SESSION_USER_ID)
  if (!status.connected) {
    throw new Error('Google Calendar and Gmail not connected. Please connect your Google account first.')
  }

  try {
    // Get availability
    const availability = await getCalendarAvailability(SESSION_USER_ID, start, end, durationMinutes)
    
    if (availability.suggestedSlots.length === 0) {
      throw new Error('No available time slots found in the requested range')
    }

    // Build email body with suggested slots
    const slots = availability.suggestedSlots.slice(0, 3)
    const slotDescriptions = slots
      .map((slot) => {
        const startTime = new Date(slot.start).toLocaleString('cs-CZ', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        const endTime = new Date(slot.end).toLocaleTimeString('cs-CZ', {
          hour: '2-digit',
          minute: '2-digit',
        })
        return `  • ${startTime} - ${endTime}`
      })
      .join('\n')

    const emailBody = `Dobrý den ${recipientName},

${context || 'rád/ráda bych se s Vámi sejít. Mám volné následující časy:'}

${slotDescriptions}

Prosím, dejte mi vědět, který čas Vám vyhovuje.

S pozdravem`

    // Create draft
    const draftResult = await createDraftEmail(SESSION_USER_ID, {
      to: recipientEmail,
      subject: `Návrh setkání - ${new Date().toLocaleDateString('cs-CZ')}`,
      body: emailBody,
    })

    await logAction(SESSION_USER_ID, 'draft_viewing_email', 'google', 'success', {
      recipientName,
      recipientEmail,
      suggestedSlots: slots.length,
      draftId: draftResult.draftId,
    })

    return {
      draftId: draftResult.draftId,
      suggestedSlots: slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })),
      emailPreview: emailBody,
      status: 'DRAFT',
      message: `Draft email created with ${slots.length} suggested meeting times.`,
    }
  } catch (error) {
    await logAction(SESSION_USER_ID, 'draft_viewing_email', 'google', 'failed', {}, 
      error instanceof Error ? error.message : 'Unknown error'
    )
    throw error
  }
}
