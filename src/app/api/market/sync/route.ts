import { NextRequest, NextResponse } from 'next/server'
import { syncSrealityListings } from '../../../../lib/market-db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await syncSrealityListings({
      locationLabel: body.locationLabel,
      categories: body.categories,
      maxPrice: typeof body.maxPrice === 'number' ? body.maxPrice : undefined,
      maxPages: typeof body.maxPages === 'number' ? body.maxPages : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Market sync failed' },
      { status: 500 }
    )
  }
}
