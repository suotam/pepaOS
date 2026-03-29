'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppStateCard, AppStateInline } from '../components/AppStateCard'

type DataEntity = 'clients' | 'properties' | 'leads' | 'deals'

type FieldType = 'text' | 'textarea' | 'number' | 'datetime' | 'select'

type DataFieldDefinition = {
  name: string
  label: string
  type: FieldType
  required?: boolean
  readOnly?: boolean
  options?: string[]
  referenceEntity?: 'clients' | 'properties'
}

type DataEntityDefinition = {
  entity: DataEntity
  label: string
  description: string
  searchPlaceholder: string
  listColumns: string[]
  defaultSortColumn: string
  searchFields: string[]
  fields: DataFieldDefinition[]
}

type ReferenceOption = { value: string; label: string }

type MetadataResponse = {
  entities: DataEntityDefinition[]
  references: {
    clients: ReferenceOption[]
    properties: ReferenceOption[]
  }
}

type RecordsResponse = {
  definition: DataEntityDefinition
  count: number
  records: Record<string, any>[]
}

type RecordDetailResponse = {
  record: Record<string, any>
  related: {
    clients?: Record<string, any>[]
    properties?: Record<string, any>[]
    leads?: Record<string, any>[]
    deals?: Record<string, any>[]
    propertySources?: Record<string, any>[]
  }
  timeline: Array<{
    id: string
    at: string
    title: string
    description: string
    kind: 'created' | 'lead' | 'deal' | 'source' | 'note'
  }>
}

type DataAction = {
  entity?: DataEntity
  query?: string
  selectedRecordId?: string | null
  refresh?: boolean
}

const ENTITY_ORDER: DataEntity[] = ['clients', 'properties', 'leads', 'deals']

function formatValue(value: any, fieldName?: string) {
  if (value === null || value === undefined || value === '') return '—'
  if (fieldName === 'asking_price' || fieldName === 'amount') {
    return `${Number(value).toLocaleString('cs-CZ')} Kč`
  }
  if (fieldName?.includes('created_at') || fieldName === 'closed_at') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('cs-CZ')
  }
  return String(value)
}

