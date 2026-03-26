import fs from 'fs'
import path from 'path'
import proj4 from 'proj4'

import { alignPropertyCoordinates, backfillPropertyLocation, sanitizePropertyAddress } from './czech-property-seed'
import { supabase } from './supabase'

type Nullable<T> = T | null | undefined

export type RuianMatch = {
  addressCode: string | null
  city: string
  locality: string
  street: string
  houseNumber: string
  orientationNumber: string
  latitude: number
  longitude: number
}

export type PropertyGeocodeInput = {
  id?: string | null
  title?: string | null
  address: string
  city?: string | null
  locality?: string | null
  region?: string | null
  latitude?: number | null
  longitude?: number | null
  geocode_source?: string | null
  geocoded_at?: string | null
  ruian_address_code?: number | null
}

type PreparedPropertyGeocode = {
  address: string
  city: string | null
  locality: string | null
  region: string | null | undefined
  latitude: number
  longitude: number
  geocode_source: string | null
  geocoded_at: string | null
  ruian_address_code: number | null
}

type LoadOptions = {
  csvPath?: string | null
  strict?: boolean
}

type CachedIndex = {
  csvPath: string
  exactIndex: Map<string, RuianMatch>
  streetIndex: Map<string, CoordinateAggregate>
  localityIndex: Map<string, CoordinateAggregate>
  cityIndex: Map<string, CoordinateAggregate>
}

type CoordinateAggregate = {
  latitude: number
  longitude: number
  sampleAddressCode: string | null
}

const S_JTSK =
  '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813975277778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs'
const WGS84 = proj4.WGS84
const EXACT_GEOCODE_SOURCES = new Set(['ruian_official_csv', 'manual_exact', 'sreality_detail_coordinates'])
const warnedPaths = new Set<string>()

let cachedIndex: CachedIndex | null = null
let propertyGeocodeColumnsEnsured = false

