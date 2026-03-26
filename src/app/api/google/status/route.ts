import { NextRequest, NextResponse } from 'next/server'
import { getConnectionStatus, disconnectGoogle } from '../../../../lib/google/oauth'

export async function GET(request: NextRequest) {
  try {
    const userId = process.env.SESSION_USER_ID || 'default-user'
    const status = await getConnectionStatus(userId)
    return NextResponse.json(status)
  } catch (error) {
    console.error('Error checking connection status:', error)
    return NextResponse.json(
      { connected: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    if (body.action === 'disconnect') {
      const userId = process.env.SESSION_USER_ID || 'default-user'
      const result = await disconnectGoogle(userId)
      return NextResponse.json(result)
    }

    return NextResponse.json(
      { error: 'Unknown action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error handling request:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
