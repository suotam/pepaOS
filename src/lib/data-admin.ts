import { alignPropertyCoordinates, backfillPropertyLocation } from './czech-property-seed'
import { supabase } from './supabase'
import { buildGeocodedPropertyPayload, ensurePropertyGeocodeColumns, stripUnsupportedPropertyGeocodeColumns } from './ruian'

export type DataEntity = 'clients' | 'properties' | 'leads' | 'deals'

type FieldType = 'text' | 'textarea' | 'number' | 'datetime' | 'select'

export type DataFieldDefinition = {
  name: string
  label: string
  type: FieldType
  required?: boolean
  readOnly?: boolean
  options?: string[]
  referenceEntity?: 'clients' | 'properties'
}

export type DataEntityDefinition = {
  entity: DataEntity
  label: string
  description: string
  searchPlaceholder: string
  listColumns: string[]
  defaultSortColumn: string
  searchFields: string[]
  fields: DataFieldDefinition[]
}

export type DataRecordDetail = {
  record: Record<string, any>
  related: {
    clients?: Array<Record<string, any>>
    properties?: Array<Record<string, any>>
    leads?: Array<Record<string, any>>
    deals?: Array<Record<string, any>>
    propertySources?: Array<Record<string, any>>
  }
  timeline: Array<{
    id: string
    at: string
    title: string
    description: string
    kind: 'created' | 'lead' | 'deal' | 'source' | 'note'
  }>
}

type RecordWithRelations = Record<string, any>

const ENTITY_DEFINITIONS: Record<DataEntity, DataEntityDefinition> = {
  clients: {
    entity: 'clients',
    label: 'Klienti',
    description: 'Kontakty a zdroje klientů',
    searchPlaceholder: 'Hledat podle jména, zdroje nebo ownera',
    listColumns: ['name', 'source', 'owner', 'created_at'],
    defaultSortColumn: 'created_at',
    searchFields: ['name', 'source', 'owner'],
    fields: [
      { name: 'name', label: 'Jméno', type: 'text', required: true },
      { name: 'source', label: 'Zdroj', type: 'text' },
      { name: 'owner', label: 'Owner', type: 'text' },
      { name: 'created_at', label: 'Vytvořeno', type: 'datetime', readOnly: true },
    ],
  },
  properties: {
    entity: 'properties',
    label: 'Nemovitosti',
    description: 'Portfolio nemovitostí a jejich stav',
    searchPlaceholder: 'Hledat podle názvu, adresy, města nebo stavu',
    listColumns: ['title', 'city', 'property_type', 'status', 'asking_price'],
    defaultSortColumn: 'created_at',
    searchFields: [
      'title',
      'address',
      'locality',
      'city',
      'region',
      'property_type',
      'status',
      'reconstruction_status',
    ],
    fields: [
      { name: 'title', label: 'Název', type: 'text', required: true },
      { name: 'address', label: 'Adresa', type: 'text', required: true },
      { name: 'locality', label: 'Lokalita', type: 'text' },
      { name: 'city', label: 'Město', type: 'text' },
      { name: 'region', label: 'Region', type: 'text' },
      { name: 'latitude', label: 'Latitude', type: 'number' },
      { name: 'longitude', label: 'Longitude', type: 'number' },
      { name: 'property_type', label: 'Typ', type: 'text' },
      { name: 'status', label: 'Stav', type: 'text' },
      { name: 'asking_price', label: 'Nabídková cena', type: 'number' },
      { name: 'reconstruction_status', label: 'Rekonstrukce', type: 'text' },
      { name: 'renovation_notes', label: 'Poznámky k rekonstrukci', type: 'textarea' },
      { name: 'structural_modifications', label: 'Stavební úpravy', type: 'textarea' },
      { name: 'created_at', label: 'Vytvořeno', type: 'datetime', readOnly: true },
    ],
  },
  leads: {
    entity: 'leads',
    label: 'Leady',
    description: 'Lead pipeline a zdroje leadů',
    searchPlaceholder: 'Hledat podle klienta, zdroje nebo statusu',
    listColumns: ['client_name', 'source_channel', 'status', 'created_at'],
    defaultSortColumn: 'created_at',
    searchFields: ['source_channel', 'status', 'client_name'],
    fields: [
      { name: 'client_id', label: 'Klient', type: 'select', referenceEntity: 'clients', required: true },
      { name: 'source_channel', label: 'Zdroj', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'created_at', label: 'Vytvořeno', type: 'datetime', readOnly: true },
    ],
  },
  deals: {
    entity: 'deals',
    label: 'Dealy',
    description: 'Obchodní pipeline a uzavřené obchody',
    searchPlaceholder: 'Hledat podle klienta, nemovitosti nebo stage',
    listColumns: ['stage', 'amount', 'client_name', 'property_title', 'closed_at'],
    defaultSortColumn: 'closed_at',
    searchFields: ['stage', 'client_name', 'property_title'],
    fields: [
      { name: 'client_id', label: 'Klient', type: 'select', referenceEntity: 'clients', required: true },
      { name: 'property_id', label: 'Nemovitost', type: 'select', referenceEntity: 'properties', required: true },
      { name: 'stage', label: 'Stage', type: 'text' },
      { name: 'amount', label: 'Částka', type: 'number' },
      { name: 'closed_at', label: 'Uzavřeno', type: 'datetime' },
    ],
  },
}

