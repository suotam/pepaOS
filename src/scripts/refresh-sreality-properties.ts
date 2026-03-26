import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import { supabase } from '../lib/supabase'
import { upsertImportedProperty } from '../lib/property-sources'

type SourceRow = {
  property_id: string
  external_id: string
  source_url: string | null
  raw_payload: Record<string, any> | null
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeWhitespace(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim()
}

function cleanupSrealityTitle(rawTitle: string) {
  let title = normalizeWhitespace(rawTitle)
  title = title.replace(/^Prodej\s+/i, '')
  title = title.replace(/^Pron[aá]jem\s+/i, '')
  title = title.replace(/^rodinn[ée]ho domu/i, 'Rodinný dům')
  title = title.replace(/^bytu/i, 'Byt')
  title = title.replace(/^domu/i, 'Dům')
  title = title.replace(/^pozemku/i, 'Pozemek')
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function extractAddressFromListingTitle(title: string) {
  const normalized = normalizeWhitespace(title)
  const withoutAction = normalized.replace(/^(?:Prodej|Pron[aá]jem)\s+/i, '')
  const addressMatch = withoutAction.match(/(?:\d+\+\w+|\d+\s*m²|pozemek\s+\d+\s*m²)\s+(.+)$/i)
  if (addressMatch?.[1]) {
    return normalizeWhitespace(addressMatch[1])
  }
  const commaIndex = withoutAction.indexOf(',')
  if (commaIndex >= 0) {
    return normalizeWhitespace(withoutAction.slice(commaIndex + 1))
  }
  return null
}

function parseLocationParts(location?: string | null) {
  const cleaned = (location || '').trim()
  if (!cleaned) {
    return { city: null as string | null, locality: null as string | null }
  }

  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const trailing = parts[parts.length - 1]
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

function extractAddressFromSrealityDetailHtml(html: string) {
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const compositeTitle = decodeHtmlEntities((ogTitleMatch?.[1] || titleTagMatch?.[1] || '').trim())

  const titleAddressMatch = compositeTitle.match(/^(?:Prodej|Pron[aá]jem)[^,]*,\s*(.+?)(?:\s*[•|-]\s*Sreality\.cz.*)?$/i)
  if (titleAddressMatch?.[1]) {
    return normalizeWhitespace(titleAddressMatch[1])
  }

  const headingAddressMatch = html.match(/<h1[^>]*>[\s\S]*?<\/h1>[\s\S]{0,500}?>([^<]+,\s*[^<]+)</i)
  if (headingAddressMatch?.[1]) {
    return normalizeWhitespace(headingAddressMatch[1])
  }

  return null
}

function extractCoordinatesFromSrealityDetailHtml(html: string) {
  const patterns = [
    /mapy\.(?:cz|com)[^"'\s>]*[?&]x=(\d+\.\d+)[^"'\s>]*[?&]y=(\d+\.\d+)/i,
    /"longitude"\s*:\s*(\d+\.\d+)\s*,\s*"latitude"\s*:\s*(\d+\.\d+)/i,
    /"lng"\s*:\s*(\d+\.\d+)\s*,\s*"lat"\s*:\s*(\d+\.\d+)/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (!match) continue
    const longitude = Number(match[1])
    const latitude = Number(match[2])
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
      }
    }
  }

  return null
}

async function refreshSrealityProperties() {
  const { data, error } = await supabase
    .from('property_sources')
    .select('property_id,external_id,source_url,raw_payload')
    .eq('source', 'sreality')
    .order('synced_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load property_sources: ${error.message}`)
  }

  const rows = (data || []) as SourceRow[]
  let refreshed = 0

  for (const row of rows) {
    if (!row.source_url) continue

    try {
      const response = await fetch(row.source_url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; pepaOS refresh sreality)',
          accept: 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      })

      if (!response.ok) {
        continue
      }

      const html = await response.text()
      const rawPayload = row.raw_payload || {}
      const rawTitle = String(rawPayload.title || '')
      const detailAddress = extractAddressFromSrealityDetailHtml(html) || extractAddressFromListingTitle(rawTitle) || String(rawPayload.location || '')
      const detailCoordinates = extractCoordinatesFromSrealityDetailHtml(html)
      const parts = parseLocationParts(detailAddress)

      await upsertImportedProperty({
        source: 'sreality',
        externalId: row.external_id,
        sourceUrl: row.source_url,
        title: cleanupSrealityTitle(rawTitle || String(rawPayload.title || 'Nemovitost')),
        priceText: typeof rawPayload.price === 'string' ? rawPayload.price : null,
        priceNumeric: typeof rawPayload.price === 'string' ? Number(String(rawPayload.price).replace(/[^\d]/g, '')) || null : null,
        location: detailAddress,
        city: parts.city,
        locality: parts.locality,
        region: null,
        propertyType: /d[uů]m|domu|domy/i.test(rawTitle) ? 'house' : 'apartment',
        latitude: detailCoordinates?.latitude ?? null,
        longitude: detailCoordinates?.longitude ?? null,
        geocodeSource: detailCoordinates ? 'sreality_detail_coordinates' : /\d+/.test(detailAddress || '') ? 'sreality_detail_address' : 'sreality_detail_location',
        rawPayload: {
          ...rawPayload,
          location: detailAddress,
          latitude: detailCoordinates?.latitude ?? rawPayload.latitude,
          longitude: detailCoordinates?.longitude ?? rawPayload.longitude,
          title: cleanupSrealityTitle(rawTitle || String(rawPayload.title || 'Nemovitost')),
        },
      })

      refreshed += 1
    } catch {
      continue
    }
  }

  console.log(`Refreshed Sreality properties: ${refreshed}`)
}

refreshSrealityProperties().catch((error) => {
  console.error(error)
  process.exit(1)
})
