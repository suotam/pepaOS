import { supabase } from './supabase'

export async function get_new_clients_by_period(period: string) {
  const days = period === 'last_30_days' ? 30 : 7
  const { data } = await supabase
    .from('clients')
    .select('*')
    .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
  return data || []
}

export async function get_client_sources_breakdown(period: string) {
  const days = period === 'last_30_days' ? 30 : 7
  const { data } = await supabase
    .from('clients')
    .select('source')
    .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
  if (!data) return {}
  const breakdown = data.reduce((acc: Record<string, number>, client) => {
    acc[client.source] = (acc[client.source] || 0) + 1
    return acc
  }, {})
  return breakdown
}

export async function get_leads_vs_sales_last_6_months() {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const { data: leads } = await supabase
    .from('leads')
    .select('created_at')
    .gte('created_at', sixMonthsAgo.toISOString())
  const { data: deals } = await supabase
    .from('deals')
    .select('closed_at')
    .gte('closed_at', sixMonthsAgo.toISOString())
    .not('closed_at', 'is', null)
  if (!leads || !deals) return { leads: {}, sales: {} }
  const leadsByMonth = leads.reduce((acc: Record<string, number>, lead) => {
    const month = new Date(lead.created_at).toISOString().slice(0, 7)
    acc[month] = (acc[month] || 0) + 1
    return acc
  }, {})
  const salesByMonth = deals.reduce((acc: Record<string, number>, deal) => {
    const month = new Date(deal.closed_at).toISOString().slice(0, 7)
    acc[month] = (acc[month] || 0) + 1
    return acc
  }, {})
  return { leads: leadsByMonth, sales: salesByMonth }
}

export async function find_properties_missing_reconstruction_data() {
  const { data } = await supabase
    .from('properties')
    .select('*')
    .or('reconstruction_status.is.null,renovation_notes.is.null,structural_modifications.is.null')
  return data || []
}

export async function get_weekly_kpis() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .gte('created_at', weekAgo.toISOString())
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .gte('created_at', weekAgo.toISOString())
  const { data: deals } = await supabase
    .from('deals')
    .select('*')
    .gte('closed_at', weekAgo.toISOString())
    .not('closed_at', 'is', null)
  if (!clients || !leads || !deals) return { new_clients: 0, new_leads: 0, closed_deals: 0, total_revenue: 0 }
  return {
    new_clients: clients.length,
    new_leads: leads.length,
    closed_deals: deals.length,
    total_revenue: deals.reduce((sum, deal) => sum + (deal.amount || 0), 0)
  }
}

// Enhanced data query functions for natural language queries
export async function get_all_clients() {
  const { data } = await supabase.from('clients').select('*')
  return data || []
}

export async function get_all_properties() {
  const { data } = await supabase.from('properties').select('*')
  return data || []
}

export async function get_all_leads() {
  const { data } = await supabase.from('leads').select('*')
  return data || []
}

export async function get_all_deals() {
  const { data } = await supabase.from('deals').select('*')
  return data || []
}

export async function get_deals_by_stage(stage: string) {
  const { data } = await supabase.from('deals').select('*').eq('stage', stage)
  return data || []
}

export async function get_properties_by_status(status: string) {
  const { data } = await supabase.from('properties').select('*').eq('status', status)
  return data || []
}

export async function get_leads_by_status(status: string) {
  const { data } = await supabase.from('leads').select('*').eq('status', status)
  return data || []
}