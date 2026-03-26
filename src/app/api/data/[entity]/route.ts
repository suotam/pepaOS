import { NextRequest, NextResponse } from 'next/server'
import { createDataRecord, isDataEntity, listDataRecords } from '../../../../lib/data-admin'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: {
    entity: string
  }
}

function assertEntity(entity: string) {
  if (!isDataEntity(entity)) {
    throw new Error('Unknown data entity.')
  }
  return entity
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const entity = assertEntity(context.params.entity)
    const query = request.nextUrl.searchParams.get('q') || ''
    const limit = Number(request.nextUrl.searchParams.get('limit') || '200')
    const result = await listDataRecords({ entity, query, limit })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load records' },
      { status: 400 }
    )
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const entity = assertEntity(context.params.entity)
    const body = await request.json()
    const record = await createDataRecord(entity, body?.record || {})
    return NextResponse.json({ record })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create record' },
      { status: 400 }
    )
  }
}
