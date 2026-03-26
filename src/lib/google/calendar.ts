import { google } from 'googleapis'
import { getAuthenticatedGoogleClient } from './oauth'

const BUSINESS_HOURS = { start: 9, end: 18 } // 09:00 - 18:00
const DEFAULT_MEETING_DURATION = 30 // minutes
const BUSINESS_TIME_ZONE = 'Europe/Prague'

export interface TimeSlot {
  start: Date
  end: Date
}

export interface AvailabilityResult {
  requestedRange: {
    start: string
    end: string
  }
  busySlots: TimeSlot[]
  freeSlots: TimeSlot[]
  suggestedSlots: TimeSlot[]
}

function getPragueOffset(dateString: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: 'longOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(`${dateString}T12:00:00Z`))

  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT+01:00'
  return tzName.replace('GMT', '')
}

function normalizePragueDateTime(input: string): string {
  const match = input.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/)

  if (!match) {
    return input
  }

  const [, datePart, timePart, secondPart] = match
  return `${datePart}T${timePart}:${secondPart || '00'}${getPragueOffset(datePart)}`
}

export async function getCalendarAvailability(
  userId: string,
  start: string,
  end: string,
  durationMinutes = DEFAULT_MEETING_DURATION
): Promise<AvailabilityResult> {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })

    const startDate = new Date(start)
    const endDate = new Date(end)

    // Get busy slots from primary calendar
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        items: [{ id: 'primary' }],
      },
    })

    const busySlots = (response.data.calendars?.primary?.busy || [])
      .filter((slot: any) => slot.start && slot.end)
      .map((slot: any) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }))

    // Calculate free slots
    const freeSlots = calculateFreeSlots(startDate, endDate, busySlots)

    // Suggest meeting slots (filter for business hours and meeting duration)
    const suggestedSlots = generateMeetingSlotSuggestions(
      freeSlots,
      durationMinutes,
      3 // top 3 suggestions
    )

    return {
      requestedRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      busySlots,
      freeSlots,
      suggestedSlots,
    }
  } catch (error) {
    console.error('Failed to get calendar availability:', error)
    throw error
  }
}

export async function suggestMeetingSlots(
  userId: string,
  start: string,
  end: string,
  durationMinutes = DEFAULT_MEETING_DURATION,
  maxSuggestions = 3
): Promise<TimeSlot[]> {
  const availability = await getCalendarAvailability(userId, start, end, durationMinutes)
  return availability.suggestedSlots.slice(0, maxSuggestions)
}

export async function createCalendarEvent(
  userId: string,
  input: {
    summary: string
    description?: string
    start: string
    end: string
    attendeeEmails?: string[]
  }
): Promise<{ eventId: string; htmlLink: string }> {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })
    const normalizedStart = normalizePragueDateTime(input.start)
    const normalizedEnd = normalizePragueDateTime(input.end)

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: normalizedStart, timeZone: BUSINESS_TIME_ZONE },
        end: { dateTime: normalizedEnd, timeZone: BUSINESS_TIME_ZONE },
        attendees: input.attendeeEmails?.map((email) => ({ email })),
      },
    })

    return {
      eventId: response.data.id || '',
      htmlLink: response.data.htmlLink || '',
    }
  } catch (error: any) {
    console.error('Failed to create calendar event:', error)
    const message = error?.response?.data?.error?.errors?.[0]?.message || error?.message || ''
    if (message.includes('insufficient authentication scopes') || message.includes('insufficientPermissions')) {
      throw new Error('Google Calendar authorization scopes are insufficient. Please reconnect your Google account and allow calendar write permissions (calendar, calendar.events).')
    }
    throw error
  }
}

/**
 * Calculate free slots by removing busy periods from the requested time range
 */
