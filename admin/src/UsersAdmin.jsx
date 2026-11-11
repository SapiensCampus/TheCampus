import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUser, getUserRoadmap, listUsers } from './api'

const PAGE_SIZE = 25
const RIASEC_ORDER = ['R', 'I', 'A', 'S', 'E', 'C']

const AREA_COLORS = {
  R: 'mint',
  I: 'sky',
  A: 'lilac',
  S: 'yellove',
  E: 'peach',
  C: 'mint',
}

function formatWhen(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '—'
  }
}

function ScoreChips({ scores }) {
  if (!scores || typeof scores !== 'object') return <span className="muted">—</span>
  const entries = RIASEC_ORDER.filter((key) => scores[key] != null).map((key) => [key, scores[key]])
  if (!entries.length) {
    const fallback = Object.entries(scores)
    if (!fallback.length) return <span className="muted">—</span>
    return (
      <div className="score-chips">
        {fallback.map(([key, value]) => (
          <span key={key} className={`tag ${AREA_COLORS[key] || ''}`}>
            {key}:{value}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="score-chips">
      {entries.map(([key, value]) => (
        <span key={key} className={`tag ${AREA_COLORS[key] || ''}`}>
          {key}:{value}
        </span>
      ))}
    </div>
  )
}

function Pager({ page, pageSize, total, hasNext, hasPrev, onPrev, onNext, busy }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total || page * pageSize)
  return (
    <div className="pager">
      <span className="pager-meta mono">
        {total != null ? `${from}–${Math.min(to, total)} of ${total}` : `Page ${page}`}
      </span>
      <div className="pager-actions">
        <button type="button" className="btn sm ghost" disabled={!hasPrev || busy} onClick={onPrev}>
          ← Prev
        </button>
        <button type="button" className="btn sm ghost" disabled={!hasNext || busy} onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  )
}

function progressLabel(trail) {
  if (!trail) return 'Not started'
  if (trail.state === 'finished') return 'Finished'
  if (trail.state === 'on-step') return 'On a step'
  if (trail.state === 'unknown-trail') return 'Trail missing'
  return 'In progress'
}

function UserDetail({ uid, onClose }) {
  const [user, setUser] = useState(null)
  const [roadmap, setRoadmap] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let alive = true
    setBusy(true)
    setError('')
    Promise.all([getUser(uid), getUserRoadmap(uid)])
      .then(([profile, progress]) => {
        if (!alive) return
        setUser(profile.user || null)
        setRoadmap(progress || null)
      })
      .catch((err) => {
        if (alive) setError(err.message || 'Failed to load student')
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [uid])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trails = roadmap?.trails || []
  const active = roadmap?.active || null

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-dialog user-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <section className="window">
          <div className="window-bar">
            <div className="window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="title" id="user-detail-title">
              Student
            </div>
            <button type="button" className="btn sm ghost" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="window-body user-detail-body">
            {busy && (
              <div className="empty">
                <strong>Loading student…</strong>
                <p className="muted">Profile and trail progress.</p>
              </div>
            )}
            {!busy && error && (
              <div className="flash err" role="alert">
                <span className="mono">Error</span>
                <div>{error}</div>
              </div>
            )}
            {!busy && user && (
              <>
                <header className="user-detail-hero">
                  <div>
                    <p className="mono">Profile</p>
                    <h2>{user.displayName || 'Unnamed student'}</h2>
                    <p className="user-detail-email">{user.email || '—'}</p>
                  </div>
                  <span className={`tag ${user.hasAnswers ? 'mint' : 'peach'}`}>
                    {user.hasAnswers ? 'Discovery done' : 'No discovery yet'}
                  </span>
                </header>

                <div className="user-detail-grid">
                  <div className="user-detail-card">
                    <span className="label">College</span>
                    <strong>{user.collegeName || user.collegeId || '—'}</strong>
                  </div>
                  <div className="user-detail-card">
                    <span className="label">Department</span>
                    <strong>{user.departmentName || user.departmentId || '—'}</strong>
                  </div>
                  <div className="user-detail-card">
                    <span className="label">Passout</span>
                    <strong>{user.passoutYear || '—'}</strong>
                  </div>
                  <div className="user-detail-card">
                    <span className="label">Mobile</span>
                    <strong>{user.mobile || '—'}</strong>
                  </div>
                  <div className="user-detail-card">
                    <span className="label">Invite</span>
                    <strong className="mono">{user.inviteCode || '—'}</strong>
                  </div>
                  <div className="user-detail-card">
                    <span className="label">Joined</span>
                    <strong>{formatWhen(user.createdAt)}</strong>
                  </div>
                </div>

                <section className="user-detail-section">
                  <div className="user-detail-section-head">
                    <h3>Discovery</h3>
                    <span className="muted">
                      {user.answerCount ? `${user.answerCount} answers` : 'No answers stored'}
                    </span>
                  </div>
                  <div className="user-detail-role-row">
                    <div>
                      <span className="label">Selected role</span>
                      <strong>
                        {user.selectedRole?.name ||
                          user.roles?.[0]?.name ||
                          (user.hasAnswers ? 'Unpicked' : '—')}
                      </strong>
                      {user.selectedRole?.score != null && (
                        <span className="muted"> · score {user.selectedRole.score}</span>
                      )}
                    </div>
                    <ScoreChips scores={user.scores} />
                  </div>
                  {Array.isArray(user.roles) && user.roles.length > 0 && (
                    <div className="role-chip-row">
                      {user.roles.map((role) => (
                        <span
                          key={role.id || role.name}
                          className={`tag ${
                            user.selectedRole?.id === role.id ? 'mint' : ''
                          }`}
                        >
                          {role.name || role.id}
                          {role.score != null ? ` · ${role.score}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section className="user-detail-section">
                  <div className="user-detail-section-head">
                    <h3>Trail progress</h3>
                    <span className="muted">
                      {roadmap?.noteAccess || 'Notes stay private'}
                    </span>
                  </div>
                  {roadmap?.excluded && (
                    <p className="callout yellove">This account is excluded from public trail counts.</p>
                  )}
                  {!active && trails.length === 0 && (
                    <div className="empty compact">
                      <strong>No trail yet</strong>
                      <p className="muted">Progress appears after they start a role trail.</p>
                    </div>
                  )}
                  {active && (
                    <div className="trail-active">
                      <div className="trail-active-top">
                        <div>
                          <span className="label">Active trail</span>
                          <strong>
                            {active.title || active.roleId}
                            {active.version ? ` · v${active.version}` : ''}
                          </strong>
                        </div>
                        <span className="tag mint">{progressLabel(active)}</span>
                      </div>
                      <div className="trail-meter" aria-hidden="true">
                        <i
                          style={{
                            width: active.total
                              ? `${Math.round((active.done / active.total) * 100)}%`
                              : '0%',
                          }}
                        />
                      </div>
                      <p className="muted">
                        {active.total ? `${active.done} / ${active.total} steps` : 'No steps'}
                        {active.currentStep ? ` · now: ${active.currentStep}` : ''}
                      </p>
                      {Array.isArray(active.steps) && active.steps.length > 0 && (
                        <ol className="trail-steps">
                          {active.steps.map((step) => (
                            <li
                              key={step.id}
                              className={step.completed ? 'done' : ''}
                            >
                              <span>{step.title || step.id}</span>
                              <span className="mono">
                                {step.completed ? 'Done' : 'Open'}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                  {trails.filter((trail) => !trail.active).length > 0 && (
                    <div className="trail-other">
                      <span className="label">Other trails</span>
                      <ul>
                        {trails
                          .filter((trail) => !trail.active)
                          .map((trail) => (
                            <li key={`${trail.roleId}:${trail.version}`}>
                              <strong>{trail.title || trail.roleId}</strong>
                              <span className="muted">
                                {progressLabel(trail)}
                                {trail.total ? ` · ${trail.done}/${trail.total}` : ''}
                                {trail.archivedAttempts
                                  ? ` · ${trail.archivedAttempts} restart${
                                      trail.archivedAttempts === 1 ? '' : 's'
                                    }`
                                  : ''}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </section>

                <p className="user-detail-meta mono">
                  uid {user.id}
                  {user.updatedAt ? ` · updated ${formatWhen(user.updatedAt)}` : ''}
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function UsersAdmin() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState('')
  const [cursorStack, setCursorStack] = useState([])
  const [page, setPage] = useState(1)
  const [nextCursor, setNextCursor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedUid, setSelectedUid] = useState(null)

  const applyPage = useCallback((data) => {
    setUsers(data.users || [])
    setTotal(data.total || 0)
    setNextCursor(data.nextCursor || null)
  }, [])

  useEffect(() => {
    let alive = true
    setBusy(true)
    setError('')
    listUsers({ limit: PAGE_SIZE, cursor })
      .then((data) => {
        if (alive) applyPage(data)
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [cursor, applyPage])

  const withDiscovery = useMemo(
    () => users.filter((row) => row.hasAnswers).length,
    [users]
  )

  function goNext() {
    if (!nextCursor) return
    setCursorStack((stack) => [...stack, cursor])
    setCursor(nextCursor)
    setPage((value) => value + 1)
  }

  function goPrev() {
    if (!cursorStack.length) return
    const stack = [...cursorStack]
    const prev = stack.pop() || ''
    setCursorStack(stack)
    setCursor(prev)
    setPage((value) => Math.max(1, value - 1))
  }

  return (
    <>
      {error && (
        <div className="flash err" role="status">
          <span className="mono">Error</span>
          <div>{error}</div>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="label">Total</span>
          <strong>{total}</strong>
          <span>signed-up users</span>
        </div>
        <div className="stat mint">
          <span className="label">This page</span>
          <strong>{withDiscovery}</strong>
          <span>with discovery</span>
        </div>
        <div className="stat sky">
          <span className="label">Page size</span>
          <strong>{PAGE_SIZE}</strong>
          <span>rows per request</span>
        </div>
      </div>

      <section className="window">
        <div className="window-bar">
          <div className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="title">Users · {total}</div>
        </div>
        <div className="window-body">
          {users.length === 0 && !busy ? (
            <div className="empty">
              <strong>No signed-up users yet</strong>
              <p className="muted">Profiles appear after invite + college signup.</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>College</th>
                      <th>Role</th>
                      <th>Scores</th>
                      <th>Joined</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((row) => (
                      <tr
                        key={row.id}
                        className="users-row"
                        onClick={() => setSelectedUid(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedUid(row.id)
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View ${row.displayName || row.email || 'student'}`}
                      >
                        <td>
                          <strong>{row.displayName || 'Unnamed'}</strong>
                          <div className="email muted">{row.email || '—'}</div>
                        </td>
                        <td>
                          {row.collegeName || row.collegeId || '—'}
                          {row.departmentName || row.departmentId ? (
                            <div className="muted">
                              {row.departmentName || row.departmentId}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {row.selectedRole?.name ||
                            row.roles?.[0]?.name ||
                            (row.hasAnswers ? 'Unpicked' : '—')}
                        </td>
                        <td>
                          <ScoreChips scores={row.scores} />
                        </td>
                        <td>{formatWhen(row.createdAt)}</td>
                        <td className="users-row-action">
                          <span className="btn sm ghost">View</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                hasPrev={cursorStack.length > 0}
                hasNext={Boolean(nextCursor)}
                onPrev={goPrev}
                onNext={goNext}
                busy={busy}
              />
            </>
          )}
        </div>
      </section>

      {selectedUid && (
        <UserDetail uid={selectedUid} onClose={() => setSelectedUid(null)} />
      )}
    </>
  )
}
