import cron from 'node-cron'
import { supabase } from '../lib/supabase'
import { send_email } from './google-tools'
import { buildMarketWatchEmailBody, runMarketWatch } from './market-watch'
import { storeMarketListings } from './market-db'

type WorkflowTaskConfig =
  | {
      actionType: 'send_email'
      description?: string
      task: {
        to: string
        subject: string
        body: string
      }
      last_run?: string | null
      last_result?: any
      last_error?: string | null
    }
  | Record<string, any>

type WorkflowRow = {
  id: string
  name: string
  type: string | null
  schedule: string | null
  status: string | null
  config_json: WorkflowTaskConfig | null
}

function expandCronPart(part: string, min: number, max: number) {
  if (part === '*') {
    return { kind: 'any' as const }
  }

  if (part.startsWith('*/')) {
    const step = Number(part.slice(2))
    return { kind: 'step' as const, step: Number.isFinite(step) && step > 0 ? step : null }
  }

  return {
    kind: 'list' as const,
    values: part.split(',').flatMap((token) => {
      const trimmed = token.trim()
      if (!trimmed) return []
      if (trimmed.includes('-')) {
        const [startRaw, endRaw] = trimmed.split('-')
        const start = Number(startRaw)
        const end = Number(endRaw)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return []
        const values: number[] = []
        for (let value = start; value <= end; value += 1) {
          if (value >= min && value <= max) values.push(value)
        }
        return values
      }
      const value = Number(trimmed)
      return Number.isFinite(value) && value >= min && value <= max ? [value] : []
    }),
  }
}

function matchesCronValue(part: string, value: number, min: number, max: number) {
  const expanded = expandCronPart(part, min, max)
  if (expanded.kind === 'any') return true
  if (expanded.kind === 'step') return expanded.step ? value % expanded.step === 0 : false
  return expanded.values.includes(value)
}

function matchesCronExpression(expression: string, date: Date) {
  const parts = String(expression || '').trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  return (
    matchesCronValue(minute, date.getMinutes(), 0, 59) &&
    matchesCronValue(hour, date.getHours(), 0, 23) &&
    matchesCronValue(dayOfMonth, date.getDate(), 1, 31) &&
    matchesCronValue(month, date.getMonth() + 1, 1, 12) &&
    matchesCronValue(dayOfWeek, date.getDay(), 0, 6)
  )
}

function ranAtOrAfter(lastRun: string | null | undefined, threshold: Date) {
  if (!lastRun) return false
  const parsed = new Date(lastRun)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.getTime() >= threshold.getTime()
}

function floorToMinute(date: Date) {
  const next = new Date(date)
  next.setSeconds(0, 0)
  return next
}

function findLatestMatchingTime(expression: string, now: Date, lookbackMinutes: number) {
  const end = floorToMinute(now)
  for (let offset = 0; offset < lookbackMinutes; offset += 1) {
    const candidate = new Date(end)
    candidate.setMinutes(candidate.getMinutes() - offset)
    if (matchesCronExpression(expression, candidate)) {
      return candidate
    }
  }
  return null
}

export async function getDueWorkflows(now = new Date(), lookbackMinutes = 1) {
  const { data: workflows, error } = await supabase
    .from('workflows')
    .select('*')
    .not('schedule', 'is', null)
    .eq('status', 'active')

  if (error) {
    throw new Error(error.message)
  }

  return ((workflows || []) as WorkflowRow[]).filter((workflow) => {
    if (!workflow.schedule) return false
    const matchedTime = findLatestMatchingTime(workflow.schedule, now, Math.max(1, lookbackMinutes))
    if (!matchedTime) return false
    const config = (workflow.config_json || {}) as WorkflowTaskConfig
    const lastRun = typeof (config as any).last_run === 'string' ? (config as any).last_run : null
    return !ranAtOrAfter(lastRun, matchedTime)
  })
}

