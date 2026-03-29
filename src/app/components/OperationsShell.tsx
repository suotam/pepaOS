'use client'

import { ReactNode, Suspense } from 'react'
import AssistantSidebar from './AssistantSidebar'
import CommandBar from './CommandBar'
import TopNav from './TopNav'

interface OperationsShellProps {
  children: ReactNode
}

export default function OperationsShell({ children }: OperationsShellProps) {
  return (
    <div className="min-h-screen bg-[rgb(var(--background))] text-[rgb(var(--foreground))] transition-colors duration-200">
      <CommandBar />
      <TopNav />
      <div className="flex min-h-[calc(100vh-81px)]">
        <main className="flex-1 overflow-y-auto bg-gradient-to-b from-white/40 to-transparent p-4 dark:from-slate-900/20">
          {children}
        </main>
        <Suspense
          fallback={
            <aside className="h-screen w-[360px] border-l border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-950/90" />
          }
        >
          <AssistantSidebar />
        </Suspense>
      </div>
    </div>
  )
}
