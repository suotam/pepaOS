'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, CartesianGrid, XAxis, YAxis, Legend, BarChart, Bar, LineChart, Line } from 'recharts'

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  chart?: ChatChart | null
}

interface ChatMapAction {
  filters?: {
    city?: string
    locality?: string
    propertyType?: string
    status?: string
    missingReconstruction?: boolean
    maxPrice?: number
  }
  selectedPropertyId?: string | null
}

interface ChatDataAction {
  entity?: 'clients' | 'properties' | 'leads' | 'deals'
  query?: string
  selectedRecordId?: string | null
  refresh?: boolean
}

interface ChartPoint {
  [key: string]: string | number
}

interface ChatChart {
  type: 'pie' | 'bar' | 'line'
  data: ChartPoint[]
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

function ChartCard({ chart }: { chart: ChatChart }) {
  if (!chart.data.length) {
    return null
  }

  const firstRow = chart.data[0]
  const categoryKey = Object.keys(firstRow).find((key) => key !== 'count' && key !== 'value') || 'name'
  const valueKeys = Object.keys(firstRow).filter((key) => key !== categoryKey)

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-white p-3">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'pie' ? (
            <PieChart>
              <Pie
                data={chart.data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                outerRadius={72}
                dataKey="value"
              >
                {chart.data.map((_, index) => (
                  <Cell key={`pie-slice-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          ) : chart.type === 'bar' ? (
            <BarChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={categoryKey} />
              <YAxis />
              <Tooltip />
              <Legend />
              {valueKeys.map((key, index) => (
                <Bar key={key} dataKey={key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={categoryKey} />
              <YAxis />
              <Tooltip />
              <Legend />
              {valueKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function AssistantSidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([]) 
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pageContext = useMemo(() => {
    const context: any = { pageType: 'dashboard' }
    if (pathname.startsWith('/calendar')) context.pageType = 'calendar'
    else if (pathname.startsWith('/inbox')) context.pageType = 'inbox'
    else if (pathname.startsWith('/properties/map')) context.pageType = 'map'
    else if (pathname.startsWith('/data')) context.pageType = 'data'
    else if (pathname.startsWith('/clients')) context.pageType = 'clients'
    else if (pathname.startsWith('/properties')) context.pageType = 'properties'
    else if (pathname.startsWith('/workflows')) context.pageType = 'workflows'
    else if (pathname.startsWith('/outputs')) context.pageType = 'outputs'
    else if (pathname.startsWith('/agent')) context.pageType = 'agent'

    // Add selected context from URL if any query params exist
    if (searchParams) {
      const selectedDate = searchParams.get('selectedDate')
      const selectedEventId = searchParams.get('selectedEventId')
      const selectedEmailThreadId = searchParams.get('selectedEmailThreadId')
      const selectedClientId = searchParams.get('selectedClientId')
      const selectedRecordId = searchParams.get('selectedRecordId')
      const entity = searchParams.get('entity')
      const selectedPropertyId = searchParams.get('selectedPropertyId')
      const city = searchParams.get('city')
      const locality = searchParams.get('locality')
      const propertyType = searchParams.get('propertyType')
      const status = searchParams.get('status')
      const missingReconstruction = searchParams.get('missingReconstruction')
      const maxPrice = searchParams.get('maxPrice')
      const north = searchParams.get('north')
      const south = searchParams.get('south')
      const east = searchParams.get('east')
      const west = searchParams.get('west')
      if (selectedDate) context.selectedDate = selectedDate
      if (selectedEventId) context.selectedEventId = selectedEventId
      if (selectedEmailThreadId) context.selectedEmailThreadId = selectedEmailThreadId
      if (selectedClientId) context.selectedClientId = selectedClientId
      if (selectedRecordId) context.selectedRecordId = selectedRecordId
      if (entity) context.selectedEntity = entity
      if (selectedPropertyId) context.selectedPropertyId = selectedPropertyId
      if (city || locality || propertyType || status || missingReconstruction || maxPrice) {
        context.activeFilters = {
          city,
          locality,
          propertyType,
          status,
          missingReconstruction,
          maxPrice,
        }
      }
      if (north && south && east && west) {
        context.visibleBounds = { north, south, east, west }
      }
    }

    return context
  }, [pathname, searchParams])

  useEffect(() => {
    const saved = localStorage.getItem('pepaos-assistant-messages')
    if (saved) setMessages(JSON.parse(saved))
  }, [])

  useEffect(() => {
    localStorage.setItem('pepaos-assistant-messages', JSON.stringify(messages))
  }, [messages])

  const handleSend = async () => {
    if (!input.trim()) return
    setError(null)
    const userMsg = { role: 'user' as const, content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: input.trim(),
          context: pageContext,
          messages: newMessages,
        }),
      })

      if (!response.ok) {
        throw new Error(`Chat API error ${response.status}`)
      }

      const data = await response.json()
      const assistantText = data.response || 'No response.'
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText, chart: data.chart || null }])

      if (data.mapAction && pageContext.pageType === 'map') {
        window.dispatchEvent(new CustomEvent<ChatMapAction>('pepaos-map-command', { detail: data.mapAction }))
      }

      if (data.dataAction && pageContext.pageType === 'data') {
        window.dispatchEvent(new CustomEvent<ChatDataAction>('pepaos-data-command', { detail: data.dataAction }))
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside className="w-[360px] h-screen border-l border-gray-200 bg-white flex flex-col">
      <header className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold">AI Assistant</h2>
        <p className="text-xs text-gray-500">Context: {pageContext.pageType}</p>
      </header>
      <main className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <div className="text-xs text-gray-500">Ask me anything about operations, calendar, email, or clients.</div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`rounded-md p-2 ${msg.role === 'user' ? 'bg-blue-50 text-blue-900' : msg.role === 'assistant' ? 'bg-gray-100 text-gray-900' : 'bg-green-50 text-green-900'}`}>
              <div className="text-xs font-bold uppercase">{msg.role}</div>
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              {msg.chart && <ChartCard chart={msg.chart} />}
            </div>
          ))
        )}
      </main>
      <div className="border-t border-gray-200 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          className="w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
          placeholder="Type a command or question..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-blue-600 text-white px-3 py-1 rounded-md disabled:opacity-50"
          >
            {loading ? 'Processing…' : 'Send'}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </aside>
  )
}
