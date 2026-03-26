import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationUrl } from '../../../../lib/google/oauth'

export async function GET(request: NextRequest) {
  try {
    const redirectTo = new URL(request.url).searchParams.get('redirectTo') || '/dashboard'
    const authUrl = getAuthorizationUrl(redirectTo)
    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error('Error generating auth URL:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate authorization URL' },
      { status: 500 }
    )
  }
}
