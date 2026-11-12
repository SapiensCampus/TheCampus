import { useState } from 'react'
import { useSession } from '../lib/session'
import { useTrail } from '../lib/trail'

function readGoal(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

/** Careers for the chosen role. The "aim for this" pick is a per-device convenience, not saved to the server. */
export default function Careers() {
  const { user, chosenRole, go } = useSession()
  const { role } = useTrail()
  const goalKey = `sapiens-career-goal:${user?.uid}:${role?.id}`
  const [goal, setGoal] = useState(() => readGoal(goalKey))

  // Trails without authored careers fall back to the short list from the quiz result.
  const careers = role?.careers?.length
    ? role.careers
    : (chosenRole?.careers || []).map((c) => ({ id: c.title, title: c.title, tag: c.tag, blurb: '', dayInLife: '', skills: [] }))

  function aim(id) {
    setGoal(id)
    try {
      localStorage.setItem(goalKey, id)
    } catch {
      // ignore
    }
  }

  return (
    <div className="pad">
      <button type="button" className="linkish" onClick={() => go('/path')}>← Back to path</button>
      <p className="eyebrow">{role?.title}</p>
      <h1>Careers you can aim for</h1>
      <p className="muted">Pick one to keep in mind. You can change it any time.</p>
      <ul className="career-cards">
        {careers.map((c) => (
          <li key={c.id} className={`career-card${goal === c.id ? ' aimed' : ''}`}>
            <div className="career-head">
              <h2>{c.title}</h2>
              <span className={`career-tag ${c.tag === 'pays' ? 'pays' : 'interesting'}`}>
                {c.tag === 'pays' ? 'Pays well' : 'Interesting'}
              </span>
            </div>
            {c.blurb && <p>{c.blurb}</p>}
            {c.dayInLife && (
              <>
                <p className="dir-label">A day in the life</p>
                <p>{c.dayInLife}</p>
              </>
            )}
            {c.skills?.length > 0 && (
              <div className="tags">
                {c.skills.map((s) => <span key={s} className="tag">{s}</span>)}
              </div>
            )}
            <button type="button" className={`btn${goal === c.id ? ' dark' : ''}`} aria-pressed={goal === c.id} onClick={() => aim(c.id)}>
              {goal === c.id ? 'Aiming for this ✓' : 'Aim for this'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
