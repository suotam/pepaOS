import { supabase } from './supabase'
import { buildSrealityUrl, type MarketWatchCategory, type MarketWatchListing, type MarketWatchSourceResult } from './market-watch'
import { ensurePropertySourcesTable, upsertImportedProperty } from './property-sources'

type SyncParams = {
  locationLabel?: string
  categories?: MarketWatchCategory[]
  maxPrice?: number
  maxPages?: number
  limit?: number
}

type QueryParams = {
  source?: string
  locationLabel?: string
  city?: string
  district?: string
  category?: MarketWatchCategory
  maxPrice?: number
  minPrice?: number
  limit?: number
  query?: string
}

type StoredMarketListing = {
  source: string
  external_id: string
  listing_type: string
  property_category: string
  title: string
  price_text: string | null
  price_numeric: number | null
  currency: string
  location: string | null
  city: string | null
  district: string | null
  address: string | null
  url: string
  synced_at: string
  raw_payload: Record<string, any>
  is_active: boolean
}

type StoreListingsParams = {
  listings: MarketWatchListing[]
  category?: MarketWatchCategory
}

let marketSchemaEnsured = false

async function ensureMarketListingsTable() {
  if (marketSchemaEnsured) return

  const { error: probeError } = await supabase
    .from('market_listings')
    .select('id', { head: true, count: 'exact' })
    .limit(1)

  if (!probeError) {
    marketSchemaEnsured = true
    return
  }

  const message = probeError.message || ''
  const relationMissing =
    /market_listings/i.test(message) &&
    (/does not exist/i.test(message) || /not exist/i.test(message) || /schema cache/i.test(message))

  if (!relationMissing) {
    throw new Error(`Nepodařilo se ověřit tabulku market_listings: ${message}`)
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS market_listings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      listing_type TEXT DEFAULT 'sale',
      property_category TEXT,
      title TEXT NOT NULL,
      price_text TEXT,
      price_numeric NUMERIC,
      currency TEXT DEFAULT 'CZK',
      location TEXT,
      city TEXT,
      district TEXT,
      address TEXT,
      url TEXT NOT NULL,
      first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      is_active BOOLEAN DEFAULT TRUE,
      raw_payload JSONB DEFAULT '{}'::jsonb,
      UNIQUE(source, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_market_listings_source ON market_listings(source);
    CREATE INDEX IF NOT EXISTS idx_market_listings_category ON market_listings(property_category);
    CREATE INDEX IF NOT EXISTS idx_market_listings_city ON market_listings(city);
    CREATE INDEX IF NOT EXISTS idx_market_listings_district ON market_listings(district);
    CREATE INDEX IF NOT EXISTS idx_market_listings_price_numeric ON market_listings(price_numeric);
    CREATE INDEX IF NOT EXISTS idx_market_listings_last_seen_at ON market_listings(last_seen_at DESC);
  `

  const { error } = await supabase.rpc('exec_sql', { sql })
  if (error) {
    throw new Error(`Nepodařilo se zajistit tabulku market_listings: ${error.message}`)
  }

  marketSchemaEnsured = true
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

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function absoluteUrl(baseUrl: string, value: string) {
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return new URL(value, baseUrl).toString()
}

function parseSrealityBlockText(block: string) {
  const plainText = stripTags(block)
  const priceMatch = plainText.match(/(\d[\d\s\xa0]*Kč(?:\/měsíc)?|Cena na vyžádání)/i)
  const beforePrice = priceMatch ? plainText.slice(0, plainText.indexOf(priceMatch[1])).trim() : plainText
  const titleMatch = beforePrice.match(/((?:Prodej|Pronájem)\s+(?:bytu|domu|pozemku|komerčního prostoru|chaty|chalupy)[^]+)$/i)
  const title = (titleMatch?.[1] || beforePrice).replace(/\s+/g, ' ').trim()
  return {
    plainText,
    title,
    price: priceMatch?.[1] || 'Cena neuvedena',
  }
}

function normalizeWhitespace(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim()
}

function cleanupSrealityTitle(rawTitle: string) {
  let title = normalizeWhitespace(rawTitle)
  title = title.replace(/^href="[^"]+">\s*/i, '')
  title = title.replace(/^Prodej\s+/i, '')
  title = title.replace(/^Pron[aá]jem\s+/i, '')
  title = title.replace(/^rodinn[ée]ho domu/i, 'Rodinný dům')
  title = title.replace(/^bytu/i, 'Byt')
  title = title.replace(/^domu/i, 'Dům')
  title = title.replace(/^pozemku/i, 'Pozemek')
  title = title.replace(/^chaty/i, 'Chata')
  title = title.replace(/^chalupy/i, 'Chalupa')
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

function parsePriceNumeric(priceText?: string | null) {
  if (!priceText) return null
  const match = priceText.match(/(\d[\d\s\xa0]*)/)
  if (!match?.[1]) return null
  const parsed = Number(match[1].replace(/[^\d]/g, ''))
  return Number.isNaN(parsed) ? null : parsed
}

function inferCategoryFromListing(listing: MarketWatchListing, fallback?: MarketWatchCategory): MarketWatchCategory {
  if (fallback) return fallback

  const haystack = `${listing.title} ${listing.location}`.toLowerCase()
  if (/\bdům\b|\bdomu\b|\bdomy\b|\bdomek\b|\bhouse\b/i.test(haystack)) return 'domy'
  return 'byty'
}

function splitLocation(location?: string | null) {
  const cleaned = (location || '').trim()
  if (!cleaned) {
    return { city: null, district: null }
  }

  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const trailing = parts[parts.length - 1]
    const trailingDashParts = trailing.split('-').map((part) => part.trim()).filter(Boolean)

    if (trailingDashParts.length >= 2) {
      return {
        city: trailingDashParts[0] || null,
        district: trailingDashParts.slice(1).join(' - ') || null,
      }
    }

    return {
      city: trailing || null,
      district: null,
    }
  }

  const dashParts = cleaned.split('-').map((part) => part.trim()).filter(Boolean)
  if (dashParts.length >= 2) {
    return {
      city: dashParts[0] || null,
      district: dashParts.slice(1).join(' - ') || null,
    }
  }

  return {
    city: cleaned || null,
    district: null,
  }
}

function extractSrealityListingsFromHtml(html: string, url: string, category: MarketWatchCategory): MarketWatchSourceResult {
  const listings: MarketWatchListing[] = []
  const blocks = Array.from(
    html.matchAll(/href="(\/detail\/[^"]+)"[\s\S]{0,2500}?<\/a>/g)
  )

  for (const match of blocks) {
    const href = match[1]
    const block = match[0]
    const titleMatch =
      block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
      block.match(/<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    const parsedText = parseSrealityBlockText(block)
    const locationMatch =
      block.match(/<span[^>]*class="[^"]*locality[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
      block.match(/<p[^>]*>([\s\S]*?(?:Praha|Brno|Ostrava|Plzeň|Olomouc)[\s\S]*?)<\/p>/i)
    const priceMatch = block.match(/(\d[\d\s\xa0]*Kč(?:\/měsíc)?|Cena na vyžádání)/i)
    const rawTitle = stripTags(titleMatch?.[1] || parsedText.title || '')
    const title = cleanupSrealityTitle(rawTitle)
    if (!title || !/byt|dům|dum|pozemek|komerční|chata|chalupa/i.test(title)) continue

    const listingIdMatch = href.match(/\/(\d+)(?:\/)?$/)
    const listingId = listingIdMatch?.[1] || href
    const derivedAddress = extractAddressFromListingTitle(rawTitle)
    listings.push({
      source: 'sreality',
      listingId: `sreality:${listingId}`,
      title,
      price: stripTags(priceMatch?.[1] || parsedText.price || 'Cena neuvedena'),
      location: derivedAddress || stripTags(locationMatch?.[1] || locationMatch?.[0] || parsedText.plainText || ''),
      url: absoluteUrl(url, href),
    })
  }

  const countMatch = html.match(/(\d[\d\s\xa0]*)\s+výsledků/i)
  const totalCount = countMatch?.[1] ? Number(countMatch[1].replace(/[^\d]/g, '')) : null
  const deduped = new Map<string, MarketWatchListing>()
  listings.forEach((listing) => {
    if (!deduped.has(listing.listingId)) deduped.set(listing.listingId, listing)
  })

  return {
    source: 'sreality',
    totalCount,
    listings: Array.from(deduped.values()).map((listing) => ({
      ...listing,
      title: listing.title || (category === 'domy' ? 'Dům' : 'Byt'),
    })),
  }
}

async function fetchSrealityPage(category: MarketWatchCategory, locationLabel: string | undefined, page: number) {
  const url = buildSrealityUrl(locationLabel, category, page)
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; pepaOS market db sync)',
      accept: 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Sreality sync failed with status ${response.status}.`)
  }

  const html = await response.text()
  return extractSrealityListingsFromHtml(html, url, category)
}

