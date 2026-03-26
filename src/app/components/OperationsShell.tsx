'use client'

import { ReactNode } from 'react'
import AssistantSidebar from './AssistantSidebar'
import TopNav from './TopNav'

interface OperationsShellProps {
  children: ReactNode
}

export default function OperationsShell({ children }: OperationsShellProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      <div className="flex">
        <main className="flex-1 p-4 overflow-y-auto">{children}</main>
        <AssistantSidebar />
      </div>
    </div>
  )
}
