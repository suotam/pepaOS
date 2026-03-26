'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import Supercluster from 'supercluster'
import type { MapProperty, PropertyMapFilters } from '../../../lib/property-map'

type PropertyMapResponse = {
  properties: MapProperty[]
  totalMatching: number
  visibleCount: number
  filterOptions: {
    cities: string[]
    localities: string[]
    propertyTypes: string[]
    statuses: string[]
  }
}

type LocalFilters = {
  city: string
  locality: string
  propertyType: string
  status: string
  missingReconstruction: boolean
  maxPrice: string
}

type ViewBounds = {
  north: number
  south: number
  east: number
  west: number
}

type ClusterPointProperties = {
  cluster: boolean
  propertyId?: string
  property?: MapProperty
}

const DEFAULT_CENTER: [number, number] = [49.8175, 15.473]
const DEFAULT_ZOOM = 7
const DEFAULT_FILTERS: LocalFilters = {
  city: '',
  locality: '',
  propertyType: '',
  status: '',
  missingReconstruction: false,
  maxPrice: '',
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(5))
}

function normalizeBounds(bounds: ViewBounds): ViewBounds {
  return {
    north: roundCoordinate(bounds.north),
    south: roundCoordinate(bounds.south),
    east: roundCoordinate(bounds.east),
    west: roundCoordinate(bounds.west),
  }
}

function areBoundsEqual(left: ViewBounds | null, right: ViewBounds | null) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.north === right.north &&
    left.south === right.south &&
    left.east === right.east &&
    left.west === right.west
  )
}

function formatPrice(price: number | null) {
  if (price == null) return 'Neuvedeno'
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(price)
}

function normalizeChatFilters(filters?: Partial<PropertyMapFilters>) {
  if (!filters) return DEFAULT_FILTERS

  return {
    city: filters.city || '',
    locality: filters.locality || '',
    propertyType: filters.propertyType || '',
    status: filters.status || '',
    missingReconstruction: Boolean(filters.missingReconstruction),
    maxPrice: typeof filters.maxPrice === 'number' ? String(filters.maxPrice) : '',
  }
}

function readInitialUrlState() {
  if (typeof window === 'undefined') {
    return { filters: DEFAULT_FILTERS, selectedPropertyId: null as string | null, bounds: null as ViewBounds | null }
  }

  const params = new URLSearchParams(window.location.search)

  const readNumber = (key: string) => {
    const value = params.get(key)
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const north = readNumber('north')
  const south = readNumber('south')
  const east = readNumber('east')
  const west = readNumber('west')

  return {
    filters: {
      city: params.get('city') || '',
      locality: params.get('locality') || '',
      propertyType: params.get('propertyType') || '',
      status: params.get('status') || '',
      missingReconstruction: params.get('missingReconstruction') === 'true',
      maxPrice: params.get('maxPrice') || '',
    },
    selectedPropertyId: params.get('selectedPropertyId'),
    bounds: [north, south, east, west].every((value) => value != null)
      ? { north: north!, south: south!, east: east!, west: west! }
      : null,
  }
}

function PropertyMarkerIcon({ selected, count }: { selected: boolean; count?: number }) {
  const size = count ? 42 : selected ? 24 : 18
  const background = count ? '#1d4ed8' : selected ? '#dc2626' : '#0f766e'
  const content = count ? String(count) : ''

  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${background};border:3px solid white;box-shadow:0 8px 18px rgba(15,23,42,.18);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;">${content}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function MapViewportWatcher({
  onViewportChange,
}: {
  onViewportChange: (nextBounds: ViewBounds, zoom: number) => void
}) {
  const map = useMapEvents({
    moveend() {
      const bounds = map.getBounds()
      onViewportChange(
        {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
        map.getZoom()
      )
    },
    zoomend() {
      const bounds = map.getBounds()
      onViewportChange(
        {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
        map.getZoom()
      )
    },
  })

  useEffect(() => {
    const bounds = map.getBounds()
    onViewportChange(
      {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      },
      map.getZoom()
    )
  }, [map, onViewportChange])

  return null
}

function MapSelectionController({ property }: { property: MapProperty | null }) {
  const map = useMap()
  const lastCenteredPropertyId = useRef<string | null>(null)

  useEffect(() => {
    if (!property?.latitude || !property?.longitude) return
    if (lastCenteredPropertyId.current === property.id) return

    lastCenteredPropertyId.current = property.id
    map.flyTo([property.latitude, property.longitude], Math.max(map.getZoom(), 13), { duration: 0.7 })
  }, [map, property?.id, property?.latitude, property?.longitude])

  return null
}

function MapResetController({ resetKey }: { resetKey: number }) {
  const map = useMap()
  const lastResetKey = useRef(resetKey)

  useEffect(() => {
    if (lastResetKey.current === resetKey) return
    lastResetKey.current = resetKey
    map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.7 })
  }, [map, resetKey])

  return null
}

