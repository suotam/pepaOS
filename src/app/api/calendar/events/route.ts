import { NextResponse } from 'next/server'
import { get_calendar_events_in_range } from '@/lib/google-tools'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')

    if (!start || !end) {
      return NextResponse.json({ error: 'start and end query parameters are required' }, { status: 400 })
    }

    const events = await get_calendar_events_in_range(start, end)
    return NextResponse.json(events)
  } catch (error) {
    console.error('Error fetching calendar events:', error)
    return NextResponse.json({ error: 'Failed to get calendar events' }, { status: 500 })
  }
}
