'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function Dashboard() {
  const [kpis, setKpis] = useState({ new_clients: 0, new_leads: 0, closed_deals: 0, total_revenue: 0 })

  useEffect(() => {
    const fetchKpis = async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const [clientsRes, leadsRes, dealsRes, amountsRes] = await Promise.all([
        supabase.from('clients').select('*', { count: 'exact' }).gte('created_at', weekAgo),
        supabase.from('leads').select('*', { count: 'exact' }).gte('created_at', weekAgo),
        supabase.from('deals').select('*', { count: 'exact' }).gte('closed_at', weekAgo).not('closed_at', 'is', null),
        supabase.from('deals').select('amount').gte('closed_at', weekAgo).not('closed_at', 'is', null)
      ])
      setKpis({
        new_clients: clientsRes.count || 0,
        new_leads: leadsRes.count || 0,
        closed_deals: dealsRes.count || 0,
        total_revenue: amountsRes.data?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0
      })
    }
    fetchKpis()
  }, [])

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold">New Clients (Week)</h2>
          <p className="text-3xl">{kpis.new_clients}</p>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold">New Leads (Week)</h2>
          <p className="text-3xl">{kpis.new_leads}</p>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold">Closed Deals (Week)</h2>
          <p className="text-3xl">{kpis.closed_deals}</p>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold">Total Revenue (Week)</h2>
          <p className="text-3xl">${kpis.total_revenue}</p>
        </div>
      </div>
    </div>
  )
}