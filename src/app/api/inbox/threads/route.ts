import { NextResponse } from 'next/server'
import { list_recent_emails } from '@/lib/google-tools'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const emails = await list_recent_emails(25)
    return NextResponse.json(emails)
  } catch (error) {
    console.error('Error listing recent emails:', error)
    const message = error instanceof Error ? error.message : 'Failed to list recent emails'
    const status = message.includes('gmail.readonly') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
