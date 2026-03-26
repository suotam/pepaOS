import { NextResponse } from 'next/server'
import { create_calendar_event, delete_calendar_event } from '@/lib/google-tools'

export async function POST(request: Request) {
  try {
    const { summary, start, end, description, attendeeEmails } = await request.json()

    if (!summary || !start || !end) {
      return NextResponse.json({ error: 'summary, start, and end are required' }, { status: 400 })
    }

    const result = await create_calendar_event(summary, start, end, description || '', attendeeEmails || [])
    return NextResponse.json({ success: true, event: result })
  } catch (error) {
    console.error('Error creating calendar event:', error)
    return NextResponse.json({ error: 'Failed to create calendar event' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { eventId } = await request.json()

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    }

    await delete_calendar_event(eventId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting calendar event:', error)
    return NextResponse.json({ error: 'Failed to delete calendar event' }, { status: 500 })
  }
}
