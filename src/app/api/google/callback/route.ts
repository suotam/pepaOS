import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, logAction } from '../../../../lib/google/oauth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const redirectTo = url.searchParams.get('state') || '/dashboard'

    if (error) {
      console.error('OAuth error from Google:', error)
      return NextResponse.redirect(
        new URL(`${redirectTo}?google_error=${encodeURIComponent(`OAuth error: ${error}`)}`, request.url)
      )
    }

    if (!code) {
      console.error('Missing authorization code')
      return NextResponse.redirect(
        new URL(`${redirectTo}?google_error=${encodeURIComponent('Missing authorization code')}`, request.url)
      )
    }

    // Get user ID from session or use default for now
    // In production, you would get this from NextAuth or similar
    const userId = process.env.SESSION_USER_ID || 'default-user'

    const result = await exchangeCodeForToken(code, userId)
    
    // Log successful connection
    await logAction(userId, 'google_connect', 'google', 'success', {
      email: result.email,
    })

    // Redirect to a success page or back to the app
    return NextResponse.redirect(
      new URL(`${redirectTo}?google_connected=true&email=${encodeURIComponent(result.email || '')}`, request.url)
    )
  } catch (error) {
    console.error('OAuth callback error:', error)
    const userId = process.env.SESSION_USER_ID || 'default-user'
    const redirectTo = new URL(request.url).searchParams.get('state') || '/dashboard'
    await logAction(userId, 'google_connect', 'google', 'failed', {}, 
      error instanceof Error ? error.message : 'Unknown error'
    )
    
    // Log more details for debugging
    console.error('Full error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as any)?.code,
      status: (error as any)?.status
    })
    
    return NextResponse.redirect(
      new URL(`${redirectTo}?google_error=${encodeURIComponent(
        error instanceof Error ? `Failed to connect Google account: ${error.message}` : 'Failed to connect Google account'
      )}`, request.url)
    )
  }
}
