import { NextResponse } from 'next/server'
import { getDataExplorerMetadata } from '../../../../lib/data-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const metadata = await getDataExplorerMetadata()
    return NextResponse.json(metadata)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load metadata' },
      { status: 500 }
    )
  }
}
