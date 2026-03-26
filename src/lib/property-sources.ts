import { supabase } from './supabase'
import { buildGeocodedPropertyPayload, ensurePropertyGeocodeColumns, stripUnsupportedPropertyGeocodeColumns } from './ruian'

type ImportedPropertyInput = {
  source: string
  externalId: string
  sourceUrl: string
  title: string
  priceText?: string | null
  priceNumeric?: number | null
  location?: string | null
  city?: string | null
  locality?: string | null
  region?: string | null
  propertyType: string
  latitude?: number | null
  longitude?: number | null
  geocodeSource?: string | null
  rawPayload?: Record<string, any>
  skipExpensiveGeocoding?: boolean
}

function inferRegion(city?: string | null) {
  const normalized = (city || '').trim().toLowerCase()
  if (normalized === 'praha') return 'Hlavni mesto Praha'
  if (normalized === 'brno') return 'Jihomoravsky kraj'
  if (normalized === 'ostrava') return 'Moravskoslezsky kraj'
  if (normalized === 'plzen') return 'Plzensky kraj'
  if (normalized === 'olomouc') return 'Olomoucky kraj'
  return null
}

function parseLocationParts(location?: string | null) {
  const cleaned = (location || '').trim()
  if (!cleaned) {
    return { city: null, locality: null }
  }

  const commaParts = cleaned.split(',').map((part) => part.trim()).filter(Boolean)
  if (commaParts.length >= 2) {
    const trailing = commaParts[commaParts.length - 1]
    const trailingDashParts = trailing.split('-').map((part) => part.trim()).filter(Boolean)

    if (trailingDashParts.length >= 2) {
      return {
        city: trailingDashParts[0] || null,
        locality: trailingDashParts.slice(1).join(' - ') || null,
      }
    }

    return {
      city: trailing || null,
      locality: null,
    }
  }

  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  if (dashParts.length >= 2) {
    return {
      city: dashParts[0] || null,
      locality: dashParts.slice(1).join(' - ') || null,
    }
  }

  return {
    city: cleaned || null,
    locality: null,
  }
}

async function toPropertyPayload(input: ImportedPropertyInput) {
  const locationParts = parseLocationParts(input.location)
  const city = input.city || locationParts.city
  const locality = input.locality || locationParts.locality
  const payload = {
    title: input.title,
    address: input.location || `${locality || city || 'Neznama lokalita'}`,
    city,
    locality,
    region: input.region || inferRegion(city),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    geocode_source: input.geocodeSource || null,
    geocoded_at: input.geocodeSource ? new Date().toISOString() : null,
    ruian_address_code: null,
    property_type: input.propertyType,
    status: 'active',
    asking_price: input.priceNumeric ?? null,
  }
  if (input.skipExpensiveGeocoding) {
    return payload
  }
  return buildGeocodedPropertyPayload(payload)
}

