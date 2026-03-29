import { NextRequest, NextResponse } from 'next/server'
import cron from 'node-cron'
import { supabase } from '../../../lib/supabase'
import { workflowEngine } from '../../../lib/workflow-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function buildWorkflowName(name: string | undefined, to: string, subject: string) {
  if (name?.trim()) return name.trim()
  return `Email ${to} · ${subject.slice(0, 40)}`
}

function buildWorkflowDescription(description: string | undefined, to: string, schedule: string) {
  if (description?.trim()) return description.trim()
  return `Naplánované odeslání e-mailu na ${to} podle plánu ${schedule}.`
}

export async function GET() {
  try {
    const [{ data, error }, { data: outputs, error: outputsError }] = await Promise.all([
      supabase.from('workflows').select('*').order('name', { ascending: true }),
      supabase
        .from('outputs')
        .select('*')
        .eq('type', 'workflow_result')
        .order('created_at', { ascending: false })
        .limit(24),
    ])
    if (error) throw error
    if (outputsError) throw outputsError

    const normalizedWorkflows = (data || []).map((workflow: any) => ({
      ...workflow,
      description: workflow.config_json?.description || '',
      task: workflow.config_json?.task || null,
      last_run: workflow.config_json?.last_run || null,
      last_error: workflow.config_json?.last_error || null,
    }))

    const stats = {
      total: normalizedWorkflows.length,
      active: normalizedWorkflows.filter((workflow: any) => workflow.status === 'active').length,
      paused: normalizedWorkflows.filter((workflow: any) => workflow.status === 'paused').length,
      failed: normalizedWorkflows.filter((workflow: any) => workflow.status === 'failed').length,
      running: normalizedWorkflows.filter((workflow: any) => workflow.status === 'running').length,
    }

    return NextResponse.json(
      {
        workflows: normalizedWorkflows,
        stats,
        recentRuns: (outputs || []).map((output: any) => ({
          id: output.id,
          title: output.title,
          created_at: output.created_at,
          workflowId: output.content_json?.workflowId || null,
          workflowName: output.content_json?.workflowName || null,
          status: output.content_json?.status || 'success',
          error: output.content_json?.error || null,
          result: output.content_json?.result || null,
          executedAt: output.content_json?.executedAt || output.created_at,
        })),
      }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load workflows' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action = 'create' } = body

    if (action === 'create') {
      const schedule = String(body.schedule || '').trim()
      const task = body.task || {}
      const type = body.type === 'market_watch' ? 'market_watch' : 'scheduled_email'
      if (!cron.validate(schedule)) {
        return NextResponse.json({ error: 'Neplatný cron výraz.' }, { status: 400 })
      }
      if (type === 'scheduled_email' && (!task.to || !task.subject || !task.body)) {
        return NextResponse.json({ error: 'Workflow pro e-mail potřebuje příjemce, předmět a tělo zprávy.' }, { status: 400 })
      }
      if (type === 'market_watch' && (!task.to || !task.subject)) {
        return NextResponse.json({ error: 'Market watch workflow potřebuje příjemce a předmět.' }, { status: 400 })
      }

      const name =
        type === 'market_watch'
          ? body.name?.trim() || `Market watch ${task.locationLabel || 'všechny lokality'}`
          : buildWorkflowName(body.name, task.to, task.subject)
      const description =
        type === 'market_watch'
          ? body.description?.trim() || `Denní sledování nabídek pro ${task.locationLabel || 'všechny lokality'}.`
          : buildWorkflowDescription(body.description, task.to, schedule)

      const { data, error } = await supabase
        .from('workflows')
        .insert({
          name,
          type,
          schedule,
          status: 'active',
          config_json: {
            actionType: type === 'market_watch' ? 'market_watch' : 'send_email',
            description,
            task,
          },
        })
        .select()
        .single()

      if (error) throw error

      if (!process.env.VERCEL) {
        workflowEngine.scheduleWorkflow(data.id, schedule)
      }
      return NextResponse.json({ workflow: data })
    }

    if (action === 'execute' && body.workflowId) {
      setTimeout(() => {
        workflowEngine.executeWorkflow(body.workflowId).catch((error) => {
          console.error('Manual workflow execution failed:', error)
        })
      }, 0)
      return NextResponse.json({ success: true, queued: true })
    }

    if (action === 'update' && body.workflowId) {
      const { data: existing, error: existingError } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', body.workflowId)
        .single()

      if (existingError) throw existingError

      const nextSchedule = typeof body.schedule === 'string' ? body.schedule.trim() : existing.schedule
      if (nextSchedule && !cron.validate(nextSchedule)) {
        return NextResponse.json({ error: 'Neplatný cron výraz.' }, { status: 400 })
      }

      const nextTask = {
        ...(existing.config_json?.task || {}),
        ...(body.task || {}),
      }

      const nextConfig = {
        ...(existing.config_json || {}),
        description:
          typeof body.description === 'string'
            ? body.description
            : existing.config_json?.description || '',
        task: nextTask,
      }

      const { data, error } = await supabase
        .from('workflows')
        .update({
          name: typeof body.name === 'string' ? body.name : existing.name,
          schedule: nextSchedule,
          status: typeof body.status === 'string' ? body.status : existing.status,
          config_json: nextConfig,
        })
        .eq('id', body.workflowId)
        .select()
        .single()

      if (error) throw error

      if (!process.env.VERCEL && data.schedule && data.status !== 'paused') {
        workflowEngine.scheduleWorkflow(data.id, data.schedule)
      } else {
        workflowEngine.stopWorkflow(data.id)
      }

      return NextResponse.json({ workflow: data })
    }

    if (action === 'delete' && body.workflowId) {
      workflowEngine.stopWorkflow(body.workflowId)
      const { error } = await supabase.from('workflows').delete().eq('id', body.workflowId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Workflow API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
