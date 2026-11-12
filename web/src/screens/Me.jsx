import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchClassmates, fetchSocial, fetchStudent, followStudent, setLeagueVisible, unfollowStudent } from '../lib/api'
import { useSession } from '../lib/session'
import { useTrail } from '../lib/trail'
import { avatarForRole } from '../lib/roleAvatars'

function Classmates() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      fetchClassmates(q).then((d) => alive && setRows(d.students)).catch((e) => alive && setError(e.message))
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [q])

  async function toggle(s) {
    try {
      if (s.following) await unfollowStudent(s.uid)
      else await followStudent(s.uid)
      setRows((list) => list.map((x) => (x.uid === s.uid ? { ...x, following: !x.following } : x)))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section aria-labelledby="friends-h">
      <h2 id="friends-h">Add friends</h2>
      <label className="field">
        <span className="field-label">Search classmates</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">No one from your college is on the league yet.</p>}
      <ul className="people">
        {(rows || []).map((s) => (
          <li key={s.uid}>
            <Link to={`/student/${s.uid}`}>{s.displayName}</Link>
            <button type="button" className={`btn${s.following ? '' : ' dark'}`} aria-pressed={s.following} onClick={() => toggle(s)}>
              {s.following ? 'Following' : 'Follow'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Me() {
  const { profile, user, onSignOut, whatsappUrl, selectedCollege } = useSession()
  const { me, refreshSocial, totalDone } = useTrail()
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState('')
  const avatar = profile?.selectedRole ? avatarForRole(profile.selectedRole) : null

  useEffect(() => {
    fetchSocial().then((d) => setCounts(d.counts)).catch(() => {})
  }, [])

  async function toggleVisible() {
    setError('')
    try {
      await setLeagueVisible(!me.visible)
      await refreshSocial()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="pad">
      <div className="profile-head">
        {avatar && <img src={avatar.src} alt={avatar.alt} width="96" height="96" />}
        <div>
          <h1>{user?.displayName || 'You'}</h1>
          <p className="muted">{profile?.selectedRole?.name} · {selectedCollege?.name}</p>
          {counts && <p className="mono">{counts.following} following · {counts.followers} followers</p>}
        </div>
      </div>
      {me && (
        <ul className="tiles">
          <li className="tile"><small>Streak</small><b>{me.streak}</b></li>
          <li className="tile y"><small>Total XP</small><b>{me.xpTotal}</b></li>
          <li className="tile"><small>Lessons</small><b>{totalDone}</b></li>
        </ul>
      )}
      {me && (
        <label className="check-card">
          <input type="checkbox" checked={me.visible} onChange={toggleVisible} />
          <span>
            <strong>Show me on the leaderboard</strong>
            <small>Name, college, role, XP and streak only.</small>
          </span>
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {me?.visible ? <Classmates /> : <p className="muted">Join the leaderboard to find and follow classmates.</p>}
      {whatsappUrl && <p><a className="linkish" href={whatsappUrl} target="_blank" rel="noreferrer">Optional: join the WhatsApp group</a></p>}
      <button type="button" className="linkish" onClick={onSignOut}>Sign out</button>
    </div>
  )
}

export function Student() {
  const { uid } = useParams()
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetchStudent(uid).then((d) => setS(d.student)).catch((e) => setError(e.message))
  }, [uid])

  async function toggle() {
    try {
      if (s.following) await unfollowStudent(uid)
      else await followStudent(uid)
      setS({ ...s, following: !s.following, followers: s.followers + (s.following ? -1 : 1) })
    } catch (e) {
      setError(e.message)
    }
  }
  return (
    <div className="pad">
      <Link to="/league" className="linkish">← League</Link>
      {error && <p className="form-error" role="alert">{error}</p>}
      {s && (
        <>
          <h1>{s.displayName}</h1>
          <p className="muted">{s.roleId}</p>
          <ul className="tiles">
            <li className="tile"><small>Streak</small><b>{s.streak}</b></li>
            <li className="tile y"><small>XP this week</small><b>{s.xpWeek}</b></li>
            <li className="tile"><small>Followers</small><b>{s.followers}</b></li>
          </ul>
          <button type="button" className={`btn lg${s.following ? '' : ' dark'}`} aria-pressed={s.following} onClick={toggle}>
            {s.following ? 'Following' : 'Follow'}
          </button>
        </>
      )}
    </div>
  )
}
