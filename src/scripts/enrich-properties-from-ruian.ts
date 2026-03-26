import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import path from 'path'

import { supabase } from '../lib/supabase'
import { ensurePropertyGeocodeColumns, findRuianMatchForProperty, stripUnsupportedPropertyGeocodeColumns } from '../lib/ruian'

type PropertyRow = {
  id: string
  address: string
  city: string | null
  locality: string | null
}

async function enrichPropertiesFromRuian() {
  await ensurePropertyGeocodeColumns()

  const csvPath = process.argv[2]

  if (!csvPath) {
    throw new Error('Usage: npm run geocode:ruian -- <path-to-official-ruian-csv>')
  }

  const resolvedCsvPath = path.resolve(process.cwd(), csvPath)
  console.log(`Loading official RUIAN CSV: ${resolvedCsvPath}`)

  let { data: properties, error } = await supabase.from('properties').select('id,address,city,locality')

  if (error) {
    throw new Error(`Failed to fetch properties: ${error.message}`)
  }

  const propertyRows = (properties || []) as PropertyRow[]
  let matched = 0
  let unmatched = 0

  for (const property of propertyRows) {
    const match = findRuianMatchForProperty(property, {
      csvPath: resolvedCsvPath,
      strict: true,
    })

    if (!match) {
      unmatched++
      continue
    }

    const updatePayload = {
      city: property.city || match.city,
      locality: property.locality || match.locality,
      latitude: match.latitude,
      longitude: match.longitude,
      ruian_address_code: match.addressCode ? Number(match.addressCode) : null,
      geocode_source: 'ruian_official_csv',
      geocoded_at: new Date().toISOString(),
    }

    let { error: updateError } = await supabase.from('properties').update(updatePayload).eq('id', property.id)

    if (updateError) {
      const fallbackPayload = stripUnsupportedPropertyGeocodeColumns(updatePayload, updateError.message)
      if (fallbackPayload !== updatePayload) {
        const retry = await supabase.from('properties').update(fallbackPayload).eq('id', property.id)
        updateError = retry.error as any
      }
    }

    if (updateError) {
      throw new Error(`Failed to update property ${property.id}: ${updateError.message}`)
    }

    matched++
  }

  console.log(`Matched and updated: ${matched}`)
  console.log(`Unmatched: ${unmatched}`)
}

enrichPropertiesFromRuian().catch((error) => {
  console.error(error)
  process.exit(1)
})
