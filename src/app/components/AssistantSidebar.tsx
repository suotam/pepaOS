'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

type BrowserSpeechRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onstart: null | (() => void)
  onend: null | (() => void)
  onerror: null | ((event: { error?: string }) => void)
  onresult: null | ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition
type VoiceInputMode = 'speech-recognition' | 'media-recorder' | 'none'

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
  const [isListening, setIsListening] = useState(false)
  const [voiceMode, setVoiceMode] = useState<VoiceInputMode>('none')
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])

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

  useEffect(() => {
    if (typeof window === 'undefined') return

    const speechApi = ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as
      | BrowserSpeechRecognitionCtor
      | undefined

    const supportsMediaRecorder =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'

    if (!speechApi) {
      setVoiceMode(supportsMediaRecorder ? 'media-recorder' : 'none')
      return
    }

    setVoiceMode('speech-recognition')

    const recognition = new speechApi()
    recognition.lang = 'cs-CZ'
    recognition.interimResults = true
    recognition.continuous = false

    recognition.onstart = () => {
      setIsListening(true)
      setError(null)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognition.onerror = (event) => {
      setIsListening(false)
      setError(event?.error === 'not-allowed' ? 'Pro hlasové ovládání je potřeba povolit mikrofon.' : 'Hlasové ovládání se nepodařilo spustit.')
    }

    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript || ''
      }
      setInput(transcript.trim())
    }

    recognitionRef.current = recognition

    return () => {
      recognition.stop()
      recognitionRef.current = null
      mediaRecorderRef.current?.stop()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current = null
    }
  }, [])

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

  const toggleVoiceInput = () => {
    if (voiceMode === 'media-recorder') {
      void toggleRecordedVoiceInput()
      return
    }

    const recognition = recognitionRef.current
    if (!recognition) {
      setError('Tento prohlížeč nepodporuje hlasové ovládání chatu.')
      return
    }

    if (isListening) {
      recognition.stop()
      return
    }

    recognition.start()
  }

  const transcribeRecordedAudio = async (audioBlob: Blob) => {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'voice-input.webm')

    const response = await fetch('/api/chat/transcribe', {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Přepis hlasu se nepodařil.')
    }

    setInput((current) => [current, data.text].filter(Boolean).join(current ? ' ' : '').trim())
  }

  const toggleRecordedVoiceInput = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tento prohlížeč nepodporuje hlasové ovládání chatu.')
      return
    }

    if (isListening) {
      mediaRecorderRef.current?.stop()
      return
    }

    try {
      setError(null)
      recordedChunksRef.current = []
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.onstart = () => {
        setIsListening(true)
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setError('Nahrávání hlasu se nepodařilo spustit.')
        setIsListening(false)
      }

      recorder.onstop = async () => {
        setIsListening(false)
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null

        const audioBlob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        recordedChunksRef.current = []
        if (audioBlob.size === 0) return

        try {
          await transcribeRecordedAudio(audioBlob)
        } catch (transcriptionError) {
          setError(transcriptionError instanceof Error ? transcriptionError.message : 'Přepis hlasu selhal.')
        }
      }

      recorder.start()
    } catch (recordError) {
      setIsListening(false)
      setError(recordError instanceof Error && recordError.message ? recordError.message : 'Pro hlasové ovládání je potřeba povolit mikrofon.')
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
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-blue-600 text-white px-3 py-1 rounded-md disabled:opacity-50"
            >
              {loading ? 'Processing…' : 'Send'}
            </button>
            <button
              onClick={toggleVoiceInput}
              disabled={voiceMode === 'none' || loading}
              className={`px-3 py-1 rounded-md border text-sm ${isListening ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 bg-white text-gray-700'} disabled:opacity-50`}
            >
              {isListening ? 'Stop mic' : 'Mic'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </aside>
  )
}
