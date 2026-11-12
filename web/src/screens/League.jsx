import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeague, setLeagueVisible } from '../lib/api'
import { useTrail } from '../lib/trail'

const SCOPES = [
  { id: 'college', label: 'My college' },
  { id: 'campus', label: 'All campus' },
  { id: 'friends', label: 'Friends' },
]

export default function League() {
  const { refreshSocial } = useTrail()
  const [scope, setScope] = useState('college')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    fetchLeague(scope)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [scope, tick])

  async function join() {
    try {
      await setLeagueVisible(true)
      refreshSocial()
      setTick((n) => n + 1)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="pad">
      <p className="eyebrow">Resets every Monday</p>
      <h1>League</h1>
      <div className="seg" role="tablist" aria-label="League scope">
        {SCOPES.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} className={scope === s.id ? 'on' : ''} onClick={() => setScope(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!data && !error && <p className="mono" aria-busy="true">Loading…</p>}
      {data && !data.joined && (
        <div className="notice">
          <p>You are not on the leaderboard. Join to see where you stand. Others see only your name, college, role, XP and streak.</p>
          <button type="button" className="btn dark" onClick={join}>Join the league</button>
        </div>
      )}
      {data && data.rows.length === 0 && data.joined && (
        <p className="muted">
          {scope === 'friends' ? 'Follow classmates from Profile to see them here.' : 'No XP this week yet. Finish a lesson to get on the board.'}
        </p>
      )}
      {data && data.rows.length > 0 && (
        <ol className="league">
          {data.rows.map((r) => (
            <li key={r.uid} className={r.you ? 'you' : ''}>
              <span className="rank">{r.rank}</span>
              <span className="who">
                {r.you ? <strong>{r.displayName} (you)</strong> : <Link to={`/student/${r.uid}`}>{r.displayName}</Link>}
                <small>{r.roleId || 'Explorer'}{r.streak > 0 ? ` · ${r.streak} day streak` : ''}</small>
              </span>
              <b>{r.xpWeek} XP</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