function extractAddressFromSrealityDetailHtml(html: string) {
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const compositeTitle = decodeHtmlEntities((ogTitleMatch?.[1] || titleTagMatch?.[1] || '').trim())

  const titleAddressMatch = compositeTitle.match(/^(?:Prodej|Pron[aá]jem)[^,]*,\s*(.+?)(?:\s*[•|-]\s*Sreality\.cz.*)?$/i)
  if (titleAddressMatch?.[1]) {
    return titleAddressMatch[1].trim()
  }

  const headingAddressMatch = html.match(/<h1[^>]*>[\s\S]*?<\/h1>[\s\S]{0,500}?>([^<]+,\s*[^<]+)</i)
  if (headingAddressMatch?.[1]) {
    return stripTags(headingAddressMatch[1])
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

async function enrichSrealityListing(listing: MarketWatchListing) {
  if (listing.source !== 'sreality') return listing

  try {
    const response = await fetch(listing.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; pepaOS market db sync)',
        accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
    })

    if (!response.ok) return listing

    const html = await response.text()
    const detailAddress = extractAddressFromSrealityDetailHtml(html)
    const detailCoordinates = extractCoordinatesFromSrealityDetailHtml(html)

    return {
      ...listing,
      location: detailAddress || listing.location,
      latitude: detailCoordinates?.latitude,
      longitude: detailCoordinates?.longitude,
    }
  } catch {
    return listing
  }
}

