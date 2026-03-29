import { NextRequest, NextResponse } from 'next/server'
import { deleteDataRecord, getDataRecordDetail, isDataEntity, updateDataRecord } from '../../../../../lib/data-admin'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: {
    entity: string
    id: string
  }
}

function assertEntity(entity: string) {
  if (!isDataEntity(entity)) {
    throw new Error('Unknown data entity.')
  }
  return entity
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const entity = assertEntity(context.params.entity)
    const detail = await getDataRecordDetail(entity, context.params.id)
    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load record' },
      { status: 400 }
    )
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const entity = assertEntity(context.params.entity)
    const body = await request.json()
    const record = await updateDataRecord(entity, context.params.id, body?.changes || {})
    return NextResponse.json({ record })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update record' },
      { status: 400 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const entity = assertEntity(context.params.entity)
    const record = await deleteDataRecord(entity, context.params.id)
    return NextResponse.json({ record })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete record' },
      { status: 400 }
    )
  }
}
