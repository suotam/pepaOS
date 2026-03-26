import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/clients', label: 'Clients' },
  { href: '/properties/map', label: 'Properties' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/outputs', label: 'Outputs' },
  { href: '/agent', label: 'Agent' },
]

export default function LeftNav() {
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-white border-r border-gray-200 min-h-screen p-4">
      <div className="mb-6">
        <h1 className="text-xl font-bold">pepaOS</h1>
        <p className="text-xs text-gray-500">Operations Cockpit</p>
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                active
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