export async function ensurePropertySourcesTable() {
  const { error: probeError } = await supabase
    .from('property_sources')
    .select('id', { head: true, count: 'exact' })
    .limit(1)

  if (!probeError) {
    return
  }

  const message = probeError.message || ''
  const relationMissing =
    /property_sources/i.test(message) &&
    (/does not exist/i.test(message) || /not exist/i.test(message) || /schema cache/i.test(message))

  if (!relationMissing) {
    throw new Error(`Nepodařilo se ověřit tabulku property_sources: ${message}`)
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS property_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source_url TEXT,
      synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      raw_payload JSONB DEFAULT '{}'::jsonb,
      UNIQUE(source, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_property_sources_property_id ON property_sources(property_id);
    CREATE INDEX IF NOT EXISTS idx_property_sources_source ON property_sources(source);
  `

  const { error } = await supabase.rpc('exec_sql', { sql })
  if (error) {
    throw new Error(`Nepodařilo se zajistit tabulku property_sources: ${error.message}`)
  }
}

export async function upsertImportedProperty(input: ImportedPropertyInput) {
  await ensurePropertySourcesTable()
  await ensurePropertyGeocodeColumns()

  const { data: existingSource, error: sourceError } = await supabase
    .from('property_sources')
    .select('property_id')
    .eq('source', input.source)
    .eq('external_id', input.externalId)
    .maybeSingle()

  if (sourceError) {
    throw new Error(sourceError.message)
  }

  const propertyPayload = await toPropertyPayload(input)
  const nowIso = new Date().toISOString()

  if (existingSource?.property_id) {
    let { data: existingProperty, error: existingPropertyError } = await supabase
      .from('properties')
      .select('id,latitude,longitude,ruian_address_code,geocode_source')
      .eq('id', existingSource.property_id)
      .maybeSingle()

    if (existingPropertyError) {
      const retry = await supabase
        .from('properties')
        .select('id,latitude,longitude')
        .eq('id', existingSource.property_id)
        .maybeSingle()

      existingProperty = retry.data as any
      existingPropertyError = retry.error as any
    }

    if (existingPropertyError) {
      throw new Error(existingPropertyError.message)
    }

    const hasProtectedCoordinates =
      existingProperty &&
      existingProperty.latitude != null &&
      existingProperty.longitude != null &&
      (existingProperty.ruian_address_code != null ||
        ['ruian_official_csv', 'manual_exact', 'sreality_detail_coordinates'].includes(existingProperty.geocode_source || ''))

    const safeExistingProperty = existingProperty || null

    const primaryUpdatePayload = hasProtectedCoordinates
      ? {
          ...propertyPayload,
          latitude: safeExistingProperty?.latitude ?? propertyPayload.latitude,
          longitude: safeExistingProperty?.longitude ?? propertyPayload.longitude,
          geocode_source: safeExistingProperty?.geocode_source ?? propertyPayload.geocode_source,
        }
      : propertyPayload

    let { data: property, error: propertyError } = await supabase
      .from('properties')
      .update(primaryUpdatePayload)
      .eq('id', existingSource.property_id)
      .select('*')
      .single()

    if (propertyError) {
      const fallbackPayload = stripUnsupportedPropertyGeocodeColumns(primaryUpdatePayload, propertyError.message)
      if (fallbackPayload !== primaryUpdatePayload) {
        const retry = await supabase
          .from('properties')
          .update(fallbackPayload)
          .eq('id', existingSource.property_id)
          .select('*')
          .single()

        property = retry.data as any
        propertyError = retry.error as any
      }
    }

    if (propertyError) {
      throw new Error(propertyError.message)
    }

    const { error: sourceUpdateError } = await supabase
      .from('property_sources')
      .update({
        source_url: input.sourceUrl,
        synced_at: nowIso,
        raw_payload: input.rawPayload || {},
      })
      .eq('source', input.source)
      .eq('external_id', input.externalId)

    if (sourceUpdateError) {
      throw new Error(sourceUpdateError.message)
    }

    return property
  }

  let { data: createdProperty, error: createError } = await supabase
    .from('properties')
    .insert(propertyPayload)
    .select('*')
    .single()

  if (createError) {
    const fallbackPayload = stripUnsupportedPropertyGeocodeColumns(propertyPayload, createError.message)
    if (fallbackPayload !== propertyPayload) {
      const retry = await supabase
        .from('properties')
        .insert(fallbackPayload)
        .select('*')
        .single()

      createdProperty = retry.data as any
      createError = retry.error as any
    }
  }

  if (createError) {
    throw new Error(createError.message)
  }

  const { error: sourceInsertError } = await supabase.from('property_sources').insert({
    property_id: createdProperty.id,
    source: input.source,
    external_id: input.externalId,
    source_url: input.sourceUrl,
    synced_at: nowIso,
    raw_payload: input.rawPayload || {},
  })

  if (sourceInsertError) {
    throw new Error(sourceInsertError.message)
  }

  return createdProperty
}