function buildQueryString(filters: LocalFilters, bounds: ViewBounds | null, selectedPropertyId: string | null) {
  const params = new URLSearchParams()

  if (filters.city) params.set('city', filters.city)
  if (filters.locality) params.set('locality', filters.locality)
  if (filters.propertyType) params.set('propertyType', filters.propertyType)
  if (filters.status) params.set('status', filters.status)
  if (filters.missingReconstruction) params.set('missingReconstruction', 'true')
  if (filters.maxPrice) params.set('maxPrice', filters.maxPrice)
  if (selectedPropertyId) params.set('selectedPropertyId', selectedPropertyId)
  if (bounds) {
    params.set('north', bounds.north.toFixed(5))
    params.set('south', bounds.south.toFixed(5))
    params.set('east', bounds.east.toFixed(5))
    params.set('west', bounds.west.toFixed(5))
  }

  return params.toString()
}

function buildApiQueryString(filters: LocalFilters, bounds: ViewBounds | null) {
  return buildQueryString(filters, null, null)
}

function PropertyListItem({
  property,
  selected,
  onSelect,
}: {
  property: MapProperty
  selected: boolean
  onSelect: (property: MapProperty) => void
}) {
  return (
    <button
      onClick={() => onSelect(property)}
      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
        selected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{property.title}</div>
          <div className="mt-1 text-xs text-gray-500">
            {property.address}, {property.locality}, {property.city}
          </div>
        </div>
        <div className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium uppercase text-slate-700">
          {property.status || 'n/a'}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
        <span>{property.property_type || 'typ neuveden'}</span>
        <span className="font-semibold text-gray-900">{formatPrice(property.asking_price)}</span>
      </div>
    </button>
  )
}