function calculateFreeSlots(start: Date, end: Date, busySlots: TimeSlot[]): TimeSlot[] {
  const freeSlots: TimeSlot[] = []
  
  if (busySlots.length === 0) {
    freeSlots.push({ start, end })
    return filterBusinessHours(freeSlots)
  }

  // Sort busy slots
  const sorted = busySlots.sort((a, b) => a.start.getTime() - b.start.getTime())

  let currentTime = start

  for (const busySlot of sorted) {
    // Add free time before this busy slot
    if (currentTime < busySlot.start) {
      freeSlots.push({
        start: new Date(currentTime),
        end: new Date(busySlot.start),
      })
    }
    currentTime = new Date(Math.max(currentTime.getTime(), busySlot.end.getTime()))
  }

  // Add remaining free time
  if (currentTime < end) {
    freeSlots.push({
      start: new Date(currentTime),
      end: new Date(end),
    })
  }

  return filterBusinessHours(freeSlots)
}

/**
 * Filter slots to only include business hours (9 AM - 6 PM)
 */
function filterBusinessHours(slots: TimeSlot[]): TimeSlot[] {
  return slots
    .map((slot) => {
      let start = new Date(slot.start)
      let end = new Date(slot.end)

      // Adjust start to business hours minimum
      if (start.getHours() < BUSINESS_HOURS.start) {
        start.setHours(BUSINESS_HOURS.start, 0, 0, 0)
      }

      // Adjust end to business hours maximum
      if (end.getHours() >= BUSINESS_HOURS.end) {
        end.setHours(BUSINESS_HOURS.end, 0, 0, 0)
      }

      // Skip if slot is too small
      if (start >= end) {
        return null
      }

      return { start, end }
    })
    .filter((slot) => slot !== null) as TimeSlot[]
}

/**
 * Suggest meeting slots from available free slots (private helper)
 */
function generateMeetingSlotSuggestions(
  freeSlots: TimeSlot[],
  durationMinutes: number,
  maxSuggestions: number
): TimeSlot[] {
  const suggested: TimeSlot[] = []

  for (const slot of freeSlots) {
    if (suggested.length >= maxSuggestions) break

    let current = new Date(slot.start)
    const slotEnd = new Date(slot.end)

    // Try to fit meetings at the start of each free slot
    while (current.getTime() + durationMinutes * 60 * 1000 <= slotEnd.getTime()) {
      const meetingEnd = new Date(current.getTime() + durationMinutes * 60 * 1000)
      suggested.push({
        start: new Date(current),
        end: meetingEnd,
      })

      if (suggested.length >= maxSuggestions) break

      // Move to next possible time (e.g., 30 min intervals)
      current = new Date(current.getTime() + 30 * 60 * 1000)
    }
  }

  return suggested
}

export async function getCalendarEventsInRange(userId: string, start: string, end: string) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    })

    const events = (response.data.items || []).map((event) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      htmlLink: event.htmlLink,
      attendees: event.attendees || [],
    }))

    return events
  } catch (error) {
    console.error('Failed to list calendar events:', error)
    throw error
  }
}

export async function updateCalendarEvent(userId: string, eventId: string, updates: { summary?: string; description?: string; start?: string; end?: string; attendeeEmails?: string[] }) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })
    const normalizedStart = updates.start ? normalizePragueDateTime(updates.start) : undefined
    const normalizedEnd = updates.end ? normalizePragueDateTime(updates.end) : undefined

    const getResponse = await calendar.events.get({ calendarId: 'primary', eventId })
    const event = getResponse.data

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId,
      requestBody: {
        ...event,
        summary: updates.summary || event.summary,
        description: updates.description || event.description,
        start: normalizedStart ? { dateTime: normalizedStart, timeZone: BUSINESS_TIME_ZONE } : event.start,
        end: normalizedEnd ? { dateTime: normalizedEnd, timeZone: BUSINESS_TIME_ZONE } : event.end,
        attendees: updates.attendeeEmails ? updates.attendeeEmails.map((email) => ({ email })) : event.attendees,
      },
    })

    return {
      eventId: response.data.id || eventId,
      htmlLink: response.data.htmlLink || event.htmlLink || '',
    }
  } catch (error) {
    console.error('Failed to update calendar event:', error)
    throw error
  }
}

export async function deleteCalendarEvent(userId: string, eventId: string) {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })

    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete calendar event:', error)
    throw error
  }
}
