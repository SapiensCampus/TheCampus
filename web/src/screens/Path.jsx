import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useTrail } from '../lib/trail'
import { LufySays } from '../components/Chrome'
import { skillUnitFor } from './Careers'

function Lock() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" fill="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

const OFFSETS = [0, 36, 56, 36, 0, -36, -56, -36]
const BANNER_COLORS = ['mint', 'sky']
export const STEP_XP = 10

const UNIT_LABEL = { try: 'Explore', skill: 'Evelve', careers: 'Explore' }
const COMING_NEXT = 'Prototyping, Problem-solving'

function Node({ state, label, selected, onClick, index, glyph, minutes, title, current, nodeRef }) {
  return (
    <li ref={nodeRef} className="node-row" style={{ '--off': `${OFFSETS[index % OFFSETS.length]}px` }}>
      {current && <span className="start-bubble" aria-hidden="true">Start</span>}
      <button
        type="button"
        className={`path-node state-${state}${selected ? ' selected' : ''}`}
        aria-label={label}
        aria-expanded={selected}
        onClick={onClick}
      >
        <span aria-hidden="true">{state === 'completed' ? '✓' : state === 'locked' ? <Lock /> : glyph || '★'}</span>
      </button>
      {title && (
        <span className="node-cap" aria-hidden="true">
          <b>{title}</b>
          {minutes > 0 && <small>{minutes} min</small>}
        </span>
      )}
    </li>
  )
}

function StepPopover({ step, unitLocked }) {
  const locked = step.state === 'locked'
  return (
    <div className="node-pop" role="group" aria-label={step.title}>
      <p className="mono">
        {step.state === 'completed' ? 'Done' : locked ? 'Locked' : 'Up next'} · {step.estimateMinutes} min
      </p>
      <strong>{step.title}</strong>
      <p className="muted">{step.goal}</p>
      {locked ? (
        <p className="muted">{unitLocked ? 'Finish the Try it lessons to open this skill.' : 'Finish the lesson before this one.'}</p>
      ) : (
        <Link className="btn dark block" to={`/lesson/${step.id}`}>
          {step.state === 'completed' ? 'Review' : `Start +${STEP_XP} XP`}
        </Link>
      )}
    </div>
  )
}

export default function Path() {
  const { go, whatsappUrl } = useSession()
  const t = useTrail()
  const [open, setOpen] = useState('')
  const currentRef = useRef(null)
  const nextId = t.units.flatMap((u) => u.steps).find((s) => s.state === 'available')?.id
  const scrolled = useRef(false)

  // Returning students land on their current node, not at the top.
  useEffect(() => {
    if (scrolled.current || !currentRef.current || t.totalDone === 0) return
    scrolled.current = true
    currentRef.current.scrollIntoView({ block: 'center' })
  })

  if (t.loading && !t.role) return <p className="mono pad" aria-busy="true">Loading your path…</p>
  if (t.loadError) {
    return (
      <div className="pad">
        <p className="form-error" role="alert">{t.loadError}</p>
        <button type="button" className="btn dark" onClick={t.reload}>Try again</button>
      </div>
    )
  }
  if (!t.role) return <p className="mono pad">Loading your path…</p>

  const tryDone = !t.tryUnit || t.tryUnit.finished
  const goalCareer = (t.role.careers || []).find((c) => c.id === t.me?.goal) || null
  const neededUnits = new Set((goalCareer?.skills || []).map((s) => skillUnitFor(t.units, s)?.id).filter(Boolean))
  const nextStep = t.units.flatMap((u) => u.steps).find((s) => s.state === 'available')

  return (
    <div className="path">
      <div className="path-intro">
        <div>
          <p className="eyebrow">{t.role.title}</p>
          <h1>Your path</h1>
          <p className="muted">{t.totalDone} of {t.totalSteps} lessons done</p>
          <div className="path-progress" role="progressbar" aria-label="Lessons done" aria-valuemin={0} aria-valuemax={t.totalSteps} aria-valuenow={t.totalDone}>
            <b style={{ width: `${t.totalSteps ? (t.totalDone / t.totalSteps) * 100 : 0}%` }} />
          </div>
          {goalCareer && <p className="mono">Aiming for: {goalCareer.title}</p>}
        </div>
      </div>

      {t.outdated && (
        <div className="notice" role="status">
          <p>A newer version of this path is ready. Your old progress is kept.</p>
          <button type="button" className="btn dark" disabled={t.busy} onClick={t.upgrade}>
            Switch to the new path
          </button>
        </div>
      )}
      {t.actionError && <p className="form-error" role="alert">{t.actionError}</p>}

      {nextStep && (
        <Link className="today-card" to={`/lesson/${nextStep.id}`}>
          <span className="mono">Today</span>
          <strong>{nextStep.title}</strong>
          <span className="today-foot">
            <span>{nextStep.estimateMinutes} min</span>
            <span className="today-go">Start ▸</span>
          </span>
        </Link>
      )}

      {t.totalDone === 0 && nextStep && (
        <LufySays>Start small. Open the first lesson, try the task, tick the list. Each lesson is worth {STEP_XP} XP.</LufySays>
      )}

      {t.units.map((unit, ui) => {
        const color = BANNER_COLORS[ui % BANNER_COLORS.length]
        const unitLocked = unit.kind !== 'try' && !tryDone
        return (
          <section key={unit.id} className="unit" aria-labelledby={`u-${unit.id}`}>
            <header className={`unit-banner ${color}`}>
              <div>
                <p className="mono">Unit {ui + 1} · {UNIT_LABEL[unit.kind] || 'Evelve'}</p>
                <h2 id={`u-${unit.id}`}>{unit.title}</h2>
                {unit.skill && unit.skill !== unit.title && <p>{unit.skill}</p>}
                {neededUnits.has(unit.id) && <p className="mono">Needed for {goalCareer.title}</p>}
              </div>
              {unit.kind !== 'careers' && unit.total > 0 && (
                <span className="unit-count">{unit.done}/{unit.total}</span>
              )}
            </header>
            <ol className="nodes">
              {unit.kind === 'careers' ? (
                <Node
                  index={0}
                  glyph="◆"
                  state={t.me?.goal ? 'completed' : 'available'}
                  label="Explore careers"
                  onClick={() => go('/careers')}
                />
              ) : (
                unit.steps.map((step, i) => (
                  <Fragment key={step.id}>
                    <Node
                      index={i}
                      state={step.state}
                      minutes={step.estimateMinutes}
                      title={step.title}
                      current={step.id === nextId}
                      nodeRef={step.id === nextId ? currentRef : undefined}
                      label={`${step.title}, ${step.state === 'completed' ? 'done' : step.state === 'locked' ? 'locked' : 'up next'}`}
                      selected={open === step.id}
                      onClick={() => setOpen(open === step.id ? '' : step.id)}
                    />
                    {open === step.id && (
                      <li className="pop-row">
                        <StepPopover step={step} unitLocked={unitLocked} />
                      </li>
                    )}
                  </Fragment>
                ))
              )}
            </ol>
            {unit.kind !== 'careers' && whatsappUrl && (
              <p className="muted">Stuck? <a href={whatsappUrl} target="_blank" rel="noreferrer">Ask in the WhatsApp group</a></p>
            )}
          </section>
        )
      })}

      <section className="unit" aria-label="Coming next">
        <header className="unit-banner cream">
          <div>
            <p className="mono">Coming next</p>
            <h2>{COMING_NEXT}</h2>
            <p>Engineer opens after your first skill. We’re building it.</p>
          </div>
        </header>
      </section>
    </div>
  )
}