const SELECT_BY_ENTITY: Record<DataEntity, string> = {
  clients: '*',
  properties: '*',
  leads: '*, client:clients(id, name)',
  deals: '*, client:clients(id, name), property:properties(id, title, address)',
}

const DEFAULT_LIMIT = 5000

function isNonEmptyValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function matchesSearch(record: RecordWithRelations, searchFields: string[], query: string) {
  if (!query) return true
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return searchFields.some((field) => {
    const value = record[field]
    if (!isNonEmptyValue(value)) return false
    return String(value).toLowerCase().includes(normalizedQuery)
  })
}

function compareValues(left: any, right: any) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1

  if (typeof left === 'number' && typeof right === 'number') {
    return right - left
  }

  const leftDate = Date.parse(left)
  const rightDate = Date.parse(right)
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return rightDate - leftDate
  }

  return String(left).localeCompare(String(right))
}

function normalizeRow(entity: DataEntity, row: RecordWithRelations) {
  if (entity === 'leads') {
    return {
      ...row,
      client_name: row.client?.name || '',
    }
  }

  if (entity === 'deals') {
    return {
      ...row,
      client_name: row.client?.name || '',
      property_title: row.property?.title || '',
    }
  }

  return row
}

function sanitizeValue(field: DataFieldDefinition, value: any) {
  if (value === undefined) return undefined
  if (value === '') return null

  if (field.type === 'number') {
    if (value === null) return null
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(/\s+/g, '').replace(',', '.'))
    if (Number.isNaN(parsed)) {
      throw new Error(`Pole ${field.label} musí být číslo.`)
    }
    return parsed
  }

  if (field.type === 'datetime') {
    if (value === null) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Pole ${field.label} musí být platné datum a čas.`)
    }
    return date.toISOString()
  }

  return value
}

function sanitizePayload(entity: DataEntity, payload: Record<string, any>, mode: 'create' | 'update') {
  const definition = ENTITY_DEFINITIONS[entity]
  const nextPayload: Record<string, any> = {}

  for (const field of definition.fields) {
    if (field.readOnly) continue
    if (!(field.name in payload)) continue
    nextPayload[field.name] = sanitizeValue(field, payload[field.name])
  }

  if (mode === 'create') {
    for (const field of definition.fields) {
      if (!field.required || field.readOnly) continue
      if (!isNonEmptyValue(nextPayload[field.name])) {
        throw new Error(`Pole ${field.label} je povinné.`)
      }
    }
  }

  if (!Object.keys(nextPayload).length) {
    throw new Error('Nebyla předána žádná platná data pro uložení.')
  }

  return nextPayload
}

function enrichPropertyPayloadForMap(payload: Record<string, any>) {
  const backfilled = backfillPropertyLocation(payload as any)
  const aligned = alignPropertyCoordinates(backfilled as any)

  return {
    ...payload,
    address: backfilled.address,
    city: backfilled.city,
    locality: backfilled.locality,
    region: backfilled.region,
    latitude: aligned.latitude,
    longitude: aligned.longitude,
  }
}

async function fetchBaseRecords(entity: DataEntity, limit?: number) {
  const definition = ENTITY_DEFINITIONS[entity]
  const sortColumn = definition.defaultSortColumn
  let query = supabase
    .from(entity)
    .select(SELECT_BY_ENTITY[entity])
    .order(sortColumn, { ascending: false, nullsFirst: false })

  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return (data || []).map((row) => normalizeRow(entity, row))
}

async function fetchReferenceOptions(entity: 'clients' | 'properties') {
  const select = entity === 'clients' ? 'id, name, created_at' : 'id, title, address, created_at'
  const { data, error } = await supabase
    .from(entity)
    .select(select)
    .order('created_at', { ascending: false })
    .limit(250)

  if (error) {
    throw new Error(error.message)
  }

  return (data || []).map((record: any) => ({
    value: record.id,
    label: entity === 'clients' ? record.name : `${record.title}${record.address ? ` · ${record.address}` : ''}`,
  }))
}

export function getDataEntityDefinitions() {
  return Object.values(ENTITY_DEFINITIONS)
}

export function getDataEntityDefinition(entity: DataEntity) {
  return ENTITY_DEFINITIONS[entity]
}

export function isDataEntity(value: string): value is DataEntity {
  return value in ENTITY_DEFINITIONS
}

export async function listDataRecords(params: {
  entity: DataEntity
  query?: string
  limit?: number
}) {
  const definition = ENTITY_DEFINITIONS[params.entity]
  const rows = await fetchBaseRecords(params.entity, params.limit ?? DEFAULT_LIMIT)
  const filtered = rows.filter((row) => matchesSearch(row, definition.searchFields, params.query || ''))

  return {
    definition,
    count: filtered.length,
    records: filtered,
  }
}

export async function getDataRecord(entity: DataEntity, id: string) {
  const { data, error } = await supabase.from(entity).select(SELECT_BY_ENTITY[entity]).eq('id', id).maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Záznam nebyl nalezen.')
  }
  return normalizeRow(entity, data as RecordWithRelations)
}

function sortTimelineDescending<T extends { at: string }>(items: T[]) {
  return [...items].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
}

export async function getDataRecordDetail(entity: DataEntity, id: string): Promise<DataRecordDetail> {
  const record = await getDataRecord(entity, id)
  const related: DataRecordDetail['related'] = {}
  const timeline: DataRecordDetail['timeline'] = []

  if (record.created_at) {
    timeline.push({
      id: `${entity}-${id}-created`,
      at: record.created_at,
      title: 'Záznam vytvořen',
      description:
        entity === 'clients'
          ? `Klient ${record.name || 'bez názvu'} byl založen do systému.`
          : entity === 'properties'
            ? `Nemovitost ${record.title || 'bez názvu'} byla založena do systému.`
            : entity === 'leads'
              ? `Lead byl založen se statusem ${record.status || 'unknown'}.`
              : `Deal byl založen ve fázi ${record.stage || 'unknown'}.`,
      kind: 'created',
    })
  }

  if (entity === 'clients') {
    const [leadsRes, dealsRes] = await Promise.all([
      supabase
        .from('leads')
        .select('*, client:clients(id, name)')
        .eq('client_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('deals')
        .select('*, property:properties(id, title, city), client:clients(id, name)')
        .eq('client_id', id)
        .order('closed_at', { ascending: false, nullsFirst: false }),
    ])

    if (leadsRes.error) throw new Error(leadsRes.error.message)
    if (dealsRes.error) throw new Error(dealsRes.error.message)

    const clientLeads = (leadsRes.data || []).map((row: any) => normalizeRow('leads', row))
    const clientDeals = (dealsRes.data || []).map((row: any) => normalizeRow('deals', row))
    related.leads = clientLeads
    related.deals = clientDeals

    clientLeads.forEach((lead: Record<string, any>) => {
      if (!lead.created_at) return
      timeline.push({
        id: `lead-${lead.id}`,
        at: lead.created_at,
        title: 'Nový lead',
        description: `Zdroj ${lead.source_channel || 'neuveden'} · status ${lead.status || 'unknown'}.`,
        kind: 'lead',
      })
    })

    clientDeals.forEach((deal: Record<string, any>) => {
      const at = deal.closed_at || deal.created_at
      if (!at) return
      timeline.push({
        id: `deal-${deal.id}`,
        at,
        title: 'Deal',
        description: `${deal.stage || 'unknown'}${deal.property_title ? ` · ${deal.property_title}` : ''}${deal.amount ? ` · ${Number(deal.amount).toLocaleString('cs-CZ')} Kč` : ''}`,
        kind: 'deal',
      })
    })
  }

  if (entity === 'properties') {
    const [dealsRes, sourcesRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, client:clients(id, name), property:properties(id, title, city)')
        .eq('property_id', id)
        .order('closed_at', { ascending: false, nullsFirst: false }),
      supabase
        .from('property_sources')
        .select('*')
        .eq('property_id', id)
        .order('synced_at', { ascending: false }),
    ])

    if (dealsRes.error) throw new Error(dealsRes.error.message)
    if (sourcesRes.error) throw new Error(sourcesRes.error.message)

    const propertyDeals = (dealsRes.data || []).map((row: any) => normalizeRow('deals', row))
    const propertySources = sourcesRes.data || []
    related.deals = propertyDeals
    related.propertySources = propertySources

    propertyDeals.forEach((deal: Record<string, any>) => {
      const at = deal.closed_at || deal.created_at
      if (!at) return
      timeline.push({
        id: `deal-${deal.id}`,
        at,
        title: 'Deal navázán',
        description: `${deal.client_name || 'Klient'} · ${deal.stage || 'unknown'}${deal.amount ? ` · ${Number(deal.amount).toLocaleString('cs-CZ')} Kč` : ''}`,
        kind: 'deal',
      })
    })

    propertySources.forEach((source: Record<string, any>) => {
      if (!source.synced_at) return
      timeline.push({
        id: `source-${source.id}`,
        at: source.synced_at,
        title: 'Synchronizace zdroje',
        description: `${source.source || 'unknown'}${source.source_url ? ` · ${source.source_url}` : ''}`,
        kind: 'source',
      })
    })
  }

  if (entity === 'leads') {
    const [clientRes, dealsRes] = await Promise.all([
      record.client_id
        ? supabase.from('clients').select('*').eq('id', record.client_id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      record.client_id
        ? supabase
            .from('deals')
            .select('*, client:clients(id, name), property:properties(id, title, city)')
            .eq('client_id', record.client_id)
            .order('closed_at', { ascending: false, nullsFirst: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null } as any),
    ])

    if (clientRes.error) throw new Error(clientRes.error.message)
    if (dealsRes.error) throw new Error(dealsRes.error.message)

    const leadClients = clientRes.data ? [clientRes.data] : []
    const leadDeals = (dealsRes.data || []).map((row: any) => normalizeRow('deals', row))
    related.clients = leadClients
    related.deals = leadDeals

    if (clientRes.data?.created_at) {
      timeline.push({
        id: `client-${clientRes.data.id}`,
        at: clientRes.data.created_at,
        title: 'Klient založen',
        description: clientRes.data.name || 'Klient',
        kind: 'note',
      })
    }

    leadDeals.forEach((deal: Record<string, any>) => {
      const at = deal.closed_at || deal.created_at
      if (!at) return
      timeline.push({
        id: `deal-${deal.id}`,
        at,
        title: 'Související deal',
        description: `${deal.property_title || 'Nemovitost'} · ${deal.stage || 'unknown'}`,
        kind: 'deal',
      })
    })
  }

  if (entity === 'deals') {
    const [clientRes, propertyRes] = await Promise.all([
      record.client_id
        ? supabase.from('clients').select('*').eq('id', record.client_id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      record.property_id
        ? supabase.from('properties').select('*').eq('id', record.property_id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
    ])

    if (clientRes.error) throw new Error(clientRes.error.message)
    if (propertyRes.error) throw new Error(propertyRes.error.message)

    related.clients = clientRes.data ? [clientRes.data] : []
    related.properties = propertyRes.data ? [propertyRes.data] : []

    if (clientRes.data?.created_at) {
      timeline.push({
        id: `client-${clientRes.data.id}`,
        at: clientRes.data.created_at,
        title: 'Klient v systému',
        description: clientRes.data.name || 'Klient',
        kind: 'note',
      })
    }

    if (propertyRes.data?.created_at) {
      timeline.push({
        id: `property-${propertyRes.data.id}`,
        at: propertyRes.data.created_at,
        title: 'Nemovitost v systému',
        description: propertyRes.data.title || 'Nemovitost',
        kind: 'note',
      })
    }
  }

  return {
    record,
    related,
    timeline: sortTimelineDescending(timeline),
  }
}

export async function createDataRecord(entity: DataEntity, payload: Record<string, any>) {
  let sanitized = sanitizePayload(entity, payload, 'create')

  if (entity === 'properties') {
    await ensurePropertyGeocodeColumns()
    sanitized = await buildGeocodedPropertyPayload(sanitized)
    sanitized = enrichPropertyPayloadForMap(sanitized)
  }

  let { data, error } = await supabase.from(entity).insert(sanitized).select(SELECT_BY_ENTITY[entity]).single()

  if (error && entity === 'properties') {
    const fallbackPayload = stripUnsupportedPropertyGeocodeColumns(sanitized, error.message)
    if (fallbackPayload !== sanitized) {
      const retry = await supabase.from(entity).insert(fallbackPayload).select(SELECT_BY_ENTITY[entity]).single()
      data = retry.data as any
      error = retry.error as any
    }
  }

  if (error) {
    throw new Error(error.message)
  }
  return normalizeRow(entity, data as RecordWithRelations)
}

export async function updateDataRecord(entity: DataEntity, id: string, payload: Record<string, any>) {
  let sanitized = sanitizePayload(entity, payload, 'update')

  if (entity === 'properties') {
    await ensurePropertyGeocodeColumns()
    const existing = await getDataRecord(entity, id)
    sanitized = await buildGeocodedPropertyPayload(sanitized, existing as any)
    sanitized = enrichPropertyPayloadForMap({
      ...existing,
      ...sanitized,
    })
  }

  let { data, error } = await supabase.from(entity).update(sanitized).eq('id', id).select(SELECT_BY_ENTITY[entity]).single()

  if (error && entity === 'properties') {
    const fallbackPayload = stripUnsupportedPropertyGeocodeColumns(sanitized, error.message)
    if (fallbackPayload !== sanitized) {
      const retry = await supabase.from(entity).update(fallbackPayload).eq('id', id).select(SELECT_BY_ENTITY[entity]).single()
      data = retry.data as any
      error = retry.error as any
    }
  }

  if (error) {
    throw new Error(error.message)
  }
  return normalizeRow(entity, data as RecordWithRelations)
}

export async function deleteDataRecord(entity: DataEntity, id: string) {
  const record = await getDataRecord(entity, id)
  const { error } = await supabase.from(entity).delete().eq('id', id)
  if (error) {
    throw new Error(error.message)
  }
  return record
}

export async function getDataExplorerMetadata() {
  const [clients, properties] = await Promise.all([
    fetchReferenceOptions('clients'),
    fetchReferenceOptions('properties'),
  ])

  return {
    entities: getDataEntityDefinitions(),
    references: {
      clients,
      properties,
    },
  }
}