function normalizeText(value: Nullable<string>) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"'
        i++
      } else {
        quoted = !quoted
      }
      continue
    }

    if (char === ';' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function toNumber(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function pickValue(record: Record<string, string>, aliases: string[]) {
  const normalizedAliases = aliases.map((alias) => normalizeText(alias))

  for (const [key, value] of Object.entries(record)) {
    if (normalizedAliases.includes(normalizeText(key))) {
      return value
    }
  }

  return ''
}

function parseAddress(address: string) {
  const normalized = sanitizePropertyAddress(address).trim()
  const match = normalized.match(/^(.*?)[ ,]+(\d+)(?:\/(\d+))?$/)

  if (!match) {
    const commaParts = normalized
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    return {
      street: commaParts.length >= 2 ? commaParts[0] : '',
      houseNumber: '',
      orientationNumber: '',
    }
  }

  return {
    street: match[1].trim(),
    houseNumber: match[2] || '',
    orientationNumber: match[3] || '',
  }
}

function parseCityAndLocalityFromAddress(address: string) {
  const cleaned = sanitizePropertyAddress(address).trim()
  if (!cleaned) {
    return { city: null, locality: null }
  }

  const commaParts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (commaParts.length >= 2) {
    const trailing = commaParts[commaParts.length - 1]
    const trailingDashParts = trailing
      .split('-')
      .map((part: string) => part.trim())
      .filter(Boolean)

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

  const dashParts = cleaned
    .split('-')
    .map((part: string) => part.trim())
    .filter(Boolean)

  if (dashParts.length >= 2) {
    return {
      city: dashParts[0] || null,
      locality: dashParts.slice(1).join(' - ') || null,
    }
  }

  return { city: null, locality: null }
}

function toWgs84(x: number | null, y: number | null, latitude: number | null, longitude: number | null) {
  if (latitude != null && longitude != null) {
    return { latitude, longitude }
  }

  if (x == null || y == null) {
    return null
  }

  const [convertedLongitude, convertedLatitude] = proj4(S_JTSK, WGS84, [-y, -x])
  return {
    latitude: Number(convertedLatitude.toFixed(6)),
    longitude: Number(convertedLongitude.toFixed(6)),
  }
}

function parseRuianCsv(filePath: string) {
  const buffer = fs.readFileSync(filePath)
  const decoder = new TextDecoder('windows-1250')
  const raw = decoder.decode(buffer).replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter(Boolean)

  if (lines.length < 2) {
    throw new Error('CSV file is empty or missing header row.')
  }

  const headers = parseCsvLine(lines[0])
  const rows: RuianMatch[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const record: Record<string, string> = {}

    headers.forEach((header, index) => {
      record[header] = values[index] || ''
    })

    const city = pickValue(record, ['obec', 'nazev_obce'])
    const locality = pickValue(record, ['cast_obce', 'nazev_casti_obce', 'mestska_cast', 'nazev_mestske_casti'])
    const street = pickValue(record, ['ulice', 'nazev_ulice'])
    const houseNumber = pickValue(record, ['cislo_domovni', 'cislo_popisne', 'cp', 'cislo_evidencni'])
    const orientationNumber = pickValue(record, ['cislo_orientacni', 'co'])
    const addressCode = pickValue(record, ['kod_adresniho_mista', 'kod_adm', 'kod'])

    const x = toNumber(pickValue(record, ['x', 'souradnice_x', 'x_jtsk']))
    const y = toNumber(pickValue(record, ['y', 'souradnice_y', 'y_jtsk']))
    const latitude = toNumber(pickValue(record, ['latitude', 'lat', 'etrs89_lat']))
    const longitude = toNumber(pickValue(record, ['longitude', 'lon', 'lng', 'etrs89_lon']))
    const coords = toWgs84(x, y, latitude, longitude)

    if (!city || !street || !houseNumber || !coords) {
      continue
    }

    rows.push({
      addressCode: addressCode || null,
      city,
      locality: locality || city,
      street,
      houseNumber,
      orientationNumber,
      latitude: coords.latitude,
      longitude: coords.longitude,
    })
  }

  return rows
}

function tryParseRuianCsv(filePath: string) {
  try {
    return parseRuianCsv(filePath)
  } catch (error) {
    return []
  }
}

function collectCsvFiles(targetPath: string): string[] {
  const stat = fs.statSync(targetPath)

  if (stat.isFile()) {
    return targetPath.toLowerCase().endsWith('.csv') ? [targetPath] : []
  }

  if (!stat.isDirectory()) {
    return []
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const nextPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectCsvFiles(nextPath))
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
      files.push(nextPath)
    }
  }

  return files
}

function buildRuianIndex(rows: RuianMatch[]) {
  const exactIndex = new Map<string, RuianMatch>()
  const streetBuckets = new Map<string, RuianMatch[]>()
  const localityBuckets = new Map<string, RuianMatch[]>()
  const cityBuckets = new Map<string, RuianMatch[]>()

  const pushBucket = (bucket: Map<string, RuianMatch[]>, key: string, row: RuianMatch) => {
    const rowsForKey = bucket.get(key) || []
    rowsForKey.push(row)
    bucket.set(key, rowsForKey)
  }

  rows.forEach((row) => {
    const key = [
      normalizeText(row.city),
      normalizeText(row.locality),
      normalizeText(row.street),
      row.houseNumber,
      row.orientationNumber,
    ].join('|')

    exactIndex.set(key, row)

    const keyWithoutLocality = [
      normalizeText(row.city),
      '',
      normalizeText(row.street),
      row.houseNumber,
      row.orientationNumber,
    ].join('|')

    exactIndex.set(keyWithoutLocality, row)

    pushBucket(streetBuckets, [normalizeText(row.city), normalizeText(row.locality), normalizeText(row.street)].join('|'), row)
    pushBucket(streetBuckets, [normalizeText(row.city), '', normalizeText(row.street)].join('|'), row)
    pushBucket(localityBuckets, [normalizeText(row.city), normalizeText(row.locality)].join('|'), row)
    pushBucket(cityBuckets, normalizeText(row.city), row)
  })

  const toAggregate = (bucket: Map<string, RuianMatch[]>) => {
    const aggregate = new Map<string, CoordinateAggregate>()

    bucket.forEach((bucketRows, key) => {
      const latitude = bucketRows.reduce((sum, row) => sum + row.latitude, 0) / bucketRows.length
      const longitude = bucketRows.reduce((sum, row) => sum + row.longitude, 0) / bucketRows.length

      aggregate.set(key, {
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
        sampleAddressCode: bucketRows[0]?.addressCode || null,
      })
    })

    return aggregate
  }

  return {
    exactIndex,
    streetIndex: toAggregate(streetBuckets),
    localityIndex: toAggregate(localityBuckets),
    cityIndex: toAggregate(cityBuckets),
  }
}

function resolveRuianCsvPath(csvPath?: string | null) {
  const explicitPath = (csvPath || process.env.RUIAN_CSV_PATH || '').trim()
  if (!explicitPath) return null
  return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath)
}

