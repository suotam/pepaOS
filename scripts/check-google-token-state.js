require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { data, error } = await supabase
    .from('connected_accounts')
    .select('provider_email, token_expiry, updated_at, refresh_token')
    .eq('user_id', process.env.SESSION_USER_ID || 'default-user')
    .eq('provider', 'google')
    .single()

  console.log(JSON.stringify({
    data: data ? {
      ...data,
      refresh_token_present: Boolean(data.refresh_token),
      refresh_token: undefined,
    } : null,
    error,
    now: new Date().toISOString(),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
