'use client'

import { useEffect, useMemo, useState } from 'react'

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

export default function DataPage() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null)
  const [entity, setEntity] = useState<DataEntity>('clients')
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<Record<string, any>[]>([])
  const [count, setCount] = useState(0)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [isCreating, setIsCreating] = useState(false)
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
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nepodařilo se načíst záznamy.')
    } finally {
      setLoading(false)
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
    } else {
      updateUrlState(entity, null)
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
      await loadRecords(entity, query, null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Smazání selhalo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Data</h1>
            <p className="mt-1 text-sm text-gray-600">
              Prohlížení, editace, vytváření a mazání záznamů v klientské a realitní databázi.
            </p>
          </div>
          <div className="rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700">
            Viditelné záznamy {count}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
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
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {definition?.label || item}
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={currentDefinition?.searchPlaceholder || 'Hledat'}
              className="min-w-[240px] flex-1 rounded-xl border border-gray-300 px-4 py-2 text-sm"
            />
            <button onClick={() => loadRecords(entity, query, selectedRecordId)} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
              Obnovit
            </button>
            <button onClick={startCreate} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
              Nový záznam
            </button>
          </div>

          <div className="mt-4">
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {(currentDefinition?.listColumns || []).map((column) => (
                      <th key={column} className="px-4 py-3 text-left font-medium text-gray-600">
                        {getColumnLabel(currentDefinition, column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {records.map((record) => {
                    const active = record.id === selectedRecordId && !isCreating
                    return (
                      <tr
                        key={record.id}
                        onClick={() => selectRecord(record)}
                        className={`cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        {(currentDefinition?.listColumns || []).map((column) => (
                          <td key={`${record.id}-${column}`} className="px-4 py-3 text-gray-700">
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
              <p className="mt-4 text-sm text-gray-500">Pro aktuální výběr nejsou k dispozici žádné záznamy.</p>
            ) : null}
            {loading ? <p className="mt-4 text-sm text-gray-500">Načítám data…</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isCreating ? 'Nový záznam' : selectedRecord ? 'Detail záznamu' : 'Výběr záznamu'}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {currentDefinition?.description || 'Vyberte entitu a začněte pracovat s daty.'}
              </p>
            </div>
            {!isCreating && selectedRecordId ? (
              <button onClick={deleteRecord} className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600">
                Smazat
              </button>
            ) : null}
          </div>

          {currentDefinition ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
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
                    <span className="mb-1 block text-sm font-medium text-gray-700">{field.label}</span>
                    {field.readOnly ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                        {formatValue(value, field.name)}
                      </div>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={value ?? ''}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                        rows={4}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        value={value ?? ''}
                        onChange={(event) => handleFieldChange(field.name, event.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
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
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    )}
                  </label>
                )
              })}

              <div className="flex gap-3">
                <button onClick={saveRecord} disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
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
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
                >
                  Zrušit změny
                </button>
              </div>
            </div>
          ) : null}

          {!currentDefinition ? <p className="mt-4 text-sm text-gray-500">Načítám konfiguraci…</p> : null}
          {error ? <p className="mt-4 whitespace-pre-wrap text-sm text-red-600">{error}</p> : null}
        </section>
      </div>
    </div>
  )
}
