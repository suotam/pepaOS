import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import { supabase } from '../lib/supabase'

async function main() {
  const { count, error: countError } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    throw new Error(`Count failed: ${countError.message}`)
  }

  console.log('TOTAL_PROPERTIES', count)

  const { data, error } = await supabase
    .from('properties')
    .select('id,title,address,locality,city,latitude,longitude,property_type,status,created_at,geocode_source,ruian_address_code')
    .order('created_at', { ascending: false })
    .limit(250)

  if (error) {
    throw new Error(`Select failed: ${error.message}`)
  }

  const rows = data || []
  const summary = {
    totalRowsFetched: rows.length,
    withCoordinates: rows.filter((row: any) => row.latitude != null && row.longitude != null).length,
    centerPointCount: rows.filter((row: any) => Number(row.latitude) === 49.8175 && Number(row.longitude) === 15.473).length,
    mainStreetCount: rows.filter((row: any) => String(row.address || '').toLowerCase().includes('main st')).length,
    byGeocodeSource: rows.reduce((acc: Record<string, number>, row: any) => {
      const key = row.geocode_source || 'null'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    withRuianAddressCode: rows.filter((row: any) => row.ruian_address_code != null).length,
    byCity: rows.reduce((acc: Record<string, number>, row: any) => {
      const key = row.city || 'null'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
  }

  console.log(JSON.stringify(summary, null, 2))

  const samples = rows.slice(0, 40).map((row: any) => ({
    title: row.title,
    address: row.address,
    locality: row.locality,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    geocode_source: row.geocode_source,
    ruian_address_code: row.ruian_address_code,
  }))

  console.log(JSON.stringify(samples, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
