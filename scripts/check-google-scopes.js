require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { data, error } = await supabase
    .from('connected_accounts')
    .select('provider_email, scopes, updated_at')
    .eq('user_id', process.env.SESSION_USER_ID || 'default-user')
    .eq('provider', 'google')
    .single()

  console.log(JSON.stringify({ data, error }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
