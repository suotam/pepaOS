require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing Supabase env vars')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  const { count, error: countError } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })

  console.log('properties_count', count, countError ? countError.message : 'ok')

  const { data, error } = await supabase
    .from('properties')
    .select('id,title,address,locality,city,region,latitude,longitude,ruian_address_code,geocode_source,property_type,status,asking_price,created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log('select_error', error ? error.message : 'ok')
  if (data) {
    console.log(JSON.stringify(data, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
