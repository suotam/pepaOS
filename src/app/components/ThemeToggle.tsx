'use client'

import { Moon, SunMedium } from 'lucide-react'
import { useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const savedTheme = (localStorage.getItem('pepaos-theme') as ThemeMode | null) || 'light'
    setTheme(savedTheme)
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('pepaos-theme', nextTheme)
    setTheme(nextTheme)
    window.dispatchEvent(new CustomEvent('pepaos-theme-change', { detail: nextTheme }))
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
      aria-label="Přepnout světlý a tmavý režim"
    >
      {mounted && theme === 'dark' ? <SunMedium size={16} /> : <Moon size={16} />}
      <span>{mounted && theme === 'dark' ? 'Světlý režim' : 'Tmavý režim'}</span>
    </button>
  )
}
