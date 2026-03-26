'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">pepaOS</h1>
          <p className="text-xs text-gray-500">Back Office Operations Agent</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  active ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