function normalizeLocationText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function inferMarketWatchLocation(task: Record<string, any>, workflow: WorkflowRow, config: WorkflowTaskConfig) {
  const explicitLocation = typeof task.locationLabel === 'string' ? task.locationLabel.trim() : ''
  if (explicitLocation) {
    return explicitLocation
  }

  const haystacks = [
    workflow.name || '',
    String((config as any).description || ''),
    String(task.subject || ''),
  ]

  const locationAliases = [
    { canonical: 'Praha Holešovice', aliases: ['praha holesovice', 'holesovice', 'holesovic'] },
    { canonical: 'Praha', aliases: ['praha', 'praze'] },
    { canonical: 'Brno', aliases: ['brno', 'brne'] },
    { canonical: 'Ostrava', aliases: ['ostrava', 'ostrave'] },
    { canonical: 'Plzeň', aliases: ['plzen', 'plzni'] },
    { canonical: 'Olomouc', aliases: ['olomouc', 'olomouci'] },
    { canonical: 'Karlovy Vary', aliases: ['karlovy vary', 'karlovych varu'] },
    { canonical: 'Liberec', aliases: ['liberec', 'liberci'] },
    { canonical: 'Hradec Králové', aliases: ['hradec kralove', 'hradci kralove'] },
    { canonical: 'Pardubice', aliases: ['pardubice', 'pardubicich'] },
    { canonical: 'České Budějovice', aliases: ['ceske budejovice', 'ceskych budejovic'] },
    { canonical: 'Ústí nad Labem', aliases: ['usti nad labem', 'usti nad labem'] },
    { canonical: 'Zlín', aliases: ['zlin', 'zline'] },
    { canonical: 'Jihlava', aliases: ['jihlava', 'jihlave'] },
    { canonical: 'Kladno', aliases: ['kladno', 'kladne'] },
    { canonical: 'Opava', aliases: ['opava', 'opave'] },
  ]

  for (const haystack of haystacks) {
    const normalizedHaystack = normalizeLocationText(haystack)
    const found = locationAliases.find((location) =>
      location.aliases.some((alias) => normalizedHaystack.includes(alias))
    )
    if (found) {
      return found.canonical
    }
  }

  const genericAnywhereHints = ['všechny lokality', 'kdekoliv', 'libovolné město', 'libovolnem meste', 'anywhere']
  for (const haystack of haystacks) {
    const normalizedHaystack = normalizeLocationText(haystack)
    if (genericAnywhereHints.some((hint) => normalizedHaystack.includes(normalizeLocationText(hint)))) {
      return undefined
    }
  }

  return undefined
}

export class WorkflowEngine {
  private activeJobs: Map<string, any> = new Map()
  private initialized = false

