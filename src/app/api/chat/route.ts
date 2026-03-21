import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { get_new_clients_by_period, get_client_sources_breakdown, get_leads_vs_sales_last_6_months, find_properties_missing_reconstruction_data, get_weekly_kpis } from '../../../lib/tools'
import { supabase } from '../../../lib/supabase'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

function detectIntent(message: string): string {
  if (message.toLowerCase().includes('analytics') || message.toLowerCase().includes('kpi')) return 'analytics'
  if (message.toLowerCase().includes('report') || message.toLowerCase().includes('chart')) return 'reporting'
  if (message.toLowerCase().includes('data') && message.toLowerCase().includes('quality')) return 'data_quality'
  if (message.toLowerCase().includes('workflow')) return 'workflow_creation'
  return 'general'
}

export async function POST(request: NextRequest) {
  const { message } = await request.json()
  const intent = detectIntent(message)

  // Log
  await supabase.from('agent_logs').insert({
    user_prompt: message,
    detected_intent: intent,
    tools_used: []
  })

  let response = ''
  let toolsUsed = []
  let chartData = null

  if (intent === 'analytics') {
    const kpis = await get_weekly_kpis()
    response = `Weekly KPIs: New clients: ${kpis.new_clients}, New leads: ${kpis.new_leads}, Closed deals: ${kpis.closed_deals}, Total revenue: $${kpis.total_revenue}`
    toolsUsed = ['get_weekly_kpis']
  } else if (intent === 'reporting') {
    const data = await get_leads_vs_sales_last_6_months()
    response = `Leads vs Sales over last 6 months: ${JSON.stringify(data)}`
    chartData = {
      type: 'line',
      labels: Object.keys(data.leads),
      data: Object.values(data.leads).map((leads, i) => ({
        month: Object.keys(data.leads)[i],
        leads,
        sales: Object.values(data.sales)[i] || 0
      }))
    }
    toolsUsed = ['get_leads_vs_sales_last_6_months']
    // Save to outputs
    await supabase.from('outputs').insert({
      type: 'report',
      title: 'Leads vs Sales Report',
      content_json: data
    })
  } else if (intent === 'data_quality') {
    const properties = await find_properties_missing_reconstruction_data()
    response = `Found ${properties.length} properties missing reconstruction data.`
    toolsUsed = ['find_properties_missing_reconstruction_data']
  } else if (intent === 'workflow_creation') {
    // Mock create workflow
    await supabase.from('workflows').insert({
      name: 'New Workflow',
      type: 'simple',
      status: 'active'
    })
    response = 'Workflow created successfully.'
    toolsUsed = ['create_workflow']
  } else {
    const res = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: message }]
    })
    response = res.choices[0].message.content || 'No response'
  }

  // Update log
  await supabase.from('agent_logs').update({ tools_used: toolsUsed }).eq('user_prompt', message)

  return NextResponse.json({ response, chart: chartData })
}