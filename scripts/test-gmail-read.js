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
    .select('access_token, refresh_token')
    .eq('user_id', process.env.SESSION_USER_ID || 'default-user')
    .eq('provider', 'google')
    .single()

  if (error || !data) {
    throw error || new Error('No connected account found')
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  auth.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })

  const gmail = google.gmail({ version: 'v1', auth })
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 5,
    q: 'in:inbox',
    labelIds: ['INBOX'],
  })

  console.log(JSON.stringify(response.data, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
