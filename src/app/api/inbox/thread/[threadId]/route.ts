import { NextRequest, NextResponse } from 'next/server'
import { get_email_thread } from '@/lib/google-tools'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { threadId: string } }) {
  try {
    const { threadId } = params
    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 })
    }

    const thread = await get_email_thread(threadId)
    return NextResponse.json(thread)
  } catch (error) {
    console.error('Error getting email thread:', error)
    return NextResponse.json({ error: 'Failed to get email thread' }, { status: 500 })
  }
}
