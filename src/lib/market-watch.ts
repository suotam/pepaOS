export type MarketWatchSource = 'sreality' | 'bezrealitky'
export type MarketWatchCategory = 'byty' | 'domy'

export type MarketWatchListing = {
  source: MarketWatchSource
  listingId: string
  title: string
  price: string
  location: string
  url: string
  latitude?: number
  longitude?: number
}

export type MarketWatchConfig = {
  locationLabel?: string
  sources: MarketWatchSource[]
  category?: MarketWatchCategory
  searchUrls?: Partial<Record<MarketWatchSource, string>>
  seenListingIds?: string[]
  mode?: 'new' | 'latest'
  limit?: number
}

export type MarketWatchSourceResult = {
  source: MarketWatchSource
  totalCount: number | null
  listings: MarketWatchListing[]
}

export function isAnywhereLocation(locationLabel?: string) {
  const normalized = (locationLabel || '').trim().toLowerCase()
  return !normalized || ['kdekoliv', 'libovolne', 'libovolném městě', 'v libovolnem meste', 'cela cr', 'celá čr', 'všude', 'vsude'].includes(normalized)
}

export function buildSrealityUrl(locationLabel?: string, category: MarketWatchCategory = 'byty', page = 1) {
  const url = new URL(isAnywhereLocation(locationLabel) ? `https://www.sreality.cz/hledani/prodej/${category}` : `https://www.sreality.cz/hledani/prodej/${category}`)
  if (!isAnywhereLocation(locationLabel)) {
    url.searchParams.set('region', locationLabel || '')
  }
  if (page > 1) {
    url.searchParams.set('strana', String(page))
  }
  return url.toString()
}

