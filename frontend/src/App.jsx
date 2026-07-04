import { useEffect, useState, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const POLL_INTERVAL_MS = 5000
const MS_IN_DAY = 1000 * 60 * 60 * 24

function formatTime(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleTimeString(undefined, {
    timeZoneName: 'short',
  })
}

function formatDate(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatMs(ms) {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
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

function sslStatus(expiresAt) {
  if (!expiresAt) return null
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / MS_IN_DAY)
  let level = 'ok'
  if (days < 0) level = 'expired'
  else if (days <= 7) level = 'critical'
  else if (days <= 30) level = 'warning'
  return { days, level }
}

function SslBadge({ url, expiresAt }) {
  const status = sslStatus(expiresAt)
  if (!status) {
    const isHttps = url.startsWith('https://')
    return (
      <span className="ssl-badge ssl-none">
        {isHttps ? 'cert unknown' : 'no TLS'}
      </span>
    )
  }

  const { days, level } = status
  const label =
    level === 'expired'
      ? `expired ${formatDate(expiresAt)}`
      : `expires in ${days}d (${formatDate(expiresAt)})`

  return <span className={`ssl-badge ssl-${level}`}>🔒 {label}</span>
}

function TimingBreakdown({ dns_ms, connect_ms, tls_ms }) {
  const segments = [
    { key: 'dns', label: 'DNS', value: dns_ms },
    { key: 'connect', label: 'Connect', value: connect_ms },
    { key: 'tls', label: 'TLS', value: tls_ms },
  ].filter((s) => s.value != null)

  if (segments.length === 0) {
    return <p className="timing-empty">Connection timing unavailable</p>
  }

  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1

  return (
    <div className="timing">
      <div className="timing-bar">
        {segments.map((s) => (
          <div
            key={s.key}
            className={`timing-segment timing-${s.key}`}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${formatMs(s.value)}`}
          />
        ))}
      </div>
      <div className="timing-legend">
        {segments.map((s) => (
          <span key={s.key} className="timing-legend-item">
            <span className={`timing-dot timing-${s.key}`} />
            {s.label} {formatMs(s.value)}
          </span>
        ))}
      </div>
    </div>
  )
}

function getInitialTheme() {
  const stored = localStorage.getItem('theme')
  return stored === 'light' ? 'light' : 'dark'
}

function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle color theme"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

function MonitorCard({ monitor }) {
  const m = monitor
  return (
    <div className={`monitor-card status-border-${m.is_up === false ? 'down' : m.is_up ? 'up' : 'unknown'}`}>
      <div className="monitor-card-header">
        <div>
          <h3 className="monitor-name">{m.name || m.url}</h3>
          {m.name && <div className="monitor-url">{m.url}</div>}
        </div>
        <StatusBadge isUp={m.is_up} />
      </div>

      <div className="monitor-stats">
        <div className="stat">
          <span className="stat-label">Status</span>
          <span className="stat-value">{m.status_code ?? '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">TTFB</span>
          <span className="stat-value">{formatMs(m.ttfb_ms)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total</span>
          <span className="stat-value">{formatMs(m.response_time_ms)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Checked</span>
          <span className="stat-value">{formatTime(m.last_checked_at)}</span>
        </div>
      </div>

      <div className="monitor-section">
        <span className="section-label">Connection timing</span>
        <TimingBreakdown dns_ms={m.dns_ms} connect_ms={m.connect_ms} tls_ms={m.tls_ms} />
      </div>

      <div className="monitor-section monitor-footer">
        <SslBadge url={m.url} expiresAt={m.ssl_expires_at} />
        {m.error_reason && (
          <span className="error-cell" title={m.error_reason}>
            {m.error_reason}
          </span>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [monitors, setMonitors] = useState([])
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

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
      <div className="page-header">
        <h1>Uptime Monitor</h1>
        <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      </div>

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

      <details className="metrics-info">
        <summary>What do the labels on each card mean?</summary>
        <dl>
          <dt>up / down / checking…</dt>
          <dd>
            Badge in the card header. "up" means the last check got an HTTP
            2xx/3xx status; "down" means it errored or returned 4xx/5xx;
            "checking…" means no check has completed yet.
          </dd>
          <dt>Status</dt>
          <dd>The HTTP status code returned by the most recent check.</dd>
          <dt>TTFB</dt>
          <dd>
            Time To First Byte — from the actual HTTP request, the time from
            request start until the first response byte arrives.
          </dd>
          <dt>Total</dt>
          <dd>
            From the same HTTP request, the time from start until the full
            response body has been read.
          </dd>
          <dt>Checked</dt>
          <dd>The local time of the most recent check.</dd>
          <dt>Connection timing (DNS / Connect / TLS)</dt>
          <dd>
            Measured on a separate probe connection opened in parallel with
            the real request, since the HTTP client doesn't expose per-phase
            timing. This approximates DNS lookup, TCP handshake, and TLS
            handshake time, but it is not a breakdown of TTFB or Total —
            they won't add up exactly.
          </dd>
          <dt>SSL badge</dt>
          <dd>
            Certificate expiry from the same probe connection: shows days
            until expiry (color-coded ok/warning/critical/expired), "cert
            unknown" if the probe couldn't retrieve it, or "no TLS" for
            plain HTTP URLs.
          </dd>
          <dt>Error text</dt>
          <dd>
            Shown only when the last check failed — either the HTTP status
            reason or the exception raised while making the request.
          </dd>
        </dl>
      </details>

      {monitors.length === 0 ? (
        <div className="empty-state">No monitors yet. Add a URL above to get started.</div>
      ) : (
        <div className="monitor-grid">
          {monitors.map((m) => (
            <MonitorCard key={m.id} monitor={m} />
          ))}
        </div>
      )}
    </div>
  )
}