function ClusterMarkers({
  features,
  clusterIndex,
  selectedPropertyId,
  onSelectProperty,
}: {
  features: any[]
  clusterIndex: Supercluster<ClusterPointProperties>
  selectedPropertyId: string | null
  onSelectProperty: (propertyId: string) => void
}) {
  const map = useMap()

  return (
    <>
      {features.map((feature) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const isCluster = Boolean((feature.properties as any).cluster)

        if (isCluster) {
          const pointCount = (feature.properties as any).point_count as number
          return (
            <Marker
              key={`cluster-${feature.id}`}
              position={[latitude, longitude]}
              icon={PropertyMarkerIcon({ selected: false, count: pointCount })}
              eventHandlers={{
                click: () => {
                  const expansionZoom = Math.min(clusterIndex.getClusterExpansionZoom(feature.id as number), 16)
                  map.flyTo([latitude, longitude], expansionZoom, { duration: 0.6 })
                },
              }}
            />
          )
        }

        const property = (feature.properties as ClusterPointProperties).property
        if (!property) return null

        return (
          <Marker
            key={property.id}
            position={[latitude, longitude]}
            icon={PropertyMarkerIcon({ selected: property.id === selectedPropertyId })}
            eventHandlers={{
              click: () => onSelectProperty(property.id),
            }}
          >
            <Popup>
              <div className="min-w-[220px]">
                <div className="text-sm font-semibold text-gray-900">{property.title}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {property.address}, {property.city}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-gray-700">
                  <span>{property.property_type}</span>
                  <span className="font-semibold text-gray-900">{formatPrice(property.asking_price)}</span>
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}

export default function PropertyMapClient() {
  const initialState = useMemo(() => readInitialUrlState(), [])
  const [filters, setFilters] = useState<LocalFilters>(initialState.filters)
  const [bounds, setBounds] = useState<ViewBounds | null>(initialState.bounds)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [properties, setProperties] = useState<MapProperty[]>([])
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(initialState.selectedPropertyId)
  const [selectedProperty, setSelectedProperty] = useState<MapProperty | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(0)
  const [totalMatching, setTotalMatching] = useState(0)
  const [filterOptions, setFilterOptions] = useState<PropertyMapResponse['filterOptions']>({
    cities: [],
    localities: [],
    propertyTypes: [],
    statuses: [],
  })
  const [resetKey, setResetKey] = useState(0)
  const lastUrlRef = useRef<string>('')

  const handleViewportChange = useCallback((nextBounds: ViewBounds, nextZoom: number) => {
    const normalizedBounds = normalizeBounds(nextBounds)

    setBounds((currentBounds) => (areBoundsEqual(currentBounds, normalizedBounds) ? currentBounds : normalizedBounds))
    setZoom((currentZoom) => (currentZoom === nextZoom ? currentZoom : nextZoom))
  }, [])

  useEffect(() => {
    const query = buildQueryString(filters, bounds, selectedPropertyId)
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname

    if (lastUrlRef.current === nextUrl || `${window.location.pathname}${window.location.search}` === nextUrl) {
      return
    }

    window.history.replaceState({}, '', nextUrl)
    lastUrlRef.current = nextUrl
  }, [filters, bounds, selectedPropertyId])

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      setLoading(true)
      setError(null)

      try {
        const query = buildApiQueryString(filters, bounds)
        const response = await fetch(`/api/properties/map${query ? `?${query}` : ''}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Property map API returned ${response.status}`)
        }

        const data: PropertyMapResponse = await response.json()
        setProperties(data.properties)
        setVisibleCount(data.visibleCount)
        setTotalMatching(data.totalMatching)
        setFilterOptions(data.filterOptions)

        const nextSelected = data.properties.find((property) => property.id === selectedPropertyId) || null

        setSelectedProperty(nextSelected)
        if (selectedPropertyId && !nextSelected) {
          setSelectedPropertyId(null)
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Nepodarilo se nacist mapu nemovitosti')
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [filters, bounds])

  useEffect(() => {
    function onMapCommand(event: Event) {
      const customEvent = event as CustomEvent<{
        filters?: Partial<PropertyMapFilters>
        selectedPropertyId?: string | null
      }>

      if (customEvent.detail.filters) {
        setFilters(normalizeChatFilters(customEvent.detail.filters))
      }

      if (typeof customEvent.detail.selectedPropertyId !== 'undefined') {
        setSelectedPropertyId(customEvent.detail.selectedPropertyId)
      }
    }

    window.addEventListener('pepaos-map-command', onMapCommand)
    return () => window.removeEventListener('pepaos-map-command', onMapCommand)
  }, [])

  useEffect(() => {
    const nextProperty = properties.find((property) => property.id === selectedPropertyId) || null
    setSelectedProperty(nextProperty)
  }, [properties, selectedPropertyId])

  const points = useMemo(
    () =>
      properties
        .filter((property) => property.latitude != null && property.longitude != null)
        .map((property) => ({
          type: 'Feature' as const,
          properties: {
            cluster: false,
            propertyId: property.id,
            property,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [property.longitude as number, property.latitude as number],
          },
        })),
    [properties]
  )

  const clusterIndex = useMemo(() => {
    const index = new Supercluster<ClusterPointProperties>({ radius: 55, maxZoom: 16 })
    index.load(points)
    return index
  }, [points])

  const clusterFeatures = useMemo(() => {
    if (!bounds) return []
    return clusterIndex.getClusters([bounds.west, bounds.south, bounds.east, bounds.north], Math.round(zoom))
  }, [bounds, clusterIndex, zoom])

  return (
    <div className="h-[calc(100vh-2rem)] min-h-[720px] overflow-hidden rounded-2xl border border-gray-200 bg-slate-100">
      <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-4">
            <h1 className="text-lg font-semibold text-gray-900">Mapa nemovitostí</h1>
            <p className="mt-1 text-sm text-gray-500">Operativní pohled na portfolio v Česku</p>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span>Viditelné na mapě</span>
              <span className="font-semibold">{visibleCount} / {totalMatching}</span>
            </div>
          </div>

          <div className="border-b border-gray-200 px-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600">
                Město
                <select
                  value={filters.city}
                  onChange={(event) => setFilters((prev) => ({ ...prev, city: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">Všechna</option>
                  {filterOptions.cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-gray-600">
                Lokalita
                <select
                  value={filters.locality}
                  onChange={(event) => setFilters((prev) => ({ ...prev, locality: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">Všechny</option>
                  {filterOptions.localities.map((locality) => (
                    <option key={locality} value={locality}>
                      {locality}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-gray-600">
                Typ
                <select
                  value={filters.propertyType}
                  onChange={(event) => setFilters((prev) => ({ ...prev, propertyType: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">Všechny</option>
                  {filterOptions.propertyTypes.map((propertyType) => (
                    <option key={propertyType} value={propertyType}>
                      {propertyType}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-gray-600">
                Stav
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">Všechny</option>
                  {filterOptions.statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-2 text-xs font-medium text-gray-600">
                Max. cena (CZK)
                <input
                  value={filters.maxPrice}
                  onChange={(event) => setFilters((prev) => ({ ...prev, maxPrice: event.target.value }))}
                  placeholder="Např. 12000000"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
              </label>

              <label className="col-span-2 flex items-center gap-2 rounded-md border border-gray-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={filters.missingReconstruction}
                  onChange={(event) => setFilters((prev) => ({ ...prev, missingReconstruction: event.target.checked }))}
                />
                Jen nemovitosti s chybějícími daty o rekonstrukci
              </label>
            </div>

            <button
              onClick={() => {
                setFilters(DEFAULT_FILTERS)
                setBounds(null)
                setSelectedPropertyId(null)
                setResetKey((value) => value + 1)
              }}
              className="mt-3 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Resetovat filtry i mapu
            </button>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable]"
            onWheelCapture={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            {loading ? <div className="text-sm text-gray-500">Načítám nemovitosti…</div> : null}
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

            <div className="space-y-3">
              {properties.map((property) => (
                <PropertyListItem
                  key={property.id}
                  property={property}
                  selected={property.id === selectedPropertyId}
                  onSelect={(nextProperty) => setSelectedPropertyId(nextProperty.id)}
                />
              ))}
            </div>

            {!loading && properties.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
                Pro zadané filtry ani aktuální výřez mapy jsme nenašli žádné nemovitosti.
              </div>
            ) : null}
          </div>

          {selectedProperty ? (
            <div className="border-t border-gray-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-gray-900">{selectedProperty.title}</div>
              <div className="mt-1 text-sm text-gray-600">
                {selectedProperty.address}, {selectedProperty.locality}, {selectedProperty.city}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-700">
                <div className="rounded-md bg-white px-3 py-2">
                  <div className="text-slate-500">Typ</div>
                  <div className="font-medium text-slate-900">{selectedProperty.property_type || 'Neuvedeno'}</div>
                </div>
                <div className="rounded-md bg-white px-3 py-2">
                  <div className="text-slate-500">Cena</div>
                  <div className="font-medium text-slate-900">{formatPrice(selectedProperty.asking_price)}</div>
                </div>
                <div className="rounded-md bg-white px-3 py-2">
                  <div className="text-slate-500">Stav</div>
                  <div className="font-medium text-slate-900">{selectedProperty.status || 'Neuvedeno'}</div>
                </div>
                <div className="rounded-md bg-white px-3 py-2">
                  <div className="text-slate-500">Rekonstrukce</div>
                  <div className="font-medium text-slate-900">{selectedProperty.reconstruction_status || 'Chybí data'}</div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="relative h-full">
          <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full" zoomControl>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapViewportWatcher
              onViewportChange={handleViewportChange}
            />
            <MapResetController resetKey={resetKey} />
            <MapSelectionController property={selectedProperty} />

            <ClusterMarkers
              features={clusterFeatures}
              clusterIndex={clusterIndex}
              selectedPropertyId={selectedPropertyId}
              onSelectProperty={setSelectedPropertyId}
            />
          </MapContainer>

          <div className="pointer-events-none absolute left-4 top-4 rounded-lg bg-white/95 px-4 py-3 shadow-lg">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI kontext mapy</div>
            <div className="mt-1 text-sm text-slate-700">Stránka posílá do sidebaru aktivní filtry, výřez i vybranou nemovitost.</div>
          </div>
        </section>
      </div>
    </div>
  )
}
