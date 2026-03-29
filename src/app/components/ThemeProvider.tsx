'use client'

import { ReactNode, useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark'

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.theme = theme
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const savedTheme = (localStorage.getItem('pepaos-theme') as ThemeMode | null) || 'light'
    applyTheme(savedTheme)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const handleThemeChange = (event: Event) => {
      const customEvent = event as CustomEvent<ThemeMode>
      applyTheme(customEvent.detail || 'light')
    }

    window.addEventListener('pepaos-theme-change', handleThemeChange as EventListener)
    return () => window.removeEventListener('pepaos-theme-change', handleThemeChange as EventListener)
  }, [mounted])

  return <>{children}</>
}
