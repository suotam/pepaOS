'use client'

import type { ReactNode } from 'react'

type AppStateCardProps = {
  tone?: 'default' | 'error' | 'success'
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}

export function AppStateCard({
  tone = 'default',
  eyebrow,
  title,
  description,
  action,
  compact = false,
}: AppStateCardProps) {
  const toneClasses =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100'
        : 'border-slate-200 bg-slate-50/80 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100'

  return (
    <div className={`rounded-2xl border ${compact ? 'px-4 py-3' : 'px-5 py-5'} ${toneClasses}`}>
      {eyebrow ? <p className="text-[11px] uppercase tracking-[0.18em] text-current/60">{eyebrow}</p> : null}
      <p className={`${eyebrow ? 'mt-2' : ''} text-sm font-semibold`}>{title}</p>
      {description ? <p className="mt-1 text-sm text-current/75">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function AppStateInline({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'error' | 'success'
  children: ReactNode
}) {
  const toneClasses =
    tone === 'error'
      ? 'text-rose-600 dark:text-rose-400'
      : tone === 'success'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-500 dark:text-slate-400'

  return <p className={`text-sm ${toneClasses}`}>{children}</p>
}
