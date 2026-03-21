import { supabase } from '../lib/supabase'

async function seed() {
  // Clear tables
  await supabase.from('agent_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('outputs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('workflows').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('calendar_events').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('deals').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('properties').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Insert clients
  const clients = []
  for (let i = 0; i < 50; i++) {
    clients.push({
      name: `Client ${i + 1}`,
      source: ['website', 'referral', 'social'][Math.floor(Math.random() * 3)],
      owner: `agent${Math.floor(Math.random() * 5) + 1}`
    })
  }
  const { data: clientData } = await supabase.from('clients').insert(clients).select('id')

  // Insert leads
  const leads = []
  for (let i = 0; i < 100; i++) {
    leads.push({
      client_id: clientData[Math.floor(Math.random() * clientData.length)].id,
      source_channel: ['facebook', 'email', 'phone'][Math.floor(Math.random() * 3)],
      status: ['new', 'contacted', 'qualified'][Math.floor(Math.random() * 3)]
    })
  }
  await supabase.from('leads').insert(leads)

  // Insert properties
  const properties = []
  for (let i = 0; i < 30; i++) {
    properties.push({
      title: `Property ${i + 1}`,
      address: `${i + 1} Main St`,
      locality: `City ${Math.floor(Math.random() * 10) + 1}`,
      property_type: ['apartment', 'house', 'condo'][Math.floor(Math.random() * 3)],
      status: ['available', 'sold', 'pending'][Math.floor(Math.random() * 3)],
      asking_price: Math.floor(Math.random() * 500000) + 100000,
      reconstruction_status: ['good', 'needs work', 'excellent'][Math.floor(Math.random() * 3)],
      renovation_notes: 'Some notes',
      structural_modifications: 'None'
    })
  }
  const { data: propertyData } = await supabase.from('properties').insert(properties).select('id')

  // Insert deals
  const deals = []
  for (let i = 0; i < 20; i++) {
    deals.push({
      property_id: propertyData[Math.floor(Math.random() * propertyData.length)].id,
      client_id: clientData[Math.floor(Math.random() * clientData.length)].id,
      stage: ['initial', 'negotiation', 'closed'][Math.floor(Math.random() * 3)],
      amount: Math.floor(Math.random() * 400000) + 100000,
      closed_at: Math.random() > 0.5 ? new Date().toISOString() : null
    })
  }
  await supabase.from('deals').insert(deals)

  console.log('Seeded data')
}

seed()