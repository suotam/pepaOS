import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import { supabase } from '../lib/supabase'
import { ensurePropertyGeocodeColumns, geocodePropertyWithBestEffort, stripUnsupportedPropertyGeocodeColumns } from '../lib/ruian'

type PropertyRow = {
  id: string
  title: string
  address: string
  locality: string | null
  city: string | null
  region: string | null
  latitude: number | null
  longitude: number | null
  geocode_source?: string | null
  ruian_address_code?: number | null
}

async function backfillPropertyAddresses() {
  await ensurePropertyGeocodeColumns()

  let { data, error } = await supabase
    .from('properties')
    .select('id,title,address,locality,city,region,latitude,longitude,geocode_source,ruian_address_code')

  if (error) {
    const retry = await supabase
      .from('properties')
      .select('id,title,address,locality,city,region,latitude,longitude')

    data = retry.data as any
    error = retry.error as any
  }

  if (error) {
    throw new Error(`Failed to fetch properties: ${error.message}`)
  }

  const rows = (data || []) as PropertyRow[]
  let updated = 0

  for (const row of rows) {
    const geocoded = await geocodePropertyWithBestEffort(row)

    const changed =
      geocoded.address !== row.address ||
      geocoded.city !== row.city ||
      geocoded.locality !== row.locality ||
      geocoded.region !== row.region ||
      geocoded.latitude !== row.latitude ||
      geocoded.longitude !== row.longitude ||
      geocoded.geocode_source !== (row.geocode_source ?? null) ||
      geocoded.ruian_address_code !== (row.ruian_address_code ?? null)

    if (!changed) continue

    const updatePayload =
      row.geocode_source !== undefined
        ? {
            address: geocoded.address,
            city: geocoded.city,
            locality: geocoded.locality,
            region: geocoded.region,
            latitude: geocoded.latitude,
            longitude: geocoded.longitude,
            geocode_source: geocoded.geocode_source,
            geocoded_at: geocoded.geocoded_at,
            ruian_address_code: geocoded.ruian_address_code,
          }
        : {
            address: geocoded.address,
            city: geocoded.city,
            locality: geocoded.locality,
            region: geocoded.region,
            latitude: geocoded.latitude,
            longitude: geocoded.longitude,
          }

    let { error: updateError } = await supabase
      .from('properties')
      .update(updatePayload)
      .eq('id', row.id)

    if (updateError) {
      const fallbackPayload = stripUnsupportedPropertyGeocodeColumns(updatePayload, updateError.message)
      if (fallbackPayload !== updatePayload) {
        const retry = await supabase.from('properties').update(fallbackPayload).eq('id', row.id)
        updateError = retry.error as any
      }
    }

    if (updateError) {
      throw new Error(`Failed to update property ${row.id}: ${updateError.message}`)
    }

    updated += 1
  }

  console.log(`Updated properties: ${updated}`)
}

backfillPropertyAddresses().catch((error) => {
  console.error(error)
  process.exit(1)
})
