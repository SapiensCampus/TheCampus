import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useTrail } from '../lib/trail'
import { avatarForRole } from '../lib/roleAvatars'
import { LufySays } from '../components/Chrome'

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

function Node({ state, label, selected, onClick, index, glyph }) {
  return (
    <li className="node-row" style={{ '--off': `${OFFSETS[index % OFFSETS.length]}px` }}>
      <button
        type="button"
        className={`path-node state-${state}${selected ? ' selected' : ''}`}
        aria-label={label}
        aria-expanded={selected}
        onClick={onClick}
      >
        <span aria-hidden="true">{state === 'completed' ? '✓' : state === 'locked' ? <Lock /> : glyph || '★'}</span>
      </button>
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
  const { profile, go } = useSession()
  const t = useTrail()
  const [open, setOpen] = useState('')

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

  const avatar = avatarForRole(profile.selectedRole)
  const tryDone = !t.tryUnit || t.tryUnit.finished
  const nextStep = t.units.flatMap((u) => u.steps).find((s) => s.state === 'available')

  return (
    <div className="path">
      <div className="path-intro">
        {avatar && <img src={avatar.src} alt={avatar.alt} width="72" height="72" />}
        <div>
          <p className="eyebrow">{t.role.title}</p>
          <h1>Your path</h1>
          <p className="muted">{t.totalDone} of {t.totalSteps} lessons done</p>
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
                <p className="mono">Unit {ui + 1}</p>
                <h2 id={`u-${unit.id}`}>{unit.title}</h2>
                {unit.skill && <p>{unit.skill}</p>}
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
                  state={tryDone ? 'available' : 'locked'}
                  label={tryDone ? 'Explore careers' : 'Careers, locked until Try it is done'}
                  selected={open === unit.id}
                  onClick={() => (tryDone ? go('/careers') : setOpen(open === unit.id ? '' : unit.id))}
                />
              ) : (
                unit.steps.map((step, i) => (
                  <Fragment key={step.id}>
                    <Node
                      index={i}
                      state={step.state}
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
            {unit.kind === 'careers' && open === unit.id && !tryDone && (
              <div className="node-pop"><p className="muted">Finish the Try it lessons to open careers.</p></div>
            )}
          </section>
        )
      })}

      <section className="unit" aria-label="Engineer, coming soon">
        <header className="unit-banner cream">
          <div>
            <p className="mono">Next up</p>
            <h2>Engineer</h2>
            <p>Small starts. Real things.</p>
          </div>
        </header>
        <ol className="nodes">
          <Node index={0} state="locked" label="Engineer, coming soon" onClick={() => {}} />
        </ol>
      </section>
    </div>
  )
}
