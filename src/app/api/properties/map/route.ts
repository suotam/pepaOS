import { NextRequest, NextResponse } from 'next/server'
import { getMapFilterOptions, getPropertiesForMap, type PropertyMapFilters } from '../../../../lib/property-map'

export const dynamic = 'force-dynamic'

function parseBoolean(value: string | null) {
  if (value == null) return undefined
  return value === 'true'
}

function parseNumber(value: string | null) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBounds(searchParams: URLSearchParams): PropertyMapFilters['bounds'] {
  const north = parseNumber(searchParams.get('north'))
  const south = parseNumber(searchParams.get('south'))
  const east = parseNumber(searchParams.get('east'))
  const west = parseNumber(searchParams.get('west'))

  if ([north, south, east, west].some((value) => value == null)) {
    return undefined
  }

  return { north: north!, south: south!, east: east!, west: west! }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const filters: PropertyMapFilters = {
      city: searchParams.get('city') || undefined,
      locality: searchParams.get('locality') || undefined,
      propertyType: searchParams.get('propertyType') || undefined,
      status: searchParams.get('status') || undefined,
      missingReconstruction: parseBoolean(searchParams.get('missingReconstruction')),
      maxPrice: parseNumber(searchParams.get('maxPrice')),
      sortBy: (searchParams.get('sortBy') as PropertyMapFilters['sortBy']) || 'newest',
      limit: parseNumber(searchParams.get('limit')),
      bounds: parseBounds(searchParams),
    }

    const allForOptions = await getPropertiesForMap()
    const result = await getPropertiesForMap(filters)

    return NextResponse.json({
      ...result,
      filters,
      filterOptions: getMapFilterOptions(allForOptions.properties),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error while fetching property map data' },
      { status: 500 }
    )
  }
}