function listingMatchesFilters(listing: MarketWatchListing, params: SyncParams) {
  if (typeof params.maxPrice === 'number') {
    const priceNumeric = parsePriceNumeric(listing.price)
    if (priceNumeric !== null && priceNumeric > params.maxPrice) return false
  }

  if (params.locationLabel) {
    const normalizedLocation = params.locationLabel.toLowerCase()
    if (!listing.location.toLowerCase().includes(normalizedLocation) && !listing.title.toLowerCase().includes(normalizedLocation)) {
      return false
    }
  }

  return true
}

function toStoredListing(listing: MarketWatchListing, category?: MarketWatchCategory): StoredMarketListing {
  const resolvedCategory = inferCategoryFromListing(listing, category)
  const externalId = listing.listingId.replace(/^[^:]+:/, '')
  const locationParts = splitLocation(listing.location)
  return {
    source: listing.source,
    external_id: externalId,
    listing_type: 'sale',
    property_category: resolvedCategory,
    title: listing.title,
    price_text: listing.price || null,
    price_numeric: parsePriceNumeric(listing.price),
    currency: 'CZK',
    location: listing.location || null,
    city: locationParts.city,
    district: locationParts.district,
    address: listing.location || null,
    url: listing.url,
    synced_at: new Date().toISOString(),
    raw_payload: listing as any,
    is_active: true,
  }
}

