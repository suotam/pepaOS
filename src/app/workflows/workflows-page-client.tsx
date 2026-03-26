'use client'

import { useEffect, useState } from 'react'

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

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
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
      setWorkflows(data)
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
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Workflow</h1>
        <p className="mt-1 text-sm text-gray-600">
          Plánované úlohy pro pravidelné odesílání e-mailů a další opakovatelné back office akce.
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Nový plánovaný e-mail</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Název workflow" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" />
          <input value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} placeholder="Cron výraz, např. 0 9 * * *" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" />
          <input value={form.to} onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))} placeholder="Příjemce" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" />
          <input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Předmět" className="rounded-xl border border-gray-300 px-4 py-2 text-sm" />
          <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Popis workflow" className="rounded-xl border border-gray-300 px-4 py-2 text-sm md:col-span-2" />
          <textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} rows={5} placeholder="Tělo e-mailu" className="rounded-xl border border-gray-300 px-4 py-2 text-sm md:col-span-2" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={createWorkflow} disabled={creating} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {creating ? 'Vytvářím…' : 'Vytvořit workflow'}
          </button>
          <span className="text-sm text-gray-500">Cron příklad: `0 9 * * *` znamená každý den v 9:00.</span>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Aktivní workflow</h2>
          <button onClick={loadWorkflows} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
            Obnovit
          </button>
        </div>

        {actingLabel ? <p className="mb-4 text-sm text-blue-600">{actingLabel}</p> : null}
        {successMessage ? <p className="mb-4 text-sm text-emerald-600">{successMessage}</p> : null}

        <div className="space-y-4">
          {workflows.map((workflow) => (
            <article key={workflow.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{workflow.name}</h3>
                  <p className="mt-1 text-sm text-gray-600">{workflow.description || 'Bez popisu.'}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-gray-100 px-3 py-1">{workflow.type}</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1">Status: {workflow.status || 'unknown'}</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1">Cron: {workflow.schedule || 'bez plánu'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runWorkflow(workflow.id)}
                    disabled={actingWorkflowId === workflow.id}
                    className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actingWorkflowId === workflow.id && actingLabel?.includes('Spouštím') ? 'Spouštím…' : 'Spustit teď'}
                  </button>
                  <button
                    onClick={() => pauseOrResumeWorkflow(workflow)}
                    disabled={actingWorkflowId === workflow.id}
                    className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm"
                />
                <div className="text-sm text-gray-500">
                  Poslední běh: {workflow.last_run ? new Date(workflow.last_run).toLocaleString('cs-CZ') : 'zatím nikdy'}
                </div>
              </div>

              {workflow.task ? (
                <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
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

              {workflow.last_error ? <p className="mt-3 text-sm text-red-600">{workflow.last_error}</p> : null}
            </article>
          ))}
          {!loading && workflows.length === 0 ? (
            <p className="text-sm text-gray-500">Zatím tu nejsou žádná workflow.</p>
          ) : null}
          {loading ? <p className="text-sm text-gray-500">Načítám workflow…</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </section>
    </div>
  )
}
