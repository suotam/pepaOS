'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function Workflows() {
  const [workflows, setWorkflows] = useState([])
  const [name, setName] = useState('')
  const [type, setType] = useState('')

  useEffect(() => {
    fetchWorkflows()
  }, [])

  const fetchWorkflows = () => {
    supabase.from('workflows').select('*').then(({ data }) => setWorkflows(data || []))
  }

  const createWorkflow = async () => {
    if (!name || !type) return
    await supabase.from('workflows').insert({ name, type, status: 'active' })
    setName('')
    setType('')
    fetchWorkflows()
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Workflows</h1>
      <div className="mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="p-2 border mr-2" />
        <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type" className="p-2 border mr-2" />
        <button onClick={createWorkflow} className="p-2 bg-blue-500 text-white">Create</button>
      </div>
      <ul>
        {workflows.map((wf) => (
          <li key={wf.id} className="mb-2 p-2 border">
            <strong>{wf.name}</strong> - {wf.type} - Status: {wf.status}
          </li>
        ))}
      </ul>
    </div>
  )
}