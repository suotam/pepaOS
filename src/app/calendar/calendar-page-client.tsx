'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type CalendarEvent = {
  id: string
  summary: string
  description?: string
  start: string
  end: string
  htmlLink?: string
}

type ViewMode = 'day' | 'week' | 'month'

function formatDateInput(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTimezoneOffsetSuffix(date: Date) {
  const totalMinutes = -date.getTimezoneOffset()
  const sign = totalMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(totalMinutes)
  const hours = `${Math.floor(absoluteMinutes / 60)}`.padStart(2, '0')
  const minutes = `${absoluteMinutes % 60}`.padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

function toCalendarIsoString(localDateTime: string) {
  const date = new Date(localDateTime)
  return `${localDateTime}:00${getTimezoneOffsetSuffix(date)}`
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function startOfWeek(date: Date) {
  const next = startOfDay(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  return next
}

function endOfWeek(date: Date) {
  const next = startOfWeek(date)
  next.setDate(next.getDate() + 6)
  return endOfDay(next)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatTimeRange(event: CalendarEvent) {
  return `${new Date(event.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })} - ${new Date(event.end).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`
}

function formatDateLabel(date: Date, viewMode: ViewMode) {
  if (viewMode === 'month') {
    return date.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
  }

  return date.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(formatDateInput(new Date()))
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleEmail, setGoogleEmail] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [attendees, setAttendees] = useState('')
  const [startTime, setStartTime] = useState(`${formatDateInput(new Date())}T09:00`)
  const [endTime, setEndTime] = useState(`${formatDateInput(new Date())}T10:00`)

  const selectedDateObject = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate])

  useEffect(() => {
    setStartTime((current) => {
      if (current.startsWith(selectedDate)) return current
      return `${selectedDate}T09:00`
    })
    setEndTime((current) => {
      if (current.startsWith(selectedDate)) return current
      return `${selectedDate}T10:00`
    })
  }, [selectedDate])

  const visibleRange = useMemo(() => {
    if (viewMode === 'day') {
      return { start: startOfDay(selectedDateObject), end: endOfDay(selectedDateObject) }
    }
    if (viewMode === 'week') {
      return { start: startOfWeek(selectedDateObject), end: endOfWeek(selectedDateObject) }
    }
    return { start: startOfMonth(selectedDateObject), end: endOfMonth(selectedDateObject) }
  }, [selectedDateObject, viewMode])

  const fetchGoogleStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/google/status', { cache: 'no-store' })
      const data = await response.json()
      const connected = Boolean(data.connected)
      setGoogleConnected(connected)
      setGoogleEmail(data.email || null)
      if (!connected) {
        setEvents([])
      }
    } catch {
      setGoogleConnected(false)
      setGoogleEmail(null)
      setEvents([])
    }
  }, [])

  const fetchEvents = useCallback(async () => {
    if (!googleConnected) {
      setEvents([])
      return
    }
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/calendar/events?start=${encodeURIComponent(visibleRange.start.toISOString())}&end=${encodeURIComponent(visibleRange.end.toISOString())}`
      )

      if (!response.ok) {
        throw new Error('Nepodařilo se načíst události kalendáře')
      }

      const data = await response.json()
      setEvents(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba při načítání kalendáře')
    } finally {
      setLoading(false)
    }
  }, [googleConnected, visibleRange.end, visibleRange.start])

  useEffect(() => {
    fetchGoogleStatus()
  }, [fetchGoogleStatus])

  useEffect(() => {
    if (googleConnected) {
      fetchEvents()
    } else {
      setEvents([])
    }
  }, [fetchEvents, googleConnected])

  useEffect(() => {
    const handleGoogleConnectionChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ connected: boolean; email?: string | null }>
      const connected = Boolean(customEvent.detail?.connected)
      setGoogleConnected(connected)
      setGoogleEmail(customEvent.detail?.email || null)
      if (!connected) {
        setEvents([])
        setError(null)
      }
    }

    window.addEventListener('pepaos-google-connection-changed', handleGoogleConnectionChange as EventListener)
    return () =>
      window.removeEventListener('pepaos-google-connection-changed', handleGoogleConnectionChange as EventListener)
  }, [])

  const todaysEvents = useMemo(() => {
    const today = new Date()
    return events
      .filter((event) => sameDay(new Date(event.start), today))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  }, [events])

  const daysInView = useMemo(() => {
    if (viewMode === 'day') {
      return [selectedDateObject]
    }
    if (viewMode === 'week') {
      return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(selectedDateObject), index))
    }

    const monthStart = startOfMonth(selectedDateObject)
    const monthGridStart = startOfWeek(monthStart)
    return Array.from({ length: 35 }, (_, index) => addDays(monthGridStart, index))
  }, [selectedDateObject, viewMode])

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>()
    events.forEach((event) => {
      const key = formatDateInput(new Date(event.start))
      const bucket = grouped.get(key) || []
      bucket.push(event)
      grouped.set(key, bucket)
    })
    grouped.forEach((bucket) => bucket.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()))
    return grouped
  }, [events])

  const createEvent = async () => {
    if (!googleConnected || !title.trim()) return

    setLoading(true)
    setError(null)

    try {
      const attendeeEmails = attendees
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)

      const response = await fetch('/api/calendar/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: title,
          description,
          start: toCalendarIsoString(startTime),
          end: toCalendarIsoString(endTime),
          attendeeEmails,
        }),
      })

      if (!response.ok) {
        throw new Error('Nepodařilo se vytvořit událost')
      }

      setTitle('')
      setDescription('')
      setAttendees('')
      await fetchEvents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba při vytváření události')
    } finally {
      setLoading(false)
    }
  }

  const deleteEvent = async (eventId: string) => {
    if (!googleConnected) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/calendar/event', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      })

      if (!response.ok) {
        throw new Error('Nepodařilo se smazat událost')
      }

      await fetchEvents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba při mazání události')
    } finally {
      setLoading(false)
    }
  }

  const shiftPeriod = (direction: -1 | 1) => {
    const next = new Date(selectedDateObject)
    if (viewMode === 'day') next.setDate(next.getDate() + direction)
    if (viewMode === 'week') next.setDate(next.getDate() + direction * 7)
    if (viewMode === 'month') next.setMonth(next.getMonth() + direction)
    setSelectedDate(formatDateInput(next))
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Kalendář</h1>
            <p className="mt-1 text-sm text-gray-500">Denní agenda, týdenní rozvrh a ruční správa událostí.</p>
            <p className="mt-2 text-xs text-gray-500">
              {googleConnected ? `Google účet připojen${googleEmail ? `: ${googleEmail}` : ''}` : 'Google účet není připojen.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  viewMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {mode === 'day' ? 'Den' : mode === 'week' ? 'Týden' : 'Měsíc'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 xl:flex-row">
          <div className="xl:w-[360px]">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <button onClick={() => shiftPeriod(-1)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
                  Předchozí
                </button>
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{viewMode === 'day' ? 'Vybraný den' : 'Aktivní období'}</div>
                  <div className="font-medium text-gray-900">{formatDateLabel(selectedDateObject, viewMode)}</div>
                </div>
                <button onClick={() => shiftPeriod(1)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
                  Další
                </button>
              </div>

              <label className="mt-4 block text-sm font-medium text-gray-700">
                Datum
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>

              <div className="mt-5">
                <h2 className="text-sm font-semibold text-gray-900">Dnešní agenda</h2>
                <div className="mt-3 space-y-2">
                  {todaysEvents.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500">
                      Dnes zatím žádné události.
                    </div>
                  ) : (
                    todaysEvents.map((event) => (
                      <div key={event.id} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="text-sm font-medium text-gray-900">{event.summary}</div>
                        <div className="mt-1 text-xs text-gray-500">{formatTimeRange(event)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Přidat událost</h2>
              <div className="mt-4 space-y-3">
                <label className="block text-sm text-gray-700">
                  Název
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Začátek
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Konec
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Účastníci
                  <input
                    value={attendees}
                    onChange={(event) => setAttendees(event.target.value)}
                    placeholder="alice@firma.cz, bob@firma.cz"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Popis
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
                <button
                  onClick={createEvent}
                  disabled={loading || !googleConnected || !title.trim()}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {loading ? 'Ukládám…' : 'Vytvořit událost'}
                </button>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {viewMode === 'day' ? 'Přehled dne' : viewMode === 'week' ? 'Týdenní rozvrh' : 'Měsíční rozvrh'}
                </h2>
                {loading ? <span className="text-sm text-gray-500">Načítám…</span> : null}
              </div>

              {error ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
              ) : null}

              {!googleConnected ? (
                <div className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
                  Po připojení Google účtu se zde zobrazí události kalendáře a půjde vytvářet i mazat události.
                </div>
              ) : null}

              {googleConnected && viewMode === 'month' ? (
                <div className="grid grid-cols-7 gap-3">
                  {daysInView.map((date) => {
                    const key = formatDateInput(date)
                    const dayEvents = eventsByDay.get(key) || []
                    const inCurrentMonth = date.getMonth() === selectedDateObject.getMonth()
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setSelectedDate(key)
                          setViewMode('day')
                        }}
                        className={`min-h-[132px] rounded-xl border p-3 text-left ${
                          inCurrentMonth ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 text-gray-400'
                        }`}
                      >
                        <div className="text-sm font-semibold">{date.getDate()}</div>
                        <div className="mt-2 space-y-2">
                          {dayEvents.slice(0, 3).map((event) => (
                            <div key={event.id} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-900">
                              <div className="font-medium">{event.summary}</div>
                              <div>{new Date(event.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</div>
                            </div>
                          ))}
                          {dayEvents.length > 3 ? <div className="text-xs text-gray-500">+ {dayEvents.length - 3} dalších</div> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : googleConnected ? (
                <div className={`grid gap-4 ${viewMode === 'day' ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-7'}`}>
                  {daysInView.map((date) => {
                    const key = formatDateInput(date)
                    const dayEvents = eventsByDay.get(key) || []
                    return (
                      <div key={key} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="flex items-center justify-between">
                          <button onClick={() => setSelectedDate(key)} className="text-left">
                            <div className="text-xs uppercase tracking-wide text-gray-500">
                              {date.toLocaleDateString('cs-CZ', { weekday: 'short' })}
                            </div>
                            <div className="font-semibold text-gray-900">
                              {date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' })}
                            </div>
                          </button>
                          {sameDay(date, new Date()) ? (
                            <span className="rounded-full bg-green-100 px-2 py-1 text-[11px] font-medium text-green-800">Dnes</span>
                          ) : null}
                        </div>

                        <div className="mt-3 space-y-3">
                          {dayEvents.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500">
                              Bez událostí
                            </div>
                          ) : (
                            dayEvents.map((event) => (
                              <div key={event.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="font-medium text-gray-900">{event.summary}</div>
                                    <div className="mt-1 text-xs text-gray-500">{formatTimeRange(event)}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {event.htmlLink ? (
                                      <a
                                        href={event.htmlLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-medium text-blue-600"
                                      >
                                        Otevřít
                                      </a>
                                    ) : null}
                                    <button onClick={() => deleteEvent(event.id)} className="text-xs font-medium text-red-600">
                                      Smazat
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
