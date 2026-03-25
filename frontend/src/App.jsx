import React, { useState } from 'react'

export default function App() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <div className="navbar">
        <p><b>QueryCraft</b> &nbsp; About &nbsp; Usage &nbsp; GitHub</p>
      </div>

      <div className="content">
        <aside className="sidebar">
          <ul>
            <li>PostgreSQL</li>
            <li>MySQL</li>
            <li>SQLite</li>
          </ul>
        </aside>

        <main className="main">
          <div className="field">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What would you like to do?"
            />
            <button onClick={submit} disabled={loading}>
              {loading ? 'Running...' : '→'}
            </button>
          </div>

          <section className="results">
            {error && <div className="error">{error}</div>}
            {result && (
              <div>
                <h3>Result</h3>
                <table>
                  <thead>
                    <tr>
                      {result.columns?.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows?.map((r, i) => (
                      <tr key={i}>
                        {r.map((cell, j) => (
                          <td key={j}>{String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
