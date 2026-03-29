'use client'

import { Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type CommandItem = {
  id: string
  label: string
  description: string
  href?: string
  keywords: string[]
  action?: () => void
}

export default function CommandBar() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const commands = useMemo<CommandItem[]>(
    () => [
      { id: 'dashboard', label: 'Přejít na Přehled', description: 'KPI, pipeline a poslední výstupy', href: '/dashboard', keywords: ['dashboard', 'prehled', 'kpi'] },
      { id: 'map', label: 'Otevřít mapu nemovitostí', description: 'Mapové zobrazení portfolia', href: '/properties/map', keywords: ['mapa', 'nemovitosti', 'map'] },
      { id: 'calendar', label: 'Otevřít kalendář', description: 'Dnešní agenda a plánování', href: '/calendar', keywords: ['kalendar', 'udalosti', 'agenda'] },
      { id: 'inbox', label: 'Otevřít e-maily', description: 'Inbox a vlákna zpráv', href: '/inbox', keywords: ['email', 'inbox', 'posta'] },
      { id: 'data', label: 'Otevřít datový explorer', description: 'Práce se záznamy v databázi', href: '/data', keywords: ['data', 'explorer', 'tabulky'] },
      { id: 'clients', label: 'Přejít na klienty', description: 'Datová sekce filtrovaná na klienty', href: '/data?entity=clients', keywords: ['klienti', 'clients', 'crm'] },
      { id: 'properties', label: 'Přejít na nemovitosti', description: 'Datová sekce filtrovaná na nemovitosti', href: '/data?entity=properties', keywords: ['nemovitosti', 'properties', 'portfolio'] },
      { id: 'leads', label: 'Přejít na leady', description: 'Datová sekce filtrovaná na leady', href: '/data?entity=leads', keywords: ['leady', 'leads', 'pipeline'] },
      { id: 'deals', label: 'Přejít na dealy', description: 'Datová sekce filtrovaná na dealy', href: '/data?entity=deals', keywords: ['dealy', 'deals', 'obchody'] },
      { id: 'workflows', label: 'Otevřít workflow', description: 'Automatizace, běhy a plánování', href: '/workflows', keywords: ['workflow', 'automatizace', 'cron'] },
      {
        id: 'assistant',
        label: 'Otevřít AI chat',
        description: 'Přesunout focus do asistenta',
        keywords: ['chat', 'assistant', 'ai', 'agent'],
        action: () => window.dispatchEvent(new CustomEvent('pepaos-focus-assistant')),
      },
    ],
    []
  )

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return commands

    return commands.filter((command) => {
      const haystack = [command.label, command.description, ...command.keywords].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [commands, query])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }

      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [pathname])

  const runCommand = (command: CommandItem) => {
    if (command.href) {
      router.push(command.href)
    }
    if (command.action) {
      command.action()
    }
    setOpen(false)
    setQuery('')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-4 py-24 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <Search size={18} className="text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Najít stránku nebo rychlou akci…"
            className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-3">
          <div className="mb-3 flex items-center justify-between px-2 text-xs uppercase tracking-[0.16em] text-slate-400">
            <span>Quick actions</span>
            <span>Ctrl/Cmd + K</span>
          </div>
          <div className="space-y-2">
            {filteredCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                onClick={() => runCommand(command)}
                className="flex w-full items-start justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-900"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{command.label}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{command.description}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {command.href ? 'Go' : 'Run'}
                </span>
              </button>
            ))}

            {filteredCommands.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Pro tento dotaz jsem nenašel žádnou akci.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
