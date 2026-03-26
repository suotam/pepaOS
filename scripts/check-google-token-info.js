require('dotenv').config({ path: '.env.local' })
const { google } = require('googleapis')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { data, error } = await supabase
    .from('connected_accounts')
    .select('access_token, refresh_token, provider_email')
    .eq('user_id', process.env.SESSION_USER_ID || 'default-user')
    .eq('provider', 'google')
    .single()

  if (error || !data?.access_token) {
    throw error || new Error('No connected Google account found')
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  const tokenInfo = await oauth2.getTokenInfo(data.access_token)
  console.log(JSON.stringify({
    email: data.provider_email,
    scopes: tokenInfo.scopes,
    expiry_date: tokenInfo.expiry_date,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