async function persistStoredListings(deduped: StoredMarketListing[]) {
  if (!deduped.length) {
    return { synced: 0, listings: [] as StoredMarketListing[], properties: [] as any[] }
  }

  const nowIso = new Date().toISOString()
  const rows = deduped.map((listing) => ({
    ...listing,
    last_seen_at: nowIso,
    synced_at: nowIso,
  }))

  const { error } = await supabase.from('market_listings').upsert(rows, {
    onConflict: 'source,external_id',
    ignoreDuplicates: false,
  })

  if (error) {
    throw new Error(error.message)
  }

  const syncedProperties: any[] = []
  for (const listing of deduped) {
    const property = await upsertImportedProperty({
      source: listing.source,
      externalId: listing.external_id,
      sourceUrl: listing.url,
      title: listing.title,
      priceText: listing.price_text,
      priceNumeric: listing.price_numeric,
      location: listing.location,
      city: listing.city,
      locality: listing.district,
      region: null,
      propertyType:
        listing.property_category === 'domy'
          ? 'house'
          : listing.property_category === 'byty'
            ? 'apartment'
            : 'apartment',
      latitude: (listing.raw_payload as any)?.latitude ?? null,
      longitude: (listing.raw_payload as any)?.longitude ?? null,
      geocodeSource: listing.source === 'sreality'
        ? (
            (listing.raw_payload as any)?.latitude != null && (listing.raw_payload as any)?.longitude != null
              ? 'sreality_detail_coordinates'
              : /\d+/.test(listing.location || '')
                ? 'sreality_detail_address'
                : 'sreality_detail_location'
          )
        : null,
      rawPayload: listing.raw_payload,
      skipExpensiveGeocoding: true,
    })
    syncedProperties.push(property)
  }

  return {
    synced: rows.length,
    listings: rows,
    properties: syncedProperties,
  }
}

export async function syncSrealityListings(params: SyncParams) {
  await ensureMarketListingsTable()
  const categories = params.categories?.length ? params.categories : (['byty', 'domy'] as MarketWatchCategory[])
  const maxPages = Math.max(1, Math.min(params.maxPages || 5, 25))
  const targetLimit =
    typeof params.limit === 'number' && params.limit > 0 ? Math.max(1, Math.min(params.limit, 100)) : null
  const syncedListings: StoredMarketListing[] = []
  let fetchedCount = 0

  for (const category of categories) {
    for (let page = 1; page <= maxPages; page += 1) {
      const pageResult = await fetchSrealityPage(category, params.locationLabel, page)
      if (!pageResult.listings.length) break

      fetchedCount += pageResult.listings.length
      const filtered = pageResult.listings.filter((listing) => listingMatchesFilters(listing, params))
      const remaining = targetLimit === null ? filtered.length : Math.max(targetLimit - syncedListings.length, 0)
      const selected = targetLimit === null ? filtered : filtered.slice(0, remaining)
      const enrichedSelected = await Promise.all(selected.map((listing) => enrichSrealityListing(listing)))
      syncedListings.push(...enrichedSelected.map((listing) => toStoredListing(listing, category)))

      if (targetLimit !== null && syncedListings.length >= targetLimit) break

      if (pageResult.listings.length < 20) break
    }

    if (targetLimit !== null && syncedListings.length >= targetLimit) break
  }

  const deduped = Array.from(
    syncedListings.reduce((map, listing) => {
      map.set(`${listing.source}:${listing.external_id}`, listing)
      return map
    }, new Map<string, StoredMarketListing>()).values()
  )

  if (!deduped.length) {
    return { synced: 0, fetched: fetchedCount, listings: [] as StoredMarketListing[] }
  }

  const persisted = await persistStoredListings(deduped)

  return {
    synced: persisted.synced,
    fetched: fetchedCount,
    listings: persisted.listings,
    properties: persisted.properties,
  }
}

