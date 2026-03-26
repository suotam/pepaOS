import { NextRequest, NextResponse } from 'next/server'
import { countMarketListings, queryMarketListings } from '../../../../lib/market-db'

export const dynamic = 'force-dynamic'

function parseNumber(value: string | null) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const filters = {
      source: searchParams.get('source') || undefined,
      locationLabel: searchParams.get('locationLabel') || undefined,
      city: searchParams.get('city') || undefined,
      district: searchParams.get('district') || undefined,
      category: (searchParams.get('category') as 'byty' | 'domy' | null) || undefined,
      maxPrice: parseNumber(searchParams.get('maxPrice')),
      minPrice: parseNumber(searchParams.get('minPrice')),
      limit: parseNumber(searchParams.get('limit')),
      query: searchParams.get('query') || undefined,
    }

    const [count, listings] = await Promise.all([
      countMarketListings(filters),
      queryMarketListings(filters),
    ])

    return NextResponse.json({ count, listings })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Market query failed' },
      { status: 500 }
    )
  }
}
