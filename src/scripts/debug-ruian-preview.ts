import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import { supabase } from '../lib/supabase'
import { geocodePropertyWithBestEffort } from '../lib/ruian'

async function main() {
  const { data, error } = await supabase
    .from('properties')
    .select('id,title,address,locality,city,region,latitude,longitude,geocode_source,ruian_address_code')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    throw new Error(error.message)
  }

  for (const row of data || []) {
    const next = await geocodePropertyWithBestEffort(row as any)
    console.log(
      JSON.stringify(
        {
          title: (row as any).title,
          address: (row as any).address,
          current: {
            latitude: (row as any).latitude,
            longitude: (row as any).longitude,
            geocode_source: (row as any).geocode_source,
          },
          next,
        },
        null,
        2
      )
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
