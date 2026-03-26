import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import OperationsShell from './components/OperationsShell'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'pepaOS',
  description: 'AI-powered Back Office Operations Agent',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <OperationsShell>{children}</OperationsShell>
      </body>
    </html>
  )
}