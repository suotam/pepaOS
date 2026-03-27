'use client'

import { useEffect, useState } from 'react'

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
    <div>
      <h1 className="text-2xl font-bold mb-4">Inbox</h1>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">{googleConnected ? 'Google účet připojen' : 'Google účet není připojen'}</p>
            {googleEmail ? <p className="text-sm text-gray-500">{googleEmail}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {googleConnected ? (
              <button
                onClick={disconnectGoogle}
                disabled={disconnecting}
                className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
              >
                {disconnecting ? 'Odpojuji…' : 'Odpojit Google'}
              </button>
            ) : null}
            <button onClick={reconnectGoogle} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">
              {googleConnected ? 'Znovu připojit Google' : 'Připojit Google'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-gray-600">Pro čtení e-mailů musí mít účet nově povolené oprávnění `gmail.readonly`.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white rounded shadow p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent emails</h2>
            <button onClick={fetchEmails} disabled={!googleConnected} className="text-sm text-blue-600 disabled:opacity-50">Refresh</button>
          </div>
          {!googleConnected ? (
            <p>Google účet není připojen.</p>
          ) : loading ? (<p>Loading...</p>) : emails.length === 0 ? (<p>No emails found.</p>) : (
            <ul className="space-y-2">
              {emails.map((email) => (
                <li key={email.id} className="border rounded p-2 hover:bg-gray-50 cursor-pointer" onClick={() => fetchThread(email.threadId)}>
                  <p className="font-semibold text-sm">{email.subject}</p>
                  <p className="text-xs text-gray-500">{email.from} · {new Date(email.date).toLocaleString()}</p>
                  <p className="text-xs text-gray-600 truncate">{email.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded shadow p-4">
          {!googleConnected ? (
            <p>Po připojení Google účtu se zde zobrazí vlákna i možnost odpovídat.</p>
          ) : selectedThread ? (
            <>
              <h2 className="font-semibold mb-3">Thread: {selectedThread.threadId}</h2>
              <div className="space-y-2 mb-4">
                {selectedThread.messages.map((msg) => (
                  <div key={msg.id} className="border rounded p-2 bg-gray-50">
                    <p className="text-sm font-semibold">{msg.subject}</p>
                    <p className="text-xs text-gray-500">{msg.from} · {new Date(msg.date).toLocaleString()}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{msg.body || msg.snippet}</p>
                  </div>
                ))}
              </div>
              <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} className="w-full border-gray-300 rounded-md p-2" rows={4} placeholder="Type your reply..." />
              <button onClick={sendReply} disabled={!googleConnected} className="mt-2 bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">Send Reply</button>
            </>
          ) : (
            <p>Select a thread to view details and reply.</p>
          )}
          {error && <p className="text-red-500 mt-2 whitespace-pre-wrap">{error}</p>}
        </div>
      </div>
    </div>
  )
}