function toDateTimeInputValue(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getInitialFormData(definition?: DataEntityDefinition) {
  if (!definition) return {}
  return definition.fields.reduce<Record<string, any>>((acc, field) => {
    if (!field.readOnly) acc[field.name] = ''
    return acc
  }, {})
}

function getColumnLabel(definition: DataEntityDefinition | null, column: string) {
  const explicit = definition?.fields.find((field) => field.name === column)?.label
  if (explicit) return explicit
  if (column === 'client_name') return 'Klient'
  if (column === 'property_title') return 'Nemovitost'
  return column
}

function formatEntityLabel(entity: DataEntity) {
  if (entity === 'clients') return 'Klienti'
  if (entity === 'properties') return 'Nemovitosti'
  if (entity === 'leads') return 'Leady'
  return 'Dealy'
}

export default function DataPage() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null)
  const [entity, setEntity] = useState<DataEntity>('clients')
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<Record<string, any>[]>([])
  const [count, setCount] = useState(0)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [isCreating, setIsCreating] = useState(false)
  const [recordDetail, setRecordDetail] = useState<RecordDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentDefinition = useMemo(
    () => metadata?.entities.find((definition) => definition.entity === entity) || null,
    [entity, metadata]
  )

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId]
  )

  const updateUrlState = (nextEntity: DataEntity, nextRecordId: string | null) => {
    const params = new URLSearchParams(window.location.search)
    params.set('entity', nextEntity)
    if (nextRecordId) params.set('selectedRecordId', nextRecordId)
    else params.delete('selectedRecordId')
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }

  const loadMetadata = async () => {
    const response = await fetch('/api/data/meta', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Nepodařilo se načíst metadata datové stránky.')
    }
    setMetadata(data)
  }

  const loadRecords = async (nextEntity = entity, nextQuery = query, nextSelectedId = selectedRecordId) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (nextQuery.trim()) params.set('q', nextQuery.trim())
      const response = await fetch(`/api/data/${nextEntity}?${params.toString()}`, { cache: 'no-store' })
      const data = (await response.json()) as RecordsResponse & { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se načíst záznamy.')
      }
      setRecords(data.records)
      setCount(data.count)

      const nextSelectedRecord = data.records.find((record) => record.id === nextSelectedId)
      if (nextSelectedId && nextSelectedRecord) {
        setSelectedRecordId(nextSelectedId)
        setFormData(nextSelectedRecord)
        setIsCreating(false)
      } else if (!isCreating) {
        setSelectedRecordId(null)
        setFormData(getInitialFormData(data.definition))
        setRecordDetail(null)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nepodařilo se načíst záznamy.')
    } finally {
      setLoading(false)
    }
  }

  const loadRecordDetail = async (nextEntity: DataEntity, id: string) => {
    try {
      const response = await fetch(`/api/data/${nextEntity}/${id}`, { cache: 'no-store' })
      const data = (await response.json()) as RecordDetailResponse & { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se načíst detail záznamu.')
      }
      setRecordDetail(data)
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Nepodařilo se načíst detail záznamu.')
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialEntity = params.get('entity')
    const initialRecordId = params.get('selectedRecordId')
    if (initialEntity && ENTITY_ORDER.includes(initialEntity as DataEntity)) {
      setEntity(initialEntity as DataEntity)
    }
    if (initialRecordId) {
      setSelectedRecordId(initialRecordId)
    }
  }, [])

  useEffect(() => {
    loadMetadata().catch((metadataError) => {
      setError(metadataError instanceof Error ? metadataError.message : 'Nepodařilo se načíst metadata.')
    })
  }, [])

  useEffect(() => {
    if (!metadata) return
    loadRecords(entity, query, selectedRecordId)
  }, [entity, metadata])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!metadata) return
      loadRecords(entity, query, selectedRecordId)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [entity, metadata, query])

  useEffect(() => {
    if (isCreating) return
    if (selectedRecord) {
      setFormData(selectedRecord)
      updateUrlState(entity, selectedRecord.id)
      void loadRecordDetail(entity, selectedRecord.id)
    } else {
      updateUrlState(entity, null)
      setRecordDetail(null)
    }
  }, [entity, isCreating, selectedRecord])

  useEffect(() => {
    const handleDataCommand = (event: Event) => {
      const customEvent = event as CustomEvent<DataAction>
      const detail = customEvent.detail || {}
      const nextEntity = detail.entity || entity
      if (detail.entity) setEntity(detail.entity)
      if (typeof detail.query === 'string') setQuery(detail.query)
      if (typeof detail.selectedRecordId !== 'undefined') setSelectedRecordId(detail.selectedRecordId)
      if (detail.refresh) {
        loadRecords(nextEntity, typeof detail.query === 'string' ? detail.query : query, detail.selectedRecordId ?? selectedRecordId)
      }
    }

    window.addEventListener('pepaos-data-command', handleDataCommand as EventListener)
    return () => window.removeEventListener('pepaos-data-command', handleDataCommand as EventListener)
  }, [entity, query, selectedRecordId])

  const startCreate = () => {
    setIsCreating(true)
    setSelectedRecordId(null)
    setFormData(getInitialFormData(currentDefinition || undefined))
    setRecordDetail(null)
    updateUrlState(entity, null)
  }

  const selectRecord = (record: Record<string, any>) => {
    setIsCreating(false)
    setSelectedRecordId(record.id)
    setFormData(record)
  }

  const handleFieldChange = (fieldName: string, value: string) => {
    setFormData((current) => ({ ...current, [fieldName]: value }))
  }

  const saveRecord = async () => {
    if (!currentDefinition) return
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, any> = {}
      currentDefinition.fields.forEach((field) => {
        if (field.readOnly) return
        payload[field.name] = formData[field.name] ?? ''
      })

      const response = await fetch(
        isCreating ? `/api/data/${entity}` : `/api/data/${entity}/${selectedRecordId}`,
        {
          method: isCreating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isCreating ? { record: payload } : { changes: payload }),
        }
      )

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Uložení selhalo.')
      }

      const savedRecord = data.record
      setIsCreating(false)
      setSelectedRecordId(savedRecord.id)
      setFormData(savedRecord)
      await loadRecords(entity, query, savedRecord.id)
      await loadRecordDetail(entity, savedRecord.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Uložení selhalo.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRecord = async () => {
    if (!selectedRecordId) return
    const confirmed = window.confirm('Opravdu chcete tento záznam smazat? Tato akce je nevratná.')
    if (!confirmed) return

    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/data/${entity}/${selectedRecordId}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Smazání selhalo.')
      }
      setSelectedRecordId(null)
      setIsCreating(false)
      setFormData(getInitialFormData(currentDefinition || undefined))
      setRecordDetail(null)
      await loadRecords(entity, query, null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Smazání selhalo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Data</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Prohlížení, editace, vytváření a mazání záznamů v klientské a realitní databázi.
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Viditelné záznamy {count}
          </div>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {ENTITY_ORDER.map((item) => {
          const definition = metadata?.entities.find((entityDefinition) => entityDefinition.entity === item)
          const active = item === entity
          return (
            <button
              key={item}
              onClick={() => {
                setEntity(item)
                setIsCreating(false)
                setSelectedRecordId(null)
              }}
              className={`rounded-3xl border p-5 text-left shadow-sm transition ${
                active
                  ? 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/30'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
              }`}
            >
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{formatEntityLabel(item)}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{definition?.label || item}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{definition?.description || 'Práce s daty entity.'}</p>
            </button>
          )
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={currentDefinition?.searchPlaceholder || 'Hledat'}
              className="min-w-[240px] flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button onClick={() => loadRecords(entity, query, selectedRecordId)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
              Obnovit
            </button>
            <button onClick={startCreate} className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 dark:bg-sky-400">
              Nový záznam
            </button>
          </div>

          <div className="mt-4">
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900/70">
                  <tr>
                    {(currentDefinition?.listColumns || []).map((column) => (
                      <th key={column} className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                        {getColumnLabel(currentDefinition, column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-900 dark:bg-slate-950">
                  {records.map((record) => {
                    const active = record.id === selectedRecordId && !isCreating
                    return (
                      <tr
                        key={record.id}
                        onClick={() => selectRecord(record)}
                        className={`cursor-pointer ${active ? 'bg-sky-50 dark:bg-sky-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-900/70'}`}
                      >
                        {(currentDefinition?.listColumns || []).map((column) => (
                          <td key={`${record.id}-${column}`} className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            {formatValue(record[column], column)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!loading && records.length === 0 ? (
              <div className="mt-4">
                <AppStateCard
                  compact
                  eyebrow="Prázdný výběr"
                  title="Pro aktuální filtr nemáme žádné záznamy."
                  description="Zkus upravit hledání, přepnout entitu nebo založit nový záznam."
                />
              </div>
            ) : null}
            {loading ? (
              <div className="mt-4">
                <AppStateInline>Načítám data pro vybranou entitu…</AppStateInline>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {isCreating ? 'Nový záznam' : selectedRecord ? 'Detail záznamu' : 'Výběr záznamu'}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {currentDefinition?.description || 'Vyberte entitu a začněte pracovat s daty.'}
              </p>
            </div>
            {!isCreating && selectedRecordId ? (
              <button onClick={deleteRecord} className="rounded-full border border-red-200 px-3 py-2 text-sm font-medium text-red-600 dark:border-red-900/60 dark:text-red-400">
                Smazat
              </button>
            ) : null}
          </div>

          {currentDefinition ? (
            <div className="mt-4 space-y-4">
              {!isCreating && selectedRecord ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {currentDefinition.label}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {formatValue(
                      selectedRecord.name ||
                        selectedRecord.title ||
                        selectedRecord.client_name ||
                        selectedRecord.property_title ||
                        selectedRecord.stage
                    )}
                  </p>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    {selectedRecord.city || selectedRecord.address || selectedRecord.source || selectedRecord.status || currentDefinition.description}
                  </p>
                </div>
              ) : null}

              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/70 dark:text-slate-400">
                ID: {selectedRecordId || 'nový záznam'}
              </div>

              {currentDefinition.fields.map((field) => {
                const value = formData[field.name]
                const selectOptions =
                  field.referenceEntity && metadata
                    ? metadata.references[field.referenceEntity]
                    : (field.options || []).map((option) => ({ value: option, label: option }))

                return (
                  <label key={field.name} className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{field.label}</span>
                    {field.readOnly ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                        {formatValue(value, field.name)}
                      </div>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={value ?? ''}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                        rows={4}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        value={value ?? ''}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="">Vyberte…</option>
                        {selectOptions?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : 'text'}
                        value={field.type === 'datetime' ? toDateTimeInputValue(value) : (value ?? '')}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    )}
                  </label>
                )
              })}

              <div className="flex gap-3">
                <button onClick={saveRecord} disabled={saving} className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 disabled:opacity-50 dark:bg-sky-400">
                  {saving ? 'Ukládám…' : isCreating ? 'Vytvořit' : 'Uložit změny'}
                </button>
                <button
                  onClick={() => {
                    if (selectedRecord) {
                      setIsCreating(false)
                      setFormData(selectedRecord)
                    } else {
                      setIsCreating(false)
                      setFormData(getInitialFormData(currentDefinition))
                    }
                  }}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Zrušit změny
                </button>
              </div>

              {!isCreating && recordDetail ? (
                <>
                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Vazby
                    </h3>
                    <div className="mt-3 space-y-3 text-sm">
                      {recordDetail.related.clients?.length ? (
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">Klienti</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {recordDetail.related.clients.map((item) => (
                              <span key={item.id} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {item.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recordDetail.related.properties?.length ? (
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">Nemovitosti</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {recordDetail.related.properties.map((item) => (
                              <span key={item.id} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {item.title}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recordDetail.related.leads?.length ? (
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">Leady</p>
                          <div className="mt-2 space-y-2">
                            {recordDetail.related.leads.slice(0, 4).map((item) => (
                              <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                                {item.client_name || 'Klient'} · {item.source_channel || 'bez zdroje'} · {item.status || 'unknown'}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recordDetail.related.deals?.length ? (
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">Dealy</p>
                          <div className="mt-2 space-y-2">
                            {recordDetail.related.deals.slice(0, 4).map((item) => (
                              <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                                {(item.client_name || item.property_title || 'Deal')} · {item.stage || 'unknown'}
                                {item.amount ? ` · ${Number(item.amount).toLocaleString('cs-CZ')} Kč` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recordDetail.related.propertySources?.length ? (
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">Zdroje nemovitosti</p>
                          <div className="mt-2 space-y-2">
                            {recordDetail.related.propertySources.slice(0, 4).map((item) => (
                              <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                                {item.source || 'unknown'} {item.source_url ? `· ${item.source_url}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Timeline
                    </h3>
                    <div className="mt-4 space-y-3">
                      {recordDetail.timeline.length ? (
                        recordDetail.timeline.map((item) => (
                          <div key={item.id} className="relative rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              {new Date(item.at).toLocaleString('cs-CZ')}
                            </p>
                            <p className="mt-2 font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.description}</p>
                          </div>
                        ))
                      ) : (
                        <AppStateCard
                          compact
                          eyebrow="Timeline"
                          title="Pro tento záznam zatím není dostupná detailní historie."
                          description="Další aktivita se zde začne zobrazovat po úpravách, navázaných leadech, dealech nebo synchronizaci zdrojů."
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {!currentDefinition ? (
            <div className="mt-4">
              <AppStateInline>Načítám konfiguraci datového workspace…</AppStateInline>
            </div>
          ) : null}
          {error ? (
            <div className="mt-4">
              <AppStateCard tone="error" compact eyebrow="Chyba" title="Datová stránka narazila na problém." description={error} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