export function buildBezrealitkyUrl(locationLabel?: string, category: MarketWatchCategory = 'byty') {
  const categorySlug = category === 'domy' ? 'dum' : 'byt'
  if (isAnywhereLocation(locationLabel)) {
    return `https://www.bezrealitky.cz/vypis/nabidka-prodej/${categorySlug}`
  }

  const slug = (locationLabel || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `https://www.bezrealitky.cz/vypis/nabidka-prodej/${categorySlug}/${slug}`
}

export function buildDefaultUrl(source: MarketWatchSource, locationLabel?: string, category: MarketWatchCategory = 'byty') {
  return source === 'sreality' ? buildSrealityUrl(locationLabel, category) : buildBezrealitkyUrl(locationLabel, category)
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
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

function extractSrealityListings(html: string, baseUrl: string): MarketWatchListing[] {
  const listings: MarketWatchListing[] = []
  const detailLinks = Array.from(
    html.matchAll(/href="(\/detail\/[^"]+)"[\s\S]{0,1500}?>([\s\S]{0,800}?)<\/a>/g)
  )

  for (const match of detailLinks) {
    const href = match[1]
    const chunk = match[0]
    const titleMatch =
      chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
      chunk.match(/<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    const parsedText = parseSrealityBlockText(chunk)
    const priceMatch =
      chunk.match(/(\d[\d\s\xa0]*Kč(?:\/měsíc)?|Cena na vyžádání)/i)
    const locationMatch =
      chunk.match(/Praha\s*-\s*Holešovice[\s\S]{0,80}?/) ||
      chunk.match(/([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][^<]{4,120})<\/[^>]+>\s*<\/[^>]+>\s*<\/a>/)

    const rawTitle = stripTags(titleMatch?.[1] || parsedText.title || '')
    const title = cleanupSrealityTitle(rawTitle)
    if (!title || !/byt|dům|dum|pozemek|chata|chalupa/i.test(title)) continue

    const listingIdMatch = href.match(/\/(\d+)(?:\/)?$/)
    const listingId = listingIdMatch?.[1] || href
    const derivedAddress = extractAddressFromListingTitle(rawTitle)
    listings.push({
      source: 'sreality',
      listingId: `sreality:${listingId}`,
      title,
      price: stripTags(priceMatch?.[1] || parsedText.price || 'Cena neuvedena'),
      location: derivedAddress || stripTags(locationMatch?.[0] || parsedText.plainText || ''),
      url: absoluteUrl(baseUrl, href),
    })
  }

  const deduped = new Map<string, MarketWatchListing>()
  listings.forEach((listing) => {
    if (!deduped.has(listing.listingId)) deduped.set(listing.listingId, listing)
  })
  return Array.from(deduped.values()).slice(0, 20)
}

function extractBezrealitkyListings(html: string, baseUrl: string): MarketWatchListing[] {
  const listings: MarketWatchListing[] = []
  const blocks = Array.from(
    html.matchAll(/<h2[^>]*>\s*(?:Prodej|Pronájem)\s+([^<]+)<\/h2>[\s\S]{0,1500}?(?=<h2|$)/gi)
  )

  for (const match of blocks) {
    const block = match[0]
    const location = stripTags(match[1] || '')
    const priceMatch = block.match(/(\d[\d\s\xa0]*Kč(?:\s*\(\d[\d\s\xa0]*Kč\s*\/\s*m²\))?)/i)
    const hrefMatch = block.match(/href="([^"]*\/nemovitosti-byty-domy\/[^"]+|[^"]*\/vypis\/detail\/[^"]+)"/i)
    const dispositionMatch = block.match(/(\d\+\w+)/i)
    const areaMatch = block.match(/(\d+\s*m²)/i)
    const title = `Prodej bytu ${dispositionMatch?.[1] || ''} ${areaMatch?.[1] || ''}`.replace(/\s+/g, ' ').trim()
    const href = hrefMatch?.[1]

    if (!href || !location) continue
    const listingId = href.replace(/^.*\/([^/?#]+).*$/, '$1')

    listings.push({
      source: 'bezrealitky',
      listingId: `bezrealitky:${listingId}`,
      title: title || 'Prodej bytu',
      price: stripTags(priceMatch?.[1] || 'Cena neuvedena'),
      location,
      url: absoluteUrl(baseUrl, href),
    })
  }

  const deduped = new Map<string, MarketWatchListing>()
  listings.forEach((listing) => {
    if (!deduped.has(listing.listingId)) deduped.set(listing.listingId, listing)
  })
  return Array.from(deduped.values()).slice(0, 20)
}

async function fetchSourceListings(source: MarketWatchSource, url: string): Promise<MarketWatchListing[]> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; pepaOS market watch)',
      accept: 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Zdroj ${source} vrátil chybu ${response.status}.`)
  }

  const html = await response.text()
  if (source === 'sreality') return extractSrealityListings(html, url)
  return extractBezrealitkyListings(html, url)
}

function extractTotalCount(source: MarketWatchSource, html: string) {
  if (source === 'sreality') {
    const headlineMatch = html.match(/<h1[^>]*>[\s\S]*?<\/h1>[\s\S]{0,400}?(\d[\d\s\xa0]*)\s+výsledků/i)
    if (headlineMatch?.[1]) {
      return Number(headlineMatch[1].replace(/[^\d]/g, ''))
    }

    const genericMatch = html.match(/(\d[\d\s\xa0]*)\s+výsledků/i)
    if (genericMatch?.[1]) {
      return Number(genericMatch[1].replace(/[^\d]/g, ''))
    }
  }

  if (source === 'bezrealitky') {
    const genericMatch = html.match(/(\d[\d\s\xa0]*)\s+(?:výsledků|nabídek|inzerátů)/i)
    if (genericMatch?.[1]) {
      return Number(genericMatch[1].replace(/[^\d]/g, ''))
    }
  }

  return null
}

async function fetchSourceResult(source: MarketWatchSource, url: string): Promise<MarketWatchSourceResult> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; pepaOS market watch)',
      accept: 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Zdroj ${source} vrátil chybu ${response.status}.`)
  }

  const html = await response.text()
  const listings = source === 'sreality' ? extractSrealityListings(html, url) : extractBezrealitkyListings(html, url)
  return {
    source,
    totalCount: extractTotalCount(source, html),
    listings,
  }
}

export async function fetchMarketWatchListings(config: MarketWatchConfig) {
  const results = await fetchMarketWatchSnapshot(config)
  return results.flatMap((result) => result.listings)
}

export async function fetchMarketWatchSnapshot(config: MarketWatchConfig) {
  const sources = config.sources.length ? config.sources : (['sreality', 'bezrealitky'] as MarketWatchSource[])
  return await Promise.all(
    sources.map(async (source) => {
      const searchUrl = config.searchUrls?.[source] || buildDefaultUrl(source, config.locationLabel, config.category || 'byty')
      return await fetchSourceResult(source, searchUrl)
    })
  )
}

export async function runMarketWatch(config: MarketWatchConfig) {
  const snapshot = await fetchMarketWatchSnapshot(config)
  const allListings = snapshot.flatMap((result) => result.listings)
  const seenIds = new Set(config.seenListingIds || [])
  const mode = config.mode || 'new'
  const limit = Math.max(1, Math.min(config.limit || 10, 50))
  const newListings = allListings.filter((listing) => !seenIds.has(listing.listingId))
  const selectedListings = mode === 'latest' ? allListings.slice(0, limit) : newListings

  return {
    snapshot,
    allListings,
    newListings,
    selectedListings,
    mode,
    limit,
    nextSeenListingIds: Array.from(
      new Set(Array.from(seenIds).concat(allListings.map((listing) => listing.listingId)))
    ).slice(-500),
  }
}

export function buildMarketWatchEmailBody(
  locationLabel: string | undefined,
  listings: MarketWatchListing[],
  options?: { mode?: 'new' | 'latest'; limit?: number }
) {
  const mode = options?.mode || 'new'
  const limit = options?.limit || listings.length
  const targetLabel = locationLabel || 'všechny lokality'

  if (!listings.length) {
    if (mode === 'latest') {
      return `Dobrý den,\n\npro lokalitu ${targetLabel} jsem teď nenašel žádné nabídky v režimu posledních ${limit} záznamů.\n`
    }
    return `Dobrý den,\n\nza poslední běh jsem nenašel žádné nové nabídky pro lokalitu ${targetLabel}.\n`
  }

  const lines = listings.map((listing, index) => {
    return [
      `${index + 1}. ${listing.title}`,
      `Zdroj: ${listing.source}`,
      `Lokalita: ${listing.location}`,
      `Cena: ${listing.price}`,
      `Odkaz: ${listing.url}`,
    ].join('\n')
  })

  const intro =
    mode === 'latest'
      ? `Dobrý den,\n\nposílám ${listings.length} nejnovějších nabídek pro lokalitu ${targetLabel}.\n\n`
      : `Dobrý den,\n\nnašel jsem ${listings.length} nových nabídek pro lokalitu ${targetLabel}.\n\n`

  return `${intro}${lines.join('\n\n')}\n`
}
