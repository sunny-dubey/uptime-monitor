import { useEffect, useState, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const POLL_INTERVAL_MS = 5000

function formatTime(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleTimeString(undefined, {
    timeZoneName: 'short',
  })
}

function StatusBadge({ isUp }) {
  if (isUp === null || isUp === undefined) {
    return <span className="badge badge-unknown">checking…</span>
  }
  return isUp ? (
    <span className="badge badge-up">up</span>
  ) : (
    <span className="badge badge-down">down</span>
  )
}

export default function App() {
  const [monitors, setMonitors] = useState([])
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchMonitors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/monitors`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const data = await res.json()
      setMonitors(data)
      setError(null)
    } catch (err) {
      setError('Could not reach the API. Is the backend running?')
    }
  }, [])

  useEffect(() => {
    fetchMonitors()
    const id = setInterval(fetchMonitors, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchMonitors])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/monitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), name: name.trim() || null }),
      })
      if (!res.ok) {
        if (res.status === 422) {
          const body = await res.json()
          throw new Error(body.detail?.[0]?.msg || 'Invalid URL')
        }
        throw new Error(`API returned ${res.status}`)
      }
      setUrl('')
      setName('')
      await fetchMonitors()
    } catch (err) {
      setError(err.message || 'Could not add monitor.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>Uptime Monitor</h1>

      <form className="add-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add URL'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Status</th>
            <th>Status code</th>
            <th>Response time</th>
            <th>Last checked</th>
          </tr>
        </thead>
        <tbody>
          {monitors.map((m) => (
            <tr key={m.id}>
              <td>{m.name || '—'}</td>
              <td className="url-cell">{m.url}</td>
              <td>
                <StatusBadge isUp={m.is_up} />
              </td>
              <td>{m.status_code ?? '—'}</td>
              <td>
                {m.response_time_ms != null
                  ? `${Math.round(m.response_time_ms)} ms`
                  : '—'}
              </td>
              <td>{formatTime(m.last_checked_at)}</td>
            </tr>
          ))}
          {monitors.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-row">
                No monitors yet. Add a URL above to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