function loadRuianIndex(options: LoadOptions = {}) {
  const resolvedPath = resolveRuianCsvPath(options.csvPath)

  if (!resolvedPath) {
    if (options.strict) {
      throw new Error('RUIAN CSV path is not configured. Set RUIAN_CSV_PATH or pass a csvPath option.')
    }
    return null
  }

  if (!fs.existsSync(resolvedPath)) {
    if (options.strict) {
      throw new Error(`RUIAN CSV file not found: ${resolvedPath}`)
    }

    if (!warnedPaths.has(resolvedPath)) {
      console.warn(`RUIAN CSV file not found, falling back to heuristic geocoding: ${resolvedPath}`)
      warnedPaths.add(resolvedPath)
    }

    return null
  }

  if (cachedIndex?.csvPath === resolvedPath) {
    return cachedIndex
  }

  const csvFiles = collectCsvFiles(resolvedPath)

  if (csvFiles.length === 0) {
    if (options.strict) {
      throw new Error(`No CSV files found in RUIAN path: ${resolvedPath}`)
    }
    return null
  }

  const rows = csvFiles.flatMap((csvFilePath) => tryParseRuianCsv(csvFilePath))
  const index = buildRuianIndex(rows)
  cachedIndex = {
    csvPath: resolvedPath,
    ...index,
  }

  return cachedIndex
}

export function getConfiguredRuianCsvPath() {
  return resolveRuianCsvPath()
}

export async function ensurePropertyGeocodeColumns() {
  if (propertyGeocodeColumnsEnsured) {
    return
  }

  const { error: probeError } = await supabase
    .from('properties')
    .select('geocode_source', { head: true, count: 'exact' })
    .limit(1)

  if (!probeError) {
    propertyGeocodeColumnsEnsured = true
    return
  }

  const sql = `
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS ruian_address_code BIGINT,
    ADD COLUMN IF NOT EXISTS geocode_source TEXT,
    ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP WITH TIME ZONE;
    CREATE INDEX IF NOT EXISTS idx_properties_ruian_address_code ON properties(ruian_address_code);
  `

  const { error } = await supabase.rpc('exec_sql', { sql })
  if (error) {
    const probeMessage = probeError.message || ''
    throw new Error(`Nepodařilo se zajistit geocoding sloupce properties: ${error.message || probeMessage}`)
  }

  propertyGeocodeColumnsEnsured = true
}

export function hasExactPropertyGeocode(property: Partial<PropertyGeocodeInput>) {
  return (
    property.latitude != null &&
    property.longitude != null &&
    (property.ruian_address_code != null || EXACT_GEOCODE_SOURCES.has(String(property.geocode_source || '')))
  )
}

export function findRuianMatchForProperty(property: PropertyGeocodeInput, options: LoadOptions = {}) {
  const indexBundle = loadRuianIndex(options)
  if (!indexBundle) return null

  const sanitizedAddress = sanitizePropertyAddress(property.address)
  const parsedAddress = parseAddress(sanitizedAddress)
  if (!parsedAddress.street || !parsedAddress.houseNumber) {
    return null
  }

  const parsedFromAddress = parseCityAndLocalityFromAddress(sanitizedAddress)
  const city = property.city || parsedFromAddress.city
  const locality = property.locality || parsedFromAddress.locality

  if (!city) {
    return null
  }

  const keys = [
    [
      normalizeText(city),
      normalizeText(locality),
      normalizeText(parsedAddress.street),
      parsedAddress.houseNumber,
      parsedAddress.orientationNumber,
    ].join('|'),
    [
      normalizeText(city),
      '',
      normalizeText(parsedAddress.street),
      parsedAddress.houseNumber,
      parsedAddress.orientationNumber,
    ].join('|'),
    [
      normalizeText(city),
      normalizeText(locality),
      normalizeText(parsedAddress.street),
      parsedAddress.houseNumber,
      '',
    ].join('|'),
    [
      normalizeText(city),
      '',
      normalizeText(parsedAddress.street),
      parsedAddress.houseNumber,
      '',
    ].join('|'),
  ]

  for (const key of keys) {
    const match = indexBundle.exactIndex.get(key)
    if (match) {
      return match
    }
  }

  return null
}

function findRuianAggregateForProperty(property: PropertyGeocodeInput, options: LoadOptions = {}) {
  const indexBundle = loadRuianIndex(options)
  if (!indexBundle) return null

  const sanitizedAddress = sanitizePropertyAddress(property.address)
  const parsedAddress = parseAddress(sanitizedAddress)
  const parsedFromAddress = parseCityAndLocalityFromAddress(sanitizedAddress)
  const city = property.city || parsedFromAddress.city
  const locality = property.locality || parsedFromAddress.locality

  if (!city) {
    return null
  }

  if (parsedAddress.street) {
    const streetKeys = [
      [normalizeText(city), normalizeText(locality), normalizeText(parsedAddress.street)].join('|'),
      [normalizeText(city), '', normalizeText(parsedAddress.street)].join('|'),
    ]

    for (const key of streetKeys) {
      const streetMatch = indexBundle.streetIndex.get(key)
      if (streetMatch) {
        return {
          ...streetMatch,
          geocodeSource: 'ruian_street_centroid',
        }
      }
    }
  }

  if (locality) {
    const localityMatch = indexBundle.localityIndex.get([normalizeText(city), normalizeText(locality)].join('|'))
    if (localityMatch) {
      return {
        ...localityMatch,
        geocodeSource: 'ruian_locality_centroid',
      }
    }
  }

  const cityMatch = indexBundle.cityIndex.get(normalizeText(city))
  if (cityMatch) {
    return {
      ...cityMatch,
      geocodeSource: 'ruian_city_centroid',
    }
  }

  return null
}

