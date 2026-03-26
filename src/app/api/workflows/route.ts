import { NextRequest, NextResponse } from 'next/server'
import cron from 'node-cron'
import { supabase } from '../../../lib/supabase'
import { workflowEngine } from '../../../lib/workflow-engine'

export const dynamic = 'force-dynamic'

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
    const { data, error } = await supabase.from('workflows').select('*').order('name', { ascending: true })
    if (error) throw error

    return NextResponse.json(
      (data || []).map((workflow: any) => ({
        ...workflow,
        description: workflow.config_json?.description || '',
        task: workflow.config_json?.task || null,
        last_run: workflow.config_json?.last_run || null,
        last_error: workflow.config_json?.last_error || null,
      }))
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

      workflowEngine.scheduleWorkflow(data.id, schedule)
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

      if (data.schedule && data.status !== 'paused') {
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