export async function storeMarketListings(params: StoreListingsParams) {
  await ensureMarketListingsTable()
  const enrichedListings = await Promise.all(
    params.listings.map((listing) => (listing.source === 'sreality' ? enrichSrealityListing(listing) : listing))
  )
  const deduped = Array.from(
    enrichedListings.reduce((map, listing) => {
      const stored = toStoredListing(listing, params.category)
      map.set(`${stored.source}:${stored.external_id}`, stored)
      return map
    }, new Map<string, StoredMarketListing>()).values()
  )

  return await persistStoredListings(deduped)
}

export async function queryMarketListings(params: QueryParams) {
  await ensureMarketListingsTable()
  await ensurePropertySourcesTable()

  let sourceQuery = supabase
    .from('property_sources')
    .select('property_id, source, external_id, source_url, synced_at, raw_payload')
    .order('synced_at', { ascending: false })
    .limit(Math.max(1, Math.min(params.limit || 25, 100)) * 4)

  if (params.source) sourceQuery = sourceQuery.eq('source', params.source)

  const { data: sourceRows, error: sourceError } = await sourceQuery
  if (sourceError) throw new Error(sourceError.message)

  const propertyIds = (sourceRows || []).map((row: any) => row.property_id)
  if (!propertyIds.length) return []

  let propertyQuery = supabase
    .from('properties')
    .select('*')
    .in('id', propertyIds)
    .order('created_at', { ascending: false })

  if (params.category) {
    propertyQuery = propertyQuery.eq('property_type', params.category === 'domy' ? 'house' : 'apartment')
  }
  if (typeof params.maxPrice === 'number') propertyQuery = propertyQuery.lte('asking_price', params.maxPrice)
  if (typeof params.minPrice === 'number') propertyQuery = propertyQuery.gte('asking_price', params.minPrice)
  if (params.city) propertyQuery = propertyQuery.ilike('city', `%${params.city}%`)
  if (params.district) propertyQuery = propertyQuery.ilike('locality', `%${params.district}%`)
  if (params.locationLabel) propertyQuery = propertyQuery.or(`locality.ilike.%${params.locationLabel}%,city.ilike.%${params.locationLabel}%,address.ilike.%${params.locationLabel}%`)
  if (params.query) propertyQuery = propertyQuery.or(`title.ilike.%${params.query}%,address.ilike.%${params.query}%`)

  const { data: properties, error: propertyError } = await propertyQuery
  if (propertyError) throw new Error(propertyError.message)

  const sourceByPropertyId = new Map<string, any>()
  ;(sourceRows || []).forEach((row: any) => {
    if (!sourceByPropertyId.has(row.property_id)) sourceByPropertyId.set(row.property_id, row)
  })

  return (properties || [])
    .map((property: any) => ({
      ...property,
      source: sourceByPropertyId.get(property.id)?.source || null,
      external_id: sourceByPropertyId.get(property.id)?.external_id || null,
      source_url: sourceByPropertyId.get(property.id)?.source_url || null,
      url: sourceByPropertyId.get(property.id)?.source_url || null,
      location: property.address || null,
      last_seen_at: sourceByPropertyId.get(property.id)?.synced_at || property.created_at,
      price_text: property.asking_price ? `${Number(property.asking_price).toLocaleString('cs-CZ')} Kč` : null,
      property_category:
        property.property_type === 'house'
          ? 'domy'
          : property.property_type === 'apartment'
            ? 'byty'
            : property.property_type || null,
    }))
    .slice(0, Math.max(1, Math.min(params.limit || 25, 100)))
}

export async function countMarketListings(params: Omit<QueryParams, 'limit' | 'query'> & { query?: string }) {
  await ensureMarketListingsTable()
  const listings = await queryMarketListings({ ...params, limit: 1000 })
  return listings.length
}
