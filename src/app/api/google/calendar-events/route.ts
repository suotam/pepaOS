import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthenticatedGoogleClient } from '@/lib/google/oauth'

export async function POST(request: NextRequest) {
  try {
    const userId = process.env.SESSION_USER_ID || 'default-user'
    const { start, end } = await request.json()

    if (!start || !end) {
      return NextResponse.json({ error: 'Start and end dates are required' }, { status: 400 })
    }

    const auth = await getAuthenticatedGoogleClient(userId)
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated with Google' }, { status: 401 })
    }

    const calendar = google.calendar({ version: 'v3', auth })

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: 'startTime'
    })

    return NextResponse.json(response.data.items || [])
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error)
    return NextResponse.json({ error: 'Failed to fetch calendar events' }, { status: 500 })
  }
}