import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeague, setLeagueVisible } from '../lib/api'
import { useTrail } from '../lib/trail'
import { useSession } from '../lib/session'

const SCOPES = [
  { id: 'college', label: 'My college' },
  { id: 'campus', label: 'All campus' },
  { id: 'friends', label: 'Friends' },
]

export default function League() {
  const { refreshSocial } = useTrail()
  const { whatsappUrl } = useSession()
  const [scope, setScope] = useState('college')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [small, setSmall] = useState(null) // classmates opted in, when the college board is too thin
  const [picked, setPicked] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    fetchLeague(scope)
      .then((d) => {
        if (!alive) return
        // A board of one is no fun: until about 5 classmates are in, open All campus instead.
        if (scope === 'college' && !picked && d.rows.length < 5) {
          setSmall(d.rows.length)
          setScope('campus')
          return
        }
        setData(d)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="seg" role="group" aria-label="League scope">
        {SCOPES.map((s) => (
          <button key={s.id} type="button" aria-pressed={scope === s.id} className={scope === s.id ? 'on' : ''} onClick={() => { setPicked(true); setScope(s.id) }}>
            {s.label}
          </button>
        ))}
      </div>
      {small !== null && scope === 'campus' && !picked && (
        <p className="notice">
          {small === 0 ? 'No classmates are in yet.' : small === 1 ? '1 classmate is in.' : `${small} classmates are in.`} Share the invite in your WhatsApp group.
          {whatsappUrl && <> <a href={whatsappUrl} target="_blank" rel="noreferrer">Open the group</a></>}
        </p>
      )}
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
                <small><span className="cap">{r.roleId || 'Explorer'}</span>{r.streak > 0 ? ` · ${r.streak} day streak` : ''}</small>
              </span>
              <b>{r.xpWeek} XP</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
