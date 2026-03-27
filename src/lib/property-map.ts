import { supabase } from './supabase'
import { alignPropertyCoordinates, backfillPropertyLocation, generateCzechPropertySeed } from './czech-property-seed'

export interface PropertyMapFilters {
  city?: string
  locality?: string
  propertyType?: string
  status?: string
  missingReconstruction?: boolean
  maxPrice?: number
  bounds?: {
    north: number
    south: number
    east: number
    west: number
  }
  limit?: number
  sortBy?: 'price_desc' | 'price_asc' | 'newest'
}

export interface MapProperty {
  id: string
  title: string
  address: string
  locality: string | null
  city: string | null
  region: string | null
  latitude: number | null
  longitude: number | null
  ruian_address_code?: number | null
  geocode_source?: string | null
  property_type: string | null
  status: string | null
  asking_price: number | null
  reconstruction_status: string | null
  structural_modifications: string | null
  created_at: string | null
}

let fallbackPropertiesCache: MapProperty[] | null = null

const BASE_PROPERTY_SELECT =
  'id,title,address,locality,city,region,latitude,longitude,property_type,status,asking_price,reconstruction_status,structural_modifications,created_at'
const GEO_METADATA_SELECT = `${BASE_PROPERTY_SELECT},ruian_address_code,geocode_source`

function normalizeString(value?: string) {
  return value?.trim() || undefined
}

function applyBoundsFilter(properties: MapProperty[], bounds?: PropertyMapFilters['bounds']) {
  if (!bounds) return properties

  return properties.filter((property) => {
    if (property.latitude == null || property.longitude == null) {
      return false
    }

    return (
      property.latitude <= bounds.north &&
      property.latitude >= bounds.south &&
      property.longitude <= bounds.east &&
      property.longitude >= bounds.west
    )
  })
}

function applyMissingReconstructionFilter(properties: MapProperty[], missingReconstruction?: boolean) {
  if (!missingReconstruction) return properties

  return properties.filter((property) => {
    const reconstructionMissing = !property.reconstruction_status || property.reconstruction_status === 'missing'
    const structuralMissing = !property.structural_modifications || property.structural_modifications === 'unknown'
    return reconstructionMissing || structuralMissing
  })
}

function getFallbackProperties() {
  if (fallbackPropertiesCache) {
    return fallbackPropertiesCache
  }

  fallbackPropertiesCache = generateCzechPropertySeed(180).map((property, index) => ({
    id: `fallback-property-${index + 1}`,
    title: property.title,
    address: property.address,
    locality: property.locality,
    city: property.city,
    region: property.region,
    latitude: property.latitude,
    longitude: property.longitude,
    property_type: property.property_type,
    status: property.status,
    asking_price: property.asking_price,
    reconstruction_status: property.reconstruction_status,
    structural_modifications: property.structural_modifications,
    created_at: property.created_at,
  }))

  return fallbackPropertiesCache
}

function alignProperties(properties: MapProperty[]): MapProperty[] {
  return properties.map((property) => {
    const backfilled = backfillPropertyLocation(property as any)
    return alignPropertyCoordinates(backfilled as any) as MapProperty
  })
}

function applyInMemoryFilters(properties: MapProperty[], filters: PropertyMapFilters) {
  const city = normalizeString(filters.city)?.toLowerCase()
  const locality = normalizeString(filters.locality)?.toLowerCase()
  const propertyType = normalizeString(filters.propertyType)?.toLowerCase()
  const status = normalizeString(filters.status)?.toLowerCase()

  let filtered = alignProperties(properties).filter((property) => {
    if (city && property.city?.toLowerCase() !== city) return false
    if (locality && !property.locality?.toLowerCase().includes(locality)) return false
    if (propertyType && property.property_type?.toLowerCase() !== propertyType) return false
    if (status && property.status?.toLowerCase() !== status) return false
    if (typeof filters.maxPrice === 'number' && !Number.isNaN(filters.maxPrice) && (property.asking_price || 0) > filters.maxPrice) return false
    return true
  })

  filtered = applyMissingReconstructionFilter(filtered, filters.missingReconstruction)

  const sortBy = filters.sortBy || 'newest'
  if (sortBy === 'price_desc') {
    filtered = filtered.sort((a, b) => (b.asking_price || 0) - (a.asking_price || 0))
  } else if (sortBy === 'price_asc') {
    filtered = filtered.sort((a, b) => (a.asking_price || 0) - (b.asking_price || 0))
  } else {
    filtered = filtered.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  }

  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) && filters.limit > 0 ? filters.limit : null
  const allMatching = limit ? filtered.slice(0, limit) : filtered
  const visibleProperties = applyBoundsFilter(allMatching, filters.bounds)

  return {
    properties: allMatching,
    totalMatching: allMatching.length,
    visibleCount: visibleProperties.length,
  }
}

export async function getPropertiesForMap(filters: PropertyMapFilters = {}) {
  const city = normalizeString(filters.city)
  const locality = normalizeString(filters.locality)
  const propertyType = normalizeString(filters.propertyType)
  const status = normalizeString(filters.status)
  const sortBy = filters.sortBy || 'newest'
  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) && filters.limit > 0 ? filters.limit : null

  const buildQuery = (selectClause: string) => {
    let query = supabase
      .from('properties')
      .select(selectClause)

    if (limit) {
      query = query.limit(limit)
    }

    if (city) {
      query = query.ilike('city', city)
    }

    if (locality) {
      query = query.ilike('locality', `%${locality}%`)
    }

    if (propertyType) {
      query = query.eq('property_type', propertyType)
    }

    if (status) {
      query = query.eq('status', status)
    }

    if (typeof filters.maxPrice === 'number' && !Number.isNaN(filters.maxPrice)) {
      query = query.lte('asking_price', filters.maxPrice)
    }

    if (sortBy === 'price_desc') {
      query = query.order('asking_price', { ascending: false, nullsFirst: false })
    } else if (sortBy === 'price_asc') {
      query = query.order('asking_price', { ascending: true, nullsFirst: false })
    } else {
      query = query.order('created_at', { ascending: false, nullsFirst: false })
    }

    return query
  }

  let { data, error } = await buildQuery(GEO_METADATA_SELECT)

  if (error) {
    const retry = await buildQuery(BASE_PROPERTY_SELECT)
    data = retry.data
    error = retry.error
  }

  if (error) {
    return applyInMemoryFilters(getFallbackProperties(), filters)
  }

  const databaseProperties = ((data || []) as unknown) as MapProperty[]

  if (databaseProperties.length === 0) {
    return {
      properties: [],
      totalMatching: 0,
      visibleCount: 0,
    }
  }

  const geoProperties = alignProperties(databaseProperties)

  if (geoProperties.length === 0) {
    return {
      properties: [],
      totalMatching: 0,
      visibleCount: 0,
    }
  }

  const allMatching = applyMissingReconstructionFilter(geoProperties, filters.missingReconstruction)
  const visibleProperties = applyBoundsFilter(allMatching, filters.bounds)

  return {
    properties: allMatching,
    totalMatching: allMatching.length,
    visibleCount: visibleProperties.length,
  }
}

export function getMapFilterOptions(properties: MapProperty[]) {
  const unique = (values: Array<string | null>) =>
    values.filter((value): value is string => Boolean(value)).filter((value, index, array) => array.indexOf(value) === index).sort()

  return {
    cities: unique(properties.map((property) => property.city)),
    localities: unique(properties.map((property) => property.locality)),
    propertyTypes: unique(properties.map((property) => property.property_type)),
    statuses: unique(properties.map((property) => property.status)),
  }
}
