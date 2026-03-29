'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AppStateCard, AppStateInline } from '../components/AppStateCard'

type Kpis = {
  totalClients: number
  totalProperties: number
  totalLeads: number
  totalDeals: number
  weeklyRevenue: number
}

type WorkflowSummary = {
  id: string
  name: string
  status: string | null
  schedule: string | null
  config_json?: {
    description?: string
    last_run?: string | null
  } | null
}

type OutputSummary = {
  id: string
  title: string | null
  type: string | null
  created_at: string
}

const CHART_COLORS = ['#2563eb', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6']

function formatWorkflowStatus(status: string | null) {
  if (status === 'active') return 'Aktivní'
  if (status === 'paused') return 'Pozastavené'
  if (status === 'running') return 'Běží'
  if (status === 'failed') return 'Chyba'
  if (status === 'completed') return 'Dokončeno'
  return 'Neznámý stav'
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<Kpis>({
    totalClients: 0,
    totalProperties: 0,
    totalLeads: 0,
    totalDeals: 0,
    weeklyRevenue: 0,
  })
  const [propertyStatusData, setPropertyStatusData] = useState<{ name: string; value: number }[]>([])
  const [monthlyFunnelData, setMonthlyFunnelData] = useState<{ month: string; leads: number; deals: number }[]>([])
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [outputs, setOutputs] = useState<OutputSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadDashboard = async () => {
      setLoading(true)

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [clientsRes, propertiesRes, leadsRes, dealsRes, weeklyRevenueRes, workflowsRes, outputsRes] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('properties').select('id, status', { count: 'exact' }),
        supabase.from('leads').select('id, created_at', { count: 'exact' }),
        supabase.from('deals').select('id, closed_at', { count: 'exact' }),
        supabase.from('deals').select('amount').gte('closed_at', sevenDaysAgo).not('closed_at', 'is', null),
        supabase.from('workflows').select('*').order('name', { ascending: true }).limit(5),
        supabase.from('outputs').select('*').order('created_at', { ascending: false }).limit(5),
      ])

      const properties = propertiesRes.data || []
      const leads = leadsRes.data || []
      const deals = dealsRes.data || []

      const statusCounts = properties.reduce<Record<string, number>>((acc, property: any) => {
        const key = property.status || 'unknown'
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})

      const monthlyKeys = Array.from({ length: 6 }).map((_, index) => {
        const date = new Date()
        date.setMonth(date.getMonth() - (5 - index))
        return date.toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit' })
      })

      const monthlyData = monthlyKeys.map((month) => ({ month, leads: 0, deals: 0 }))

      leads.forEach((lead: any) => {
        const month = new Date(lead.created_at).toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit' })
        const target = monthlyData.find((item) => item.month === month)
        if (target) target.leads += 1
      })

      deals.forEach((deal: any) => {
        const rawDate = deal.closed_at || new Date().toISOString()
        const month = new Date(rawDate).toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit' })
        const target = monthlyData.find((item) => item.month === month)
        if (target) target.deals += 1
      })

      setKpis({
        totalClients: clientsRes.count || 0,
        totalProperties: propertiesRes.count || 0,
        totalLeads: leadsRes.count || 0,
        totalDeals: dealsRes.count || 0,
        weeklyRevenue: (weeklyRevenueRes.data || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0),
      })
      setPropertyStatusData(Object.entries(statusCounts).map(([name, value]) => ({ name, value })))
      setMonthlyFunnelData(monthlyData)
      setWorkflows((workflowsRes.data || []) as WorkflowSummary[])
      setOutputs((outputsRes.data || []) as OutputSummary[])
      setLoading(false)
    }

    loadDashboard()
  }, [])

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Operativní přehled</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Rychlý přehled portfolia, pipeline a běžících workflow na jednom místě.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ['Klienti', kpis.totalClients],
          ['Nemovitosti', kpis.totalProperties],
          ['Leady', kpis.totalLeads],
          ['Dealy', kpis.totalDeals],
          ['Tržby za 7 dní', `${kpis.weeklyRevenue.toLocaleString('cs-CZ')} Kč`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Leady vs. dealy</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Vývoj pipeline za posledních 6 měsíců.</p>
            </div>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              Pipeline
            </span>
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyFunnelData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="leads" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="deals" fill="#14b8a6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stavy nemovitostí</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Aktuální rozpad portfolia podle stavu.</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Portfolio
            </span>
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={propertyStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {propertyStatusData.map((_, index) => (
                    <Cell key={`status-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Workflow</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Rychlý pohled na aktivní automatizace.</p>
            </div>
            <a href="/workflows" className="text-sm font-medium text-sky-600 dark:text-sky-400">Otevřít workflow</a>
          </div>
          <div className="mt-4 space-y-3">
            {workflows.map((workflow) => (
              <div key={workflow.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{workflow.name}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{workflow.config_json?.description || 'Bez popisu.'}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {formatWorkflowStatus(workflow.status)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Cron: {workflow.schedule || 'bez plánu'} · Poslední běh: {workflow.config_json?.last_run ? new Date(workflow.config_json.last_run).toLocaleString('cs-CZ') : 'zatím nikdy'}</p>
              </div>
            ))}
            {loading ? <AppStateInline>Načítám workflow přehled…</AppStateInline> : null}
            {!loading && workflows.length === 0 ? (
              <AppStateCard
                compact
                eyebrow="Workflow"
                title="Žádná workflow zatím nejsou."
                description="Jakmile založíš první automatizaci, objeví se tady její stručný provozní přehled."
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Poslední výstupy</h2>
          <div className="mt-4 space-y-3">
            {outputs.map((output) => (
              <div key={output.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="font-medium text-slate-900 dark:text-slate-100">{output.title || 'Bez názvu'}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{output.type || 'unknown'} · {new Date(output.created_at).toLocaleString('cs-CZ')}</p>
              </div>
            ))}
            {loading ? <AppStateInline>Načítám poslední výstupy…</AppStateInline> : null}
            {!loading && outputs.length === 0 ? (
              <AppStateCard
                compact
                eyebrow="Výstupy"
                title="Zatím nejsou žádné výstupy."
                description="Grafy, reporty a automatizované výsledky workflow se začnou zobrazovat tady."
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
