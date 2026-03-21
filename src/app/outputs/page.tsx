'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function Outputs() {
  const [outputs, setOutputs] = useState([])

  useEffect(() => {
    supabase.from('outputs').select('*').then(({ data }) => setOutputs(data || []))
  }, [])

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Outputs</h1>
      <ul>
        {outputs.map((output) => (
          <li key={output.id} className="mb-2 p-2 border">
            <h2 className="font-semibold">{output.title}</h2>
            <p>Type: {output.type}</p>
            <p>Created: {new Date(output.created_at).toLocaleDateString()}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}