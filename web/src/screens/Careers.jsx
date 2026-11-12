import { useState } from 'react'
import { useSession } from '../lib/session'
import { useTrail } from '../lib/trail'
import { setCareerGoal } from '../lib/api'

/** Does any skill unit teach this tag? Tags without a unit are marked "later". */
export function skillUnitFor(units, tag) {
  const t = String(tag).toLowerCase()
  return units.find((u) => u.kind === 'skill' && `${u.skill} ${u.title}`.toLowerCase().includes(t)) || null
}

/** Careers for the chosen role. The "aim for this" pick is saved to the student's account. */
export default function Careers() {
  const { chosenRole, go } = useSession()
  const { role, units, me, setMe } = useTrail()
  const [error, setError] = useState('')
  const goal = me?.goal || ''

  // Trails without authored careers fall back to the short list from the quiz result.
  const careers = role?.careers?.length
    ? role.careers
    : (chosenRole?.careers || []).map((c) => ({ id: c.title, title: c.title, tag: c.tag, blurb: '', dayInLife: '', skills: [] }))

  async function aim(id) {
    setError('')
    try {
      const res = await setCareerGoal(goal === id ? '' : id)
      setMe(res.me)
    } catch (e) {
      setError(e.message || 'Could not save your pick.')
    }
  }

  return (
    <div className="pad">
      <button type="button" className="linkish" onClick={() => go('/path')}>← Back to path</button>
      <p className="eyebrow">{role?.title}</p>
      <h1>Careers you can aim for</h1>
      <p className="muted">Pick one to keep in mind. You can change it any time.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="career-cards">
        {careers.map((c) => (
          <li key={c.id} className={`career-card${goal === c.id ? ' aimed' : ''}`}>
            <div className="career-head">
              <h2>{c.title}</h2>
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
                {c.skills.map((s) => <span key={s} className="tag">{s}{skillUnitFor(units, s) ? '' : ' · later'}</span>)}
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
