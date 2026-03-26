import { NextResponse } from 'next/server'
import { reply_to_email_thread } from '@/lib/google-tools'

export async function POST(request: Request) {
  try {
    const { threadId, to, subject, body } = await request.json()

    if (!threadId || !to || !subject || !body) {
      return NextResponse.json({ error: 'threadId, to, subject, and body are required' }, { status: 400 })
    }

    const reply = await reply_to_email_thread(threadId, to, subject, body)
    return NextResponse.json({ success: true, ...reply })
  } catch (error) {
    console.error('Error replying to email thread:', error)
    return NextResponse.json({ error: 'Failed to reply to email thread' }, { status: 500 })
  }
}
