import { NextRequest, NextResponse } from 'next/server'
import { getDueWorkflows, workflowEngine } from '@/lib/workflow-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true

  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}

async function handleRun(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const dueWorkflows = await getDueWorkflows(now)
  const results: Array<{ id: string; name: string; status: 'success' | 'error'; message?: string }> = []

  for (const workflow of dueWorkflows) {
    try {
      await workflowEngine.executeWorkflow(workflow.id)
      results.push({ id: workflow.id, name: workflow.name, status: 'success' })
    } catch (error) {
      results.push({
        id: workflow.id,
        name: workflow.name,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown workflow error',
      })
    }
  }

  return NextResponse.json({
    checkedAt: now.toISOString(),
    dueCount: dueWorkflows.length,
    results,
  })
}

export async function GET(request: NextRequest) {
  return handleRun(request)
}

export async function POST(request: NextRequest) {
  return handleRun(request)
}
