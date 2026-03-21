'use client'

import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

export default function Agent() {
  const [messages, setMessages] = useState<{role: string, content: string, chart?: any}[]>([])
  const [input, setInput] = useState('')

  const sendMessage = async () => {
    if (!input) return
    const newMessages = [...messages, {role: 'user', content: input}]
    setMessages(newMessages)
    setInput('')
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: input})
    })
    const data = await response.json()
    setMessages([...newMessages, {role: 'assistant', content: data.response, chart: data.chart}])
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Agent Chat</h1>
      <div className="border p-4 h-96 overflow-y-auto mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
            <span className={`inline-block p-2 rounded ${msg.role === 'user' ? 'bg-blue-200' : 'bg-gray-200'}`}>
              {msg.content}
            </span>
            {msg.chart && (
              <div className="mt-2">
                <LineChart width={400} height={200} data={msg.chart.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="leads" stroke="#8884d8" />
                  <Line type="monotone" dataKey="sales" stroke="#82ca9d" />
                </LineChart>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          className="flex-1 p-2 border"
          placeholder="Ask a question..."
        />
        <button onClick={sendMessage} className="p-2 bg-blue-500 text-white">Send</button>
      </div>
    </div>
  )
}