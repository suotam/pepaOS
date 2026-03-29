'use client'

import { useEffect, useState } from 'react'
import { AppStateCard, AppStateInline } from '../components/AppStateCard'

type WorkflowRecord = {
  id: string
  name: string
  type: string
  schedule: string | null
  status: string | null
  description?: string
  task?: {
    to?: string
    subject?: string
    body?: string
    locationLabel?: string
    sources?: string[]
    mode?: 'new' | 'latest'
    limit?: number
  } | null
  last_run?: string | null
  last_error?: string | null
}

type WorkflowRunRecord = {
  id: string
  title: string | null
  created_at: string
  workflowId: string | null
  workflowName: string | null
  status: 'success' | 'error'
  error?: string | null
  result?: {
    fetchedCount?: number
    newCount?: number
    storedCount?: number
    storedPropertyCount?: number
  } | null
  executedAt: string
}

type WorkflowStats = {
  total: number
  active: number
  paused: number
  failed: number
  running: number
}

const emptyStats: WorkflowStats = {
  total: 0,
  active: 0,
  paused: 0,
  failed: 0,
  running: 0,
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [recentRuns, setRecentRuns] = useState<WorkflowRunRecord[]>([])
  const [stats, setStats] = useState<WorkflowStats>(emptyStats)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [actingWorkflowId, setActingWorkflowId] = useState<string | null>(null)
  const [actingLabel, setActingLabel] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    schedule: '0 9 * * *',
    to: '',
    subject: '',
    body: '',
  })

  const fetchJsonWithTimeout = async (url: string, init?: RequestInit, timeoutMs = 15000) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })
      const data = await response.json()
      return { response, data }
    } finally {
      clearTimeout(timeout)
    }
  }

  const loadWorkflows = async () => {
    setLoading(true)
    try {
      const { response, data } = await fetchJsonWithTimeout('/api/workflows', { cache: 'no-store' }, 10000)
      if (!response.ok) throw new Error(data.error || 'Nepodařilo se načíst workflow.')
      setWorkflows(data.workflows || [])
      setRecentRuns(data.recentRuns || [])
      setStats(data.stats || emptyStats)
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'AbortError') {
        setError('Načtení workflow trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(loadError instanceof Error ? loadError.message : 'Nepodařilo se načíst workflow.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWorkflows()
  }, [])

  const createWorkflow = async () => {
    setCreating(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const { response, data } = await fetchJsonWithTimeout('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: form.name,
          description: form.description,
          schedule: form.schedule,
          task: {
            to: form.to,
            subject: form.subject,
            body: form.body,
          },
        }),
      })
      if (!response.ok) throw new Error(data.error || 'Nepodařilo se vytvořit workflow.')

      setForm({
        name: '',
        description: '',
        schedule: '0 9 * * *',
        to: '',
        subject: '',
        body: '',
      })
      setSuccessMessage('Workflow bylo vytvořeno.')
      void loadWorkflows()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Nepodařilo se vytvořit workflow.')
    } finally {
      setCreating(false)
    }
  }

  const runWorkflow = async (workflowId: string) => {
    setError(null)
    setSuccessMessage(null)
    setActingWorkflowId(workflowId)
    setActingLabel('Spouštím workflow…')
    try {
      const { response, data } = await fetchJsonWithTimeout('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', workflowId }),
      }, 8000)
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se spustit workflow.')
      }
      setWorkflows((current) =>
        current.map((workflow) =>
          workflow.id === workflowId
            ? { ...workflow, status: 'running', last_error: null }
            : workflow
        )
      )
      setSuccessMessage('Workflow bylo zařazeno ke spuštění.')
      setTimeout(() => {
        void loadWorkflows()
      }, 1200)
    } catch (runError) {
      if (runError instanceof Error && runError.name === 'AbortError') {
        setError('Požadavek na spuštění workflow trval příliš dlouho. Zkuste to znovu.')
      } else {
        setError(runError instanceof Error ? runError.message : 'Nepodařilo se spustit workflow.')
      }
    } finally {
      setActingWorkflowId(null)
      setActingLabel(null)
    }
  }

  const deleteWorkflow = async (workflowId: string) => {
    const confirmed = window.confirm('Opravdu chcete workflow smazat?')
    if (!confirmed) return

    setError(null)
    setSuccessMessage(null)
    setActingWorkflowId(workflowId)
    setActingLabel('Mažu workflow…')
    try {
      const { response, data } = await fetchJsonWithTimeout('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', workflowId }),
      }, 8000)
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se smazat workflow.')
      }
      setWorkflows((current) => current.filter((workflow) => workflow.id !== workflowId))
      setSuccessMessage('Workflow bylo smazáno.')
    } catch (deleteError) {
      if (deleteError instanceof Error && deleteError.name === 'AbortError') {
        setError('Mazání workflow trvalo příliš dlouho. Zkuste to znovu.')
      } else {
        setError(deleteError instanceof Error ? deleteError.message : 'Nepodařilo se smazat workflow.')
      }
    } finally {
      setActingWorkflowId(null)
      setActingLabel(null)
    }
  }

  const pauseOrResumeWorkflow = async (workflow: WorkflowRecord) => {
    const nextStatus = workflow.status === 'paused' ? 'active' : 'paused'
    setError(null)
    setSuccessMessage(null)
    setActingWorkflowId(workflow.id)
    setActingLabel(nextStatus === 'paused' ? 'Pozastavuji workflow…' : 'Obnovuji workflow…')
    try {
      const { response, data } = await fetchJsonWithTimeout('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          workflowId: workflow.id,
          status: nextStatus,
        }),
      }, 8000)
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se upravit workflow.')
      }
      setWorkflows((current) =>
        current.map((item) =>
          item.id === workflow.id ? { ...item, status: nextStatus } : item
        )
      )
      setSuccessMessage(nextStatus === 'paused' ? 'Workflow bylo pozastaveno.' : 'Workflow bylo obnoveno.')
      void loadWorkflows()
    } catch (updateError) {
      if (updateError instanceof Error && updateError.name === 'AbortError') {
        setError('Úprava workflow trvala příliš dlouho. Zkuste to znovu.')
      } else {
        setError(updateError instanceof Error ? updateError.message : 'Nepodařilo se upravit workflow.')
      }
    } finally {
      setActingWorkflowId(null)
      setActingLabel(null)
    }
  }

  const updateSchedule = async (workflowId: string, schedule: string) => {
    setError(null)
    setSuccessMessage(null)
    setActingWorkflowId(workflowId)
    setActingLabel('Ukládám nový plán…')
    try {
      const { response, data } = await fetchJsonWithTimeout('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          workflowId,
          schedule,
        }),
      }, 8000)
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se uložit nový plán.')
      }
      setWorkflows((current) =>
        current.map((workflow) =>
          workflow.id === workflowId ? { ...workflow, schedule } : workflow
        )
      )
      setSuccessMessage('Nový plán workflow byl uložen.')
      void loadWorkflows()
    } catch (scheduleError) {
      if (scheduleError instanceof Error && scheduleError.name === 'AbortError') {
        setError('Uložení nového plánu trvalo příliš dlouho. Zkuste to znovu.')
      } else {
        setError(scheduleError instanceof Error ? scheduleError.message : 'Nepodařilo se uložit nový plán.')
      }
    } finally {
      setActingWorkflowId(null)
      setActingLabel(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Workflow</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Plánované úlohy pro pravidelné odesílání e-mailů, monitoring realitních serverů a další opakovatelné back office akce.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        {[
          { label: 'Celkem', value: stats.total, tone: 'text-slate-900 dark:text-slate-100' },
          { label: 'Aktivní', value: stats.active, tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Běžící', value: stats.running, tone: 'text-sky-600 dark:text-sky-400' },
          { label: 'Pozastavené', value: stats.paused, tone: 'text-amber-600 dark:text-amber-400' },
          { label: 'S chybou', value: stats.failed, tone: 'text-rose-600 dark:text-rose-400' },
        ].map((item) => (
          <article
            key={item.label}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{item.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${item.tone}`}>{item.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Nový plánovaný e-mail</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Název workflow" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <input value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} placeholder="Cron výraz, např. 0 9 * * *" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <input value={form.to} onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))} placeholder="Příjemce" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Předmět" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Popis workflow" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm md:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} rows={5} placeholder="Tělo e-mailu" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm md:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={createWorkflow} disabled={creating} className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 disabled:opacity-50 dark:bg-sky-400">
            {creating ? 'Vytvářím…' : 'Vytvořit workflow'}
          </button>
          <span className="text-sm text-slate-500 dark:text-slate-400">Cron příklad: `0 9 * * *` znamená každý den v 9:00.</span>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Aktivní workflow</h2>
          <button onClick={loadWorkflows} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
            Obnovit
          </button>
        </div>

        {actingLabel ? <div className="mb-4"><AppStateInline>{actingLabel}</AppStateInline></div> : null}
        {successMessage ? <div className="mb-4"><AppStateInline tone="success">{successMessage}</AppStateInline></div> : null}

        <div className="space-y-4">
          {workflows.map((workflow) => (
            <article key={workflow.id} className="rounded-3xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{workflow.name}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{workflow.description || 'Bez popisu.'}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-900">{workflow.type}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-900">Status: {workflow.status || 'unknown'}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-900">Cron: {workflow.schedule || 'bez plánu'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runWorkflow(workflow.id)}
                    disabled={actingWorkflowId === workflow.id}
                    className="rounded-full bg-sky-500 px-3 py-2 text-sm font-medium text-sky-950 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-400"
                  >
                    {actingWorkflowId === workflow.id && actingLabel?.includes('Spouštím') ? 'Spouštím…' : 'Spustit teď'}
                  </button>
                  <button
                    onClick={() => pauseOrResumeWorkflow(workflow)}
                    disabled={actingWorkflowId === workflow.id}
                    className="rounded-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                  >
                    {workflow.status === 'paused'
                      ? actingWorkflowId === workflow.id && actingLabel?.includes('Obnovuji')
                        ? 'Obnovuji…'
                        : 'Obnovit'
                      : actingWorkflowId === workflow.id && actingLabel?.includes('Pozastavuji')
                        ? 'Pozastavuji…'
                        : 'Pozastavit'}
                  </button>
                  <button
                    onClick={() => deleteWorkflow(workflow.id)}
                    disabled={actingWorkflowId === workflow.id}
                    className="rounded-full border border-red-200 px-3 py-2 text-sm font-medium text-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:text-red-400"
                  >
                    {actingWorkflowId === workflow.id && actingLabel?.includes('Mažu') ? 'Mažu…' : 'Smazat'}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  defaultValue={workflow.schedule || ''}
                  onBlur={(event) => {
                    const nextValue = event.target.value.trim()
                    if (nextValue && nextValue !== workflow.schedule) {
                      updateSchedule(workflow.id, nextValue)
                    }
                  }}
                  disabled={actingWorkflowId === workflow.id}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Poslední běh: {workflow.last_run ? new Date(workflow.last_run).toLocaleString('cs-CZ') : 'zatím nikdy'}
                </div>
              </div>

              {workflow.task ? (
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                  <p><strong>Komu:</strong> {workflow.task.to || '—'}</p>
                  <p className="mt-1"><strong>Předmět:</strong> {workflow.task.subject || '—'}</p>
                  {workflow.type === 'market_watch' ? (
                    <>
                      <p className="mt-1"><strong>Lokalita:</strong> {workflow.task.locationLabel || '—'}</p>
                      <p className="mt-1"><strong>Zdroje:</strong> {(workflow.task.sources || []).join(', ') || '—'}</p>
                      <p className="mt-1"><strong>Režim:</strong> {workflow.task.mode || 'new'}{workflow.task.limit ? ` · limit ${workflow.task.limit}` : ''}</p>
                    </>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap">{workflow.task.body || '—'}</p>
                  )}
                </div>
              ) : null}

              {workflow.last_error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{workflow.last_error}</p> : null}
            </article>
          ))}
          {!loading && workflows.length === 0 ? (
            <AppStateCard
              compact
              eyebrow="Workflow"
              title="Zatím tu nejsou žádná workflow."
              description="Můžeš je zakládat ručně zde, nebo přirozeně přes AI chat."
            />
          ) : null}
          {loading ? <AppStateInline>Načítám workflow a provozní historii…</AppStateInline> : null}
          {error ? <AppStateCard tone="error" compact eyebrow="Chyba" title="Workflow se nepodařilo načíst." description={error} /> : null}
        </div>
        </div>

        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Poslední běhy</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Krátká provozní historie pro kontrolu, co doběhlo a co spadlo.
          </p>
          <div className="mt-4 space-y-3">
            {recentRuns.map((run) => (
              <article key={run.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{run.workflowName || run.title || 'Workflow run'}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(run.executedAt).toLocaleString('cs-CZ')}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      run.status === 'success'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    {run.status === 'success' ? 'OK' : 'Chyba'}
                  </span>
                </div>

                {run.result ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400">
                    {typeof run.result.fetchedCount === 'number' ? <span>Načteno: {run.result.fetchedCount}</span> : null}
                    {typeof run.result.newCount === 'number' ? <span>Nové: {run.result.newCount}</span> : null}
                    {typeof run.result.storedCount === 'number' ? <span>Uloženo: {run.result.storedCount}</span> : null}
                    {typeof run.result.storedPropertyCount === 'number' ? <span>Nemovitosti: {run.result.storedPropertyCount}</span> : null}
                  </div>
                ) : null}

                {run.error ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{run.error}</p> : null}
              </article>
            ))}

            {recentRuns.length === 0 ? (
              <AppStateCard
                compact
                eyebrow="Historie"
                title="Zatím tu není žádná historie běhů."
                description="Jakmile workflow jednou doběhne, objeví se zde stručný provozní log."
              />
            ) : null}
          </div>
        </aside>
      </section>
    </div>
  )
}
