import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Template = {
  title: string
  summary: string
  category: string
  routeConcept: string
  suggestedDays: number
  validFrom: string
  validTo: string
  anchorDestinations: Array<{ name: string; iata?: string }>
  sourceFacts: Array<{ id: string; statement: string; sourceUrls: string[] }>
  [key: string]: unknown
}
type Candidate = {
  id: string
  status: string
  version: number
  template: Template
  updatedAt: string
}
type Version = {
  version: number
  action: string
  createdAt: string
  template: Template
}
type Run = {
  id: string
  status: string
  candidateCount: number
  errorCode: string | null
  createdAt: string
}
type Source = {
  id: string
  name: string
  enabled: boolean
  intervalHours: number
  nextRunAt: string
}
type User = { email: string; role: string }
const statuses = [
  'candidate',
  'draft',
  'review',
  'published',
  'stale',
  'expired',
  'archived',
]
const categories = ['event', 'seasonal', 'theme', 'stopover', 'deal']

function App() {
  const [token, setToken] = useState(
      () => sessionStorage.getItem('editorial-token') || ''
    ),
    [user, setUser] = useState<User | null>(null)
  const [page, setPage] = useState('Review queue'),
    [status, setStatus] = useState(''),
    [category, setCategory] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [items, setItems] = useState<Candidate[]>([]),
    [next, setNext] = useState<string | null>(null),
    [selected, setSelected] = useState<Candidate | null>(null),
    [versions, setVersions] = useState<Version[]>([])
  const [draft, setDraft] = useState(''),
    [ack, setAck] = useState(false),
    [verifyUntil, setVerifyUntil] = useState(''),
    [instruction, setInstruction] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({}),
    [runs, setRuns] = useState<Run[]>([]),
    [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false)
  const epoch = useRef(0),
    requestSequence = useRef(0)
  const canEdit = user?.role === 'reviewer' || user?.role === 'admin'
  const dirty = Boolean(
    selected && draft !== JSON.stringify(selected.template, null, 2)
  )
  let preview = selected?.template
  if (preview && dirty) {
    try {
      const value = JSON.parse(draft)
      if (value && typeof value === 'object') preview = { ...preview,
        ...Object.fromEntries(['title', 'summary', 'validTo'].filter(key => typeof value[key] === 'string').map(key => [key, value[key]])),
        ...(typeof value.suggestedDays === 'number' && Number.isFinite(value.suggestedDays) ? { suggestedDays: value.suggestedDays } : {})
      }
    } catch { /* Keep the last valid preview while advanced JSON is being edited. */ }
  }
  async function api<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    bearer = token
  ): Promise<T> {
    const response = await fetch(`/v1/admin${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value = await response.json()
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login') {
        epoch.current++
        sessionStorage.removeItem('editorial-token')
        setToken('')
        setUser(null)
      }
      throw new Error(
        value.error?.message || `Request failed (${response.status})`
      )
    }
    return value
  }
  async function action(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!token) return
    let active = true
    api<{ user: User }>('/me')
      .then((v) => {
        if (active) setUser(v.user)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [token])
  useEffect(() => {
    if (user) void refresh()
    return () => {
      requestSequence.current++
    }
  }, [user, page, status, category])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function refresh(before?: string) {
    const sequence = ++requestSequence.current,
      current = epoch.current
    setLoading(true)
    setError('')
    try {
      if (page === 'Discovery monitor') {
        const [r, s] = await Promise.all([
          api<{ runs: Run[] }>('/discovery/runs'),
          api<{ sources: Source[] }>('/discovery/sources'),
        ])
        if (sequence === requestSequence.current && current === epoch.current) {
          setRuns(r.runs)
          setSources(s.sources)
        }
      } else if (page === 'Dashboard') {
        const result = await api<{
          counts: Record<string, number>
          failedRuns: number
          soonToExpire: number
        }>('/dashboard')
        if (sequence === requestSequence.current && current === epoch.current)
          setCounts({
            ...result.counts,
            failedRuns: result.failedRuns,
            expiringSoon: result.soonToExpire,
          })
      } else {
        const query = new URLSearchParams({
          limit: '30',
          ...(page === 'Published'
            ? { status: 'published' }
            : status
            ? { status }
            : {}),
          ...(category ? { category } : {}),
          ...(before ? { before } : {}),
        })
        const result = await api<{
          candidates: Candidate[]
          nextCursor: string | null
        }>(`/templates?${query}`)
        if (sequence === requestSequence.current && current === epoch.current) {
          setItems((old) =>
            before ? [...old, ...result.candidates] : result.candidates
          )
          setNext(result.nextCursor)
        }
      }
    } catch (e) {
      if (sequence === requestSequence.current)
        setError(e instanceof Error ? e.message : 'Could not load data')
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }
  function selectValue(candidate: Candidate, history?: Version[]) {
    setSelected(candidate)
    setDraft(JSON.stringify(candidate.template, null, 2))
    setAck(false)
    setVerifyUntil('')
    if (history) setVersions(history)
  }
  async function open(id: string) {
    if (
      dirty &&
      !window.confirm('Discard unsaved edits and open another template?')
    )
      return
    await action(async () => {
      const result = await api<{ candidate: Candidate; versions: Version[] }>(
        `/templates/${id}`
      )
      selectValue(result.candidate, result.versions)
    })
  }
  async function mutate(kind: string) {
    if (!selected || !canEdit) return
    if (kind !== 'save' && dirty) {
      setError('Save your edits before changing publication state.')
      return
    }
    await action(async () => {
      const body =
        kind === 'save'
          ? { expectedVersion: selected.version, template: JSON.parse(draft) }
          : kind === 'publish'
          ? {
              expectedVersion: selected.version,
              acknowledgeFacts: ack,
              verifiedUntil: new Date(`${verifyUntil}T23:59:59Z`).toISOString(),
            }
          : { expectedVersion: selected.version }
      const result = await api<{ candidate: Candidate }>(
        `/templates/${selected.id}${kind === 'save' ? '' : `/${kind}`}`,
        body,
        kind === 'save' ? 'PUT' : 'POST'
      )
      selectValue(result.candidate)
      setNotice(
        kind === 'publish'
          ? 'Published. The current version is now eligible for Explore.'
          : 'Saved a new version.'
      )
      await refresh()
      const history = await api<{ versions: Version[] }>(
        `/templates/${selected.id}`
      )
      setVersions(history.versions)
    })
  }
  function navigate(destination: string) {
    if (dirty && !window.confirm('Discard unsaved edits?')) return
    setPage(destination)
    setSelected(null)
    setItems([])
    setNotice('')
    if (destination === page) void refresh()
  }
  if (!user)
    return (
      <main className="login">
        <div className="wordmark">
          FlightOR <span>EDITORIAL</span>
        </div>
        <h1>Welcome back.</h1>
        <p>Sign in to review travel inspiration.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void action(async () => {
              const result = await api<{ token: string; user: User }>(
                '/auth/login',
                { email: data.get('email'), password: data.get('password') },
                'POST',
                ''
              )
              sessionStorage.setItem('editorial-token', result.token)
              setToken(result.token)
              setUser(result.user)
            })
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            Sign in
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <small>Accounts are provisioned by your administrator.</small>
      </main>
    )
  return (
    <div className={`shell ${selected ? 'is-selected' : ''}`}>
      <aside className="sidebar">
        <div className="wordmark">
          FlightOR<span>Editorial</span>
        </div>
        <nav>
          {['Dashboard', 'Review queue', 'Published', 'Discovery monitor'].map(
            (name, i) => (
              <button
                key={name}
                className={page === name ? 'active' : ''}
                onClick={() => navigate(name)}
              >
                <NavIcon index={i} />
                {name}
              </button>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          <strong>{user.email}</strong>
          <small>{user.role}</small>
          <button
            onClick={() =>
              action(async () => {
                await api('/auth/logout', {})
                epoch.current++
                sessionStorage.removeItem('editorial-token')
                setToken('')
                setUser(null)
                setSelected(null)
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="body">
        <main className="content">
          <div className="page-heading">
            <div>
              <h1>{page}</h1>
              <p>
                {page === 'Review queue'
                  ? 'Verify sources, refine the itinerary, and publish with confidence.'
                  : page === 'Published'
                  ? 'Travel inspiration currently available to readers.'
                  : page === 'Discovery monitor'
                  ? 'Follow research runs and manage discovery schedules.'
                  : 'A clear view of your editorial pipeline.'}
              </p>
            </div>
            <button disabled={loading || busy} onClick={() => refresh()}>
              ↻ Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {loading && <p role="status">Loading workspace…</p>}
          {page === 'Dashboard' ? (
            <div className="metrics">
              {Object.entries(counts).map(([name, count]) => (
                <article key={name}>
                  <span>{name.replace(/([A-Z])/g, ' $1')}</span>
                  <strong>{count ?? 0}</strong>
                </article>
              ))}
            </div>
          ) : page === 'Discovery monitor' ? (
            <>
              <DiscoveryForm
                disabled={busy || !canEdit}
                onSubmit={(input) =>
                  action(async () => {
                    await api('/discovery/runs', input)
                    setNotice('Discovery queued. Refresh to follow progress.')
                    await refresh()
                  })
                }
                onSchedule={
                  user.role === 'admin'
                    ? (input, name, intervalHours) =>
                        action(async () => {
                          await api('/discovery/sources', {
                            input,
                            name,
                            intervalHours,
                          })
                          setNotice('Schedule created.')
                          await refresh()
                        })
                    : undefined
                }
              />
              <section className="panel">
                <h2>Recent runs</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Run</th>
                      <th>Status</th>
                      <th>Candidates</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td>{new Date(run.createdAt).toLocaleString()}</td>
                        <td>
                          <code>{run.id.slice(-12)}</code>
                          {run.errorCode && (
                            <small className="error">{run.errorCode}</small>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${run.status}`}>
                            {run.status}
                          </span>
                        </td>
                        <td>{run.candidateCount}</td>
                        <td>
                          {run.status === 'failed' && canEdit && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  await api(
                                    `/discovery/runs/${run.id}/retry`,
                                    {}
                                  )
                                  await refresh()
                                })
                              }
                            >
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!runs.length && (
                  <p className="empty">No discovery runs yet.</p>
                )}
              </section>
              <section className="panel">
                <h2>Scheduled sources</h2>
                {sources.map((source) => (
                  <div className="source-row" key={source.id}>
                    <div>
                      <strong>{source.name}</strong>
                      <small>
                        Every {source.intervalHours} hours · Next{' '}
                        {new Date(source.nextRunAt).toLocaleString()}
                      </small>
                    </div>
                    <button
                      disabled={busy || user.role !== 'admin'}
                      onClick={() =>
                        action(async () => {
                          await api(
                            `/discovery/sources/${source.id}`,
                            { enabled: !source.enabled },
                            'PATCH'
                          )
                          await refresh()
                        })
                      }
                    >
                      {source.enabled ? 'Pause' : 'Enable'}
                    </button>
                  </div>
                ))}
                {!sources.length && (
                  <p className="empty">No scheduled sources.</p>
                )}
              </section>
            </>
          ) : (
            <div className={`review-layout ${selected ? 'has-selection' : ''}`}>
              <section className="queue">
                <div className="filters">
                  <div
                    className="status-tabs"
                    role="group"
                    aria-label="Template status"
                  >
                    {['', 'review', 'draft', 'stale', 'archived'].map(
                      (value) => (
                        <button
                          key={value}
                          disabled={page === 'Published'}
                          className={status === value ? 'active' : ''}
                          onClick={() => setStatus(value)}
                        >
                          {value || 'All'}
                        </button>
                      )
                    )}
                  </div>
                  <label className="status-select">
                    Status
                    <select
                      aria-label="Filter by status"
                      value={page === 'Published' ? 'published' : status}
                      disabled={page === 'Published'}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">All statuses</option>
                      {statuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      aria-label="Filter by type"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">All types</option>
                      {categories.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Updated</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          className={selected?.id === item.id ? 'selected' : ''}
                        >
                          <td>
                            <button
                              className="title-button"
                              onClick={() => open(item.id)}
                            >
                              {item.template.title}
                            </button>
                            <small>
                              {item.template.anchorDestinations
                                .map((d) => d.name)
                                .join(' → ')}{' '}
                              · {item.template.suggestedDays} days
                            </small>
                          </td>
                          <td>{item.template.category}</td>
                          <td>
                            <span className={`badge ${item.status}`}>
                              {item.status}
                            </span>
                          </td>
                          <td>
                            {new Date(item.updatedAt).toLocaleDateString('en', {
                              month: 'short',
                              day: '2-digit',
                            })}
                          </td>
                          <td>
                            <button
                              aria-label={`Review ${item.template.title}`}
                              onClick={() => open(item.id)}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!items.length && !loading && (
                  <div className="empty">
                    <h2>Your queue is clear</h2>
                    <p>
                      No templates match these filters. Start a discovery run or
                      change the filters.
                    </p>
                  </div>
                )}
                {next && (
                  <button disabled={loading} onClick={() => refresh(next)}>
                    Load more
                  </button>
                )}
                <div className="queue-footer">
                  Every published story starts with a human review.
                </div>
              </section>
              {selected && (
                <aside className="inspector">
                  <div className="inspector-heading">Template preview</div>
                  <h2>{preview?.title}</h2>
                  <div className="facts">
                    <div>
                      <small>SUMMARY</small>
                      <p>{preview?.summary}</p>
                    </div>
                    <div>
                      <small>DESTINATIONS</small>
                      {selected.template.anchorDestinations
                        .map((d) => d.name)
                        .join(' → ')}
                    </div>
                    <div>
                      <small>SUGGESTED DURATION</small>
                      {preview?.suggestedDays} days
                    </div>
                    <div>
                      <small>VALID UNTIL</small>
                      {preview?.validTo}
                    </div>
                    <div>
                      <small>VERIFICATION</small>
                      {selected.status === 'published'
                        ? 'Human reviewed'
                        : 'Pending human review'}{' '}
                      · v{selected.version}
                    </div>
                  </div>
                  <button
                    className="primary full open-editor"
                    onClick={() => setEditorOpen((v) => !v)}
                  >
                    {editorOpen ? 'Close editor' : 'Open editor'}
                  </button>
                  {editorOpen && (
                    <div className="editor-content">
                      <h3>Source check</h3>
                      {selected.template.sourceFacts.map((fact) => (
                        <div className="source-fact" key={fact.id}>
                          <p>{fact.statement}</p>
                          {fact.sourceUrls
                            .filter((url) => /^https?:\/\//i.test(url))
                            .map((url, index) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Source {index + 1} ↗
                              </a>
                            ))}
                        </div>
                      ))}
                      <details>
                        <summary>Edit template {dirty && '• Unsaved'}</summary>
                        <p>
                          All fields are versioned. Saving requires a fresh
                          review.
                        </p>
                        <TemplateFields
                          draft={draft}
                          disabled={!canEdit || busy}
                          onChange={setDraft}
                        />
                        <details>
                          <summary>Advanced fields (JSON)</summary>
                          <textarea
                            aria-label="Template JSON"
                            className="json-editor"
                            disabled={!canEdit || busy}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                          />
                        </details>
                        <button
                          disabled={!canEdit || busy || !dirty}
                          onClick={() => mutate('save')}
                        >
                          Save edits
                        </button>
                      </details>
                      <details>
                        <summary>Version history ({versions.length})</summary>
                        {versions.map((v) => (
                          <div key={v.version}>
                            <strong>
                              v{v.version} · {v.action}
                            </strong>
                            <small>
                              {new Date(v.createdAt).toLocaleString()}
                            </small>
                            <details>
                              <summary>View snapshot</summary>
                              <pre>{JSON.stringify(v.template, null, 2)}</pre>
                            </details>
                          </div>
                        ))}
                      </details>
                      {canEdit && (
                        <>
                          <h3>Publication review</h3>
                          <label>
                            Verification expires
                            <input
                              type="date"
                              value={verifyUntil}
                              onChange={(e) => setVerifyUntil(e.target.value)}
                              min={new Date().toISOString().slice(0, 10)}
                              max={new Date(Date.now() + 29 * 86400000)
                                .toISOString()
                                .slice(0, 10)}
                            />
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={ack}
                              onChange={(e) => setAck(e.target.checked)}
                            />
                            I checked the source facts and travel window.
                          </label>
                          <button
                            className="primary full"
                            disabled={
                              busy ||
                              dirty ||
                              !ack ||
                              !verifyUntil ||
                              !['review', 'stale'].includes(selected.status)
                            }
                            onClick={() => mutate('publish')}
                          >
                            Approve & publish
                          </button>
                          <div className="actions">
                            {[
                              'review',
                              ...(selected.status === 'published'
                                ? ['unpublish']
                                : []),
                              'archive',
                            ].map((kind) => (
                              <button
                                key={kind}
                                disabled={busy || dirty}
                                onClick={() => mutate(kind)}
                              >
                                {kind === 'review' ? 'Submit for review' : kind}
                              </button>
                            ))}
                          </div>
                          <details>
                            <summary>Request a new research draft</summary>
                            <textarea
                              aria-label="Regeneration instruction"
                              value={instruction}
                              maxLength={1000}
                              onChange={(e) => setInstruction(e.target.value)}
                              placeholder="What needs to change or be checked again?"
                            />
                            <button
                              disabled={busy || dirty || !instruction.trim()}
                              onClick={() =>
                                action(async () => {
                                  await api(
                                    `/templates/${selected.id}/regenerate`,
                                    {
                                      expectedVersion: selected.version,
                                      instruction,
                                    }
                                  )
                                  setNotice(
                                    'Research queued. The result will require another review.'
                                  )
                                  setInstruction('')
                                })
                              }
                            >
                              Regenerate for review
                            </button>
                          </details>
                        </>
                      )}
                    </div>
                  )}
                </aside>
              )}
            </div>
          )}
        </main>
        <footer>
          FlightOR Editorial <span>Research → Review → Publish</span>
        </footer>
      </div>
    </div>
  )
}
function TemplateFields({
  draft,
  disabled,
  onChange,
}: {
  draft: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(draft)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error()
  } catch {
    return (
      <p className="error">
        Correct the advanced JSON before editing individual fields.
      </p>
    )
  }
  const update = (key: string, next: string | number) =>
    onChange(JSON.stringify({ ...value, [key]: next }, null, 2))
  return (
    <div className="template-fields">
      <label>
        Title
        <input
          disabled={disabled}
          value={typeof value.title === 'string' ? value.title : ''}
          maxLength={200}
          onChange={(e) => update('title', e.target.value)}
        />
      </label>
      <label>
        Summary
        <textarea
          disabled={disabled}
          value={typeof value.summary === 'string' ? value.summary : ''}
          maxLength={1500}
          onChange={(e) => update('summary', e.target.value)}
        />
      </label>
      <label>
        Route concept
        <textarea
          disabled={disabled}
          value={
            typeof value.routeConcept === 'string' ? value.routeConcept : ''
          }
          maxLength={1500}
          onChange={(e) => update('routeConcept', e.target.value)}
        />
      </label>
      <label>
        Category
        <select
          disabled={disabled}
          value={typeof value.category === 'string' ? value.category : ''}
          onChange={(e) => update('category', e.target.value)}
        >
          {categories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </label>
      <label>
        Suggested duration
        <input
          disabled={disabled}
          type="number"
          min="1"
          max="60"
          value={
            typeof value.suggestedDays === 'number' ? value.suggestedDays : ''
          }
          onChange={(e) => update('suggestedDays', Number(e.target.value))}
        />
      </label>
      {(['validFrom', 'validTo'] as const).map((key) => (
        <label key={key}>
          {key === 'validFrom' ? 'Valid from' : 'Valid until'}
          <input
            disabled={disabled}
            type="date"
            value={typeof value[key] === 'string' ? (value[key] as string) : ''}
            onChange={(e) => update(key, e.target.value)}
          />
        </label>
      ))}
      <small>
        Destinations, experience goals and source facts are available in
        Advanced fields.
      </small>
    </div>
  )
}
function NavIcon({ index }: { index: number }) {
  return (
    <svg
      className="nav-icon"
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {index === 0 ? (
        <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z" />
      ) : index === 1 ? (
        <>
          <rect x="5" y="4" width="14" height="17" rx="1" />
          <path d="M9 3h6v4H9zM8 11h8M8 15h8" />
        </>
      ) : index === 2 ? (
        <>
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <path d="M9 3v9l3-2 3 2V3M8 17h8" />
        </>
      ) : (
        <path d="m3 19 6-7 4 3 8-11M15 4h6v6" />
      )}
    </svg>
  )
}
function DiscoveryForm({
  disabled,
  onSubmit,
  onSchedule,
}: {
  disabled: boolean
  onSubmit: (input: unknown) => void
  onSchedule?: (input: unknown, name: string, hours: number) => void
}) {
  const [mode, setMode] = useState('once')
  return (
    <form
      className="panel discovery-form"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const input = {
          destinationCodes: String(data.get('codes'))
            .toUpperCase()
            .split(/[ ,]+/)
            .filter(Boolean),
          questions: [data.get('question')],
          researchTypes: ['activity', 'event', 'seasonal'],
          interests: [],
          validFrom: data.get('from'),
          validTo: data.get('to'),
          suggestedDays: Number(data.get('days')),
          maxResults: 5,
        }
        if (mode === 'schedule' && onSchedule)
          onSchedule(input, String(data.get('name')), Number(data.get('hours')))
        else onSubmit(input)
      }}
    >
      <h2>Start a discovery</h2>
      <p>
        Research produces drafts for review. It does not publish automatically.
      </p>
      <div className="form-grid">
        <label>
          Destination airport codes
          <input name="codes" placeholder="NRT, KIX" required maxLength={30} />
        </label>
        <label>
          Suggested days
          <input
            name="days"
            type="number"
            min="1"
            max="60"
            defaultValue="5"
            required
          />
        </label>
        <label>
          From
          <input name="from" type="date" required />
        </label>
        <label>
          Until
          <input name="to" type="date" required />
        </label>
      </div>
      <label>
        Research question
        <textarea
          name="question"
          required
          maxLength={500}
          placeholder="Which seasonal experiences are worth planning a trip around?"
        />
      </label>
      {onSchedule && (
        <label>
          Run mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="once">One run</option>
            <option value="schedule">Recurring source</option>
          </select>
        </label>
      )}
      {mode === 'schedule' && (
        <div className="form-grid">
          <label>
            Source name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Interval (hours)
            <input
              name="hours"
              type="number"
              min="6"
              max="720"
              defaultValue="24"
              required
            />
          </label>
        </div>
      )}
      <button className="primary" disabled={disabled}>
        {mode === 'schedule' ? 'Create schedule' : 'Queue research'}
      </button>
    </form>
  )
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