export async function geocodePropertyWithBestEffort(property: PropertyGeocodeInput, options: LoadOptions = {}): Promise<PreparedPropertyGeocode> {
  const nowIso = new Date().toISOString()
  const backfilled = backfillPropertyLocation(property as any)
  const ruianMatch = findRuianMatchForProperty(backfilled, options)

  if (ruianMatch) {
    return {
      address: backfilled.address,
      city: backfilled.city || ruianMatch.city,
      locality: backfilled.locality || ruianMatch.locality,
      region: backfilled.region ?? null,
      latitude: ruianMatch.latitude,
      longitude: ruianMatch.longitude,
      geocode_source: 'ruian_official_csv',
      geocoded_at: nowIso,
      ruian_address_code: ruianMatch.addressCode ? Number(ruianMatch.addressCode) : null,
    }
  }

  const ruianAggregate = findRuianAggregateForProperty(backfilled, options)
  if (ruianAggregate) {
    return {
      address: backfilled.address,
      city: backfilled.city,
      locality: backfilled.locality,
      region: backfilled.region ?? null,
      latitude: ruianAggregate.latitude,
      longitude: ruianAggregate.longitude,
      geocode_source: ruianAggregate.geocodeSource,
      geocoded_at: nowIso,
      ruian_address_code: ruianAggregate.sampleAddressCode ? Number(ruianAggregate.sampleAddressCode) : null,
    }
  }

  if (hasExactPropertyGeocode(property)) {
    return {
      address: backfilled.address,
      city: backfilled.city,
      locality: backfilled.locality,
      region: backfilled.region ?? null,
      latitude: Number(property.latitude!.toFixed(6)),
      longitude: Number(property.longitude!.toFixed(6)),
      geocode_source: property.geocode_source || null,
      geocoded_at: property.geocoded_at || nowIso,
      ruian_address_code: property.ruian_address_code ?? null,
    }
  }

  const aligned = alignPropertyCoordinates(backfilled as any)
  return {
    address: backfilled.address,
    city: backfilled.city,
    locality: backfilled.locality,
    region: backfilled.region ?? null,
    latitude: aligned.latitude,
    longitude: aligned.longitude,
    geocode_source: 'synthetic_seed_backfill',
    geocoded_at: nowIso,
    ruian_address_code: null,
  }
}

export async function buildGeocodedPropertyPayload(
  payload: Record<string, any>,
  existing?: Partial<PropertyGeocodeInput> | null,
  options: LoadOptions = {}
) {
  const merged: PropertyGeocodeInput = {
    id: existing?.id || null,
    title: payload.title ?? existing?.title ?? null,
    address: String(payload.address ?? existing?.address ?? ''),
    city: payload.city ?? existing?.city ?? null,
    locality: payload.locality ?? existing?.locality ?? null,
    region: payload.region ?? existing?.region ?? null,
    latitude: payload.latitude ?? existing?.latitude ?? null,
    longitude: payload.longitude ?? existing?.longitude ?? null,
    geocode_source: payload.geocode_source ?? existing?.geocode_source ?? null,
    geocoded_at: payload.geocoded_at ?? existing?.geocoded_at ?? null,
    ruian_address_code: payload.ruian_address_code ?? existing?.ruian_address_code ?? null,
  }

  if (!merged.address.trim()) {
    return payload
  }

  const geocoded = await geocodePropertyWithBestEffort(merged, options)
  return {
    ...payload,
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
}

export function stripUnsupportedPropertyGeocodeColumns(payload: Record<string, any>, errorMessage?: string | null) {
  const message = (errorMessage || '').toLowerCase()
  if (!/geocode_source|geocoded_at|ruian_address_code/.test(message)) {
    return payload
  }

  const nextPayload = { ...payload }
  delete nextPayload.geocode_source
  delete nextPayload.geocoded_at
  delete nextPayload.ruian_address_code
  return nextPayload
}
