'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import ThemeToggle from './ThemeToggle'

const navItems = [
  { href: '/dashboard', label: 'Přehled' },
  { href: '/properties/map', label: 'Mapa' },
  { href: '/calendar', label: 'Kalendář' },
  { href: '/inbox', label: 'E-maily' },
  { href: '/data', label: 'Data' },
  { href: '/workflows', label: 'Workflow' },
]

function isActive(pathname: string, href: string) {
  const [baseHref] = href.split('?')
  return pathname === baseHref || pathname.startsWith(`${baseHref}/`)
}

export default function TopNav() {
  const pathname = usePathname()

  const openCommandBar = () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
      })
    )
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">pepaOS</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Back Office Operations Agent</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={openCommandBar}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          >
            <Search size={16} />
            <span>Hledat</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Ctrl+K
            </span>
          </button>
          <nav className="flex flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-slate-50/80 p-1 dark:border-slate-800 dark:bg-slate-900/60">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-sky-500 text-sky-950 shadow-sm dark:bg-sky-400 dark:text-slate-950'
                      : 'text-slate-700 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
