'use client'

import { useEffect, useState } from 'react'
import { AppStateCard, AppStateInline } from '../components/AppStateCard'

type EmailSummary = { id: string; threadId: string; subject: string; from: string; date: string; snippet: string }
type EmailThread = { threadId: string; messages: { id: string; subject: string; from: string; date: string; snippet: string; body?: string }[] }

export default function InboxPage() {
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleEmail, setGoogleEmail] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const fetchEmails = async () => {
    if (!googleConnected) {
      setEmails([])
      return
    }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/inbox/threads?ts=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load emails')
      setEmails(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const fetchGoogleStatus = async () => {
    try {
      const res = await fetch('/api/google/status')
      const data = await res.json()
      setGoogleConnected(Boolean(data.connected))
      setGoogleEmail(data.email || null)
    } catch {
      setGoogleConnected(false)
      setGoogleEmail(null)
    }
  }

  const fetchThread = async (threadId: string) => {
    if (!googleConnected) {
      setSelectedThread(null)
      return
    }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/inbox/thread/${threadId}?ts=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load thread')
      const data = await res.json()
      setSelectedThread(data)
      const params = new URLSearchParams(window.location.search)
      params.set('selectedEmailThreadId', threadId)
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const sendReply = async () => {
    if (!googleConnected || !selectedThread || !replyBody.trim()) return
    setLoading(true); setError(null)
    try {
      const recipient = selectedThread.messages[0]?.from || ''
      const subject = selectedThread.messages[0]?.subject || 'Re: '
      const res = await fetch('/api/inbox/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: selectedThread.threadId, to: recipient, subject, body: replyBody.trim() })
      })
      if (!res.ok) throw new Error('Failed to send reply')
      setReplyBody('')
      fetchThread(selectedThread.threadId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGoogleStatus() }, [])
  useEffect(() => {
    if (googleConnected) {
      fetchEmails()
    } else {
      setEmails([])
      setSelectedThread(null)
      setReplyBody('')
    }
  }, [googleConnected])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('google_connected')
    const googleError = params.get('google_error')

    if (connected === 'true') {
      fetchGoogleStatus()
      fetchEmails()
      window.history.replaceState({}, document.title, window.location.pathname)
    } else if (googleError) {
      setError(googleError)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  useEffect(() => {
    const handleGoogleConnectionChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ connected: boolean; email?: string | null }>
      const connected = Boolean(customEvent.detail?.connected)
      setGoogleConnected(connected)
      setGoogleEmail(customEvent.detail?.email || null)
      if (!connected) {
        setEmails([])
        setSelectedThread(null)
        setReplyBody('')
      }
    }

    window.addEventListener('pepaos-google-connection-changed', handleGoogleConnectionChange as EventListener)
    return () =>
      window.removeEventListener('pepaos-google-connection-changed', handleGoogleConnectionChange as EventListener)
  }, [])

  const reconnectGoogle = async () => {
    const response = await fetch('/api/google/connect?redirectTo=/inbox')
    const data = await response.json()
    if (data.authUrl) {
      window.location.href = data.authUrl
    }
  }

  const disconnectGoogle = async () => {
    setDisconnecting(true)
    setError(null)
    try {
      const response = await fetch('/api/google/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Nepodařilo se odpojit Google účet')
      }

      setGoogleConnected(false)
      setGoogleEmail(null)
      setEmails([])
      setSelectedThread(null)
      setReplyBody('')
      window.dispatchEvent(
        new CustomEvent('pepaos-google-connection-changed', {
          detail: { connected: false, email: null },
        })
      )
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Nepodařilo se odpojit Google účet')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Inbox</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Přehled doručené pošty, detail vlákna a rychlá odpověď z jednoho místa.
        </p>
      </section>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{googleConnected ? 'Google účet připojen' : 'Google účet není připojen'}</p>
            {googleEmail ? <p className="text-sm text-slate-500 dark:text-slate-400">{googleEmail}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {googleConnected ? (
              <button
                onClick={disconnectGoogle}
                disabled={disconnecting}
                className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-900/60 dark:text-red-400"
              >
                {disconnecting ? 'Odpojuji…' : 'Odpojit Google'}
              </button>
            ) : null}
            <button onClick={reconnectGoogle} className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 dark:bg-sky-400">
              {googleConnected ? 'Znovu připojit Google' : 'Připojit Google'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Pro čtení e-mailů musí mít účet nově povolené oprávnění `gmail.readonly`.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Recent emails</h2>
            <button onClick={fetchEmails} disabled={!googleConnected} className="text-sm text-sky-600 disabled:opacity-50 dark:text-sky-400">Refresh</button>
          </div>
          {!googleConnected ? (
            <AppStateCard compact eyebrow="Google" title="Google účet není připojen." description="Po připojení se zde zobrazí doručená pošta a detail vláken." />
          ) : loading ? (
            <AppStateInline>Načítám poslední e-maily…</AppStateInline>
          ) : emails.length === 0 ? (
            <AppStateCard compact eyebrow="Inbox" title="Doručená pošta je prázdná." description="Jakmile najdeme dostupné zprávy, zobrazí se zde seznam vláken." />
          ) : (
            <ul className="space-y-2">
              {emails.map((email) => (
                <li key={email.id} className="cursor-pointer rounded-2xl border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/70" onClick={() => fetchThread(email.threadId)}>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{email.subject}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{email.from} · {new Date(email.date).toLocaleString()}</p>
                  <p className="text-xs text-slate-600 truncate dark:text-slate-400">{email.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          {!googleConnected ? (
            <AppStateCard eyebrow="Vlákna" title="Po připojení Google účtu se zde zobrazí vlákna i možnost odpovídat." description="Inbox zůstává po odpojení čistý a bez přístupu k e-mailovým operacím." />
          ) : selectedThread ? (
            <>
              <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Thread: {selectedThread.threadId}</h2>
              <div className="space-y-2 mb-4">
                {selectedThread.messages.map((msg) => (
                  <div key={msg.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{msg.subject}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{msg.from} · {new Date(msg.date).toLocaleString()}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{msg.body || msg.snippet}</p>
                  </div>
                ))}
              </div>
              <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" rows={4} placeholder="Type your reply..." />
              <button onClick={sendReply} disabled={!googleConnected} className="mt-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-sky-950 disabled:opacity-50 dark:bg-sky-400">Send Reply</button>
            </>
          ) : (
            <AppStateCard eyebrow="Vlákno" title="Vyber vlákno pro detail a odpověď." description="Po kliknutí na e-mail vlevo se zde zobrazí celé konverzační vlákno a rychlá odpověď." />
          )}
          {error ? <div className="mt-3"><AppStateCard tone="error" compact eyebrow="Chyba" title="Inbox narazil na problém." description={error} /></div> : null}
        </div>
      </div>
    </div>
  )
}