  async executeWorkflow(workflowId: string) {
    const { data: workflow, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', workflowId)
      .single<WorkflowRow>()

    if (error) {
      throw new Error(error.message)
    }

    if (!workflow) {
      throw new Error('Workflow nebyl nalezen.')
    }

    const config = (workflow.config_json || {}) as WorkflowTaskConfig

    try {
      await supabase.from('workflows').update({ status: 'running' }).eq('id', workflowId)

      const result = await this.runWorkflow(workflow, config)
      const nextConfig = {
        ...config,
        last_run: new Date().toISOString(),
        last_result: result,
        last_error: null,
      }

      if ((config as any).task && result && typeof result === 'object' && 'nextSeenListingIds' in (result as any)) {
        ;(nextConfig as any).task = {
          ...(config as any).task,
          seenListingIds: (result as any).nextSeenListingIds,
        }
      }

      await supabase.from('outputs').insert({
        type: 'workflow_result',
        title: `Workflow: ${workflow.name}`,
        content_json: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: 'success',
          result,
          executedAt: new Date().toISOString(),
        },
      })

      await supabase
        .from('workflows')
        .update({
          status: workflow.schedule ? 'active' : 'completed',
          config_json: nextConfig,
        })
        .eq('id', workflowId)

      return result
    } catch (error) {
      const nextConfig = {
        ...config,
        last_run: new Date().toISOString(),
        last_error: error instanceof Error ? error.message : 'Unknown workflow error',
      }

      await supabase
        .from('workflows')
        .update({
          status: 'failed',
          config_json: nextConfig,
        })
        .eq('id', workflowId)

      await supabase.from('outputs').insert({
        type: 'workflow_result',
        title: `Workflow: ${workflow.name}`,
        content_json: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown workflow error',
          executedAt: new Date().toISOString(),
        },
      })

      throw error
    }
  }

  private async runWorkflow(workflow: WorkflowRow, config: WorkflowTaskConfig) {
    if (workflow.type === 'scheduled_email' || config.actionType === 'send_email') {
      const task = (config as any).task || {}
      if (!task.to || !task.subject || !task.body) {
        throw new Error('Workflow email task nemá kompletní data.')
      }

      return await send_email(task.to, task.subject, task.body)
    }

    if (workflow.type === 'market_watch') {
      const task = (config as any).task || {}
      if (!task.to || !task.subject) {
        throw new Error('Market watch workflow nemá kompletní data.')
      }

      const resolvedLocationLabel = inferMarketWatchLocation(task, workflow, config)

      const watchResult = await runMarketWatch({
        locationLabel: resolvedLocationLabel,
        category: task.category || 'byty',
        sources: task.sources || ['sreality', 'bezrealitky'],
        searchUrls: task.searchUrls || {},
        seenListingIds: task.seenListingIds || [],
        mode: task.mode || 'new',
        limit: task.limit || 10,
      })

      const shouldPersistToDatabase = task.persistToDatabase !== false
      const storedResult =
        shouldPersistToDatabase && watchResult.selectedListings.length > 0
          ? await storeMarketListings({
              listings: watchResult.selectedListings,
              category: task.category,
            })
          : { synced: 0, properties: [] }

      const body = buildMarketWatchEmailBody(resolvedLocationLabel, watchResult.selectedListings, {
        mode: task.mode || 'new',
        limit: task.limit || 10,
      })

      const emailResult = await send_email(task.to, task.subject, body)

      return {
        emailResult,
        fetchedCount: watchResult.allListings.length,
        newCount: watchResult.newListings.length,
        selectedListings: watchResult.selectedListings,
        resolvedLocationLabel: resolvedLocationLabel || null,
        storedCount: storedResult.synced || 0,
        storedPropertyCount: Array.isArray((storedResult as any).properties) ? (storedResult as any).properties.length : 0,
        nextSeenListingIds: watchResult.nextSeenListingIds,
      }
    }

    throw new Error(`Nepodporovaný workflow typ: ${workflow.type || 'unknown'}`)
  }

  scheduleWorkflow(workflowId: string, cronExpression: string) {
    if (!cron.validate(cronExpression)) {
      throw new Error('Neplatný cron výraz.')
    }

    if (this.activeJobs.has(workflowId)) {
      this.activeJobs.get(workflowId)?.stop()
      this.activeJobs.get(workflowId)?.destroy()
    }

    const job = cron.schedule(cronExpression, async () => {
      try {
        await this.executeWorkflow(workflowId)
      } catch (error) {
        console.error('Scheduled workflow execution failed:', error)
      }
    })

    this.activeJobs.set(workflowId, job)
  }

  stopWorkflow(workflowId: string) {
    const job = this.activeJobs.get(workflowId)
    if (!job) return
    job.stop()
    job.destroy()
    this.activeJobs.delete(workflowId)
  }

  async initializeScheduledWorkflows(force = false) {
    if (this.initialized && !force) return

    const { data: workflows, error } = await supabase
      .from('workflows')
      .select('*')
      .not('schedule', 'is', null)
      .in('status', ['active', 'running', 'failed', 'completed'])

    if (error) {
      throw new Error(error.message)
    }

    for (const workflow of (workflows || []) as WorkflowRow[]) {
      if (workflow.schedule) {
        try {
          this.scheduleWorkflow(workflow.id, workflow.schedule)
        } catch (error) {
          console.error(`Failed to schedule workflow ${workflow.id}:`, error)
        }
      }
    }

    this.initialized = true
  }
}

export const workflowEngine = new WorkflowEngine()
