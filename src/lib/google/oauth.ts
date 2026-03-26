import { supabase } from '../supabase'
import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth environment variables not configured')
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function getAuthorizationUrl(redirectTo?: string): string {
  const oauth2Client = getOAuthClient()
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: redirectTo || '/dashboard',
  })
  return authUrl
}

export function getScopeInstructions() {
  return `Google OAuth requires these scopes: ${SCOPES.join(', ')}`
}


export async function exchangeCodeForToken(code: string, userId: string) {
  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)
  
  if (!tokens.access_token) {
    throw new Error('No access token received from Google')
  }

  // Store tokens in Supabase
  const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null
  
  const { error } = await supabase.from('connected_accounts').upsert({
    user_id: userId,
    provider: 'google',
    provider_user_id: tokens.id_token ? extractUserIdFromIdToken(tokens.id_token) : null,
    provider_email: null, // Will be set when we fetch user info
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    token_expiry: expiryDate,
    scopes: SCOPES,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store token: ${error.message}`)
  }

  // Fetch and store user email (optional - don't fail if this doesn't work)
  let userEmail: string | null = null
  try {
    userEmail = await getUserEmail(userId)
    if (userEmail) {
      await supabase.from('connected_accounts').update({
        provider_email: userEmail,
      }).eq('user_id', userId)
    }
  } catch (emailError) {
    console.warn('Failed to fetch user email, but connection successful:', emailError)
    // Don't fail the entire connection if email fetch fails
  }

  return { success: true, email: userEmail }
}

export async function getAuthenticatedGoogleClient(userId: string) {
  const oauth2Client = getOAuthClient()
  
  // Fetch stored tokens
  const { data, error } = await supabase
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single()

  if (error || !data) {
    throw new Error(`Google account not connected for user ${userId}`)
  }

  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.token_expiry ? new Date(data.token_expiry).getTime() : null,
  })

  // Set up token refresh handler
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await supabase.from('connected_accounts').update({
        refresh_token: tokens.refresh_token,
        token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)
    }
  })

  return oauth2Client
}

export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const auth = await getAuthenticatedGoogleClient(userId)
    const oauth2 = google.oauth2({ version: 'v2', auth })
    const response = await oauth2.userinfo.get()
    
    return response.data.email || null
  } catch (error) {
    console.error('Failed to get user email:', error)
    // Don't throw - just return null so the connection can still succeed
    return null
  }
}

export async function getConnectionStatus(userId: string) {
  const { data, error } = await supabase
    .from('connected_accounts')
    .select('provider_email, created_at')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single()

  if (error || !data) {
    return { connected: false, email: null }
  }

  return {
    connected: true,
    email: data.provider_email,
    connectedAt: data.created_at,
  }
}

export async function disconnectGoogle(userId: string) {
  const { error } = await supabase
    .from('connected_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'google')

  if (error) {
    throw new Error(`Failed to disconnect: ${error.message}`)
  }

  return { success: true }
}

// Helper to extract user ID from JWT token (basic implementation)
function extractUserIdFromIdToken(idToken: string): string | null {
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) return null
    
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString())
    return decoded.sub || null
  } catch {
    return null
  }
}

export async function logAction(userId: string, actionType: string, provider: string, status: string, metadata: Record<string, any> = {}, errorMessage?: string) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action_type: actionType,
      provider,
      status,
      metadata,
      error_message: errorMessage,
    })
  } catch (error) {
    console.error('Failed to log action:', error)
  }
}
