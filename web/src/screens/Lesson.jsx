import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTrail } from '../lib/trail'
import { LessonShell } from '../components/Chrome'
import { STEP_XP } from './Path'

const PAGES = ['Goal', 'Task', 'Done when']

function NotesDialog({ stepId, onClose }) {
  const { trail, saveNotes } = useTrail()
  const saved = trail?.notes?.[stepId] || { text: '', evidence: '', revision: 0 }
  const [text, setText] = useState(saved.text || '')
  const [evidence, setEvidence] = useState(saved.evidence || '')
  const [status, setStatus] = useState(saved.text || saved.evidence ? 'Saved' : '')
  const revision = useRef(saved.revision || 0)
  const timer = useRef(null)
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.showModal()
    return () => clearTimeout(timer.current)
  }, [])

  function queue(nextText, nextEvidence) {
    setStatus('Saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await saveNotes(stepId, nextText, nextEvidence, revision.current)
        revision.current = res.revision
        setStatus('Saved')
      } catch (err) {
        setStatus(err.code === 'note_conflict' ? 'Changed in another tab. Close and reopen.' : 'Not saved')
      }
    }, 700)
  }

  return (
    <dialog ref={ref} className="notes-dialog" onClose={onClose} aria-label="My notes">
      <h2>My notes</h2>
      <p className="muted">Private. Only you can read this.</p>
      <label className="field">
        <span className="field-label">What I did or learned</span>
        <textarea rows={5} maxLength={4000} value={text} onChange={(e) => { setText(e.target.value); queue(e.target.value, evidence) }} />
      </label>
      <label className="field">
        <span className="field-label">Link to my work (optional)</span>
        <input type="url" value={evidence} onChange={(e) => { setEvidence(e.target.value); queue(text, e.target.value) }} placeholder="https://" />
      </label>
      <p className="mono" role="status">{status}</p>
      <button type="button" className="btn dark block" onClick={() => ref.current?.close()}>Close</button>
    </dialog>
  )
}

export default function Lesson() {
  const { stepId } = useParams()
  const navigate = useNavigate()
  const t = useTrail()
  const { step, unit } = t.getStep(stepId)
  const [page, setPage] = useState(0)
  const [checks, setChecks] = useState({})
  const [saveState, setSaveState] = useState('')
  const [result, setResult] = useState(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (!step) return
    const next = {}
    step.checklist.forEach((_, i) => {
      next[String(i)] = Boolean(step.ticks[String(i)])
    })
    setChecks(next)
    setPage(0)
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id])

  useEffect(() => () => clearTimeout(timer.current), [])

  if (t.loading && !step) return <p className="mono pad" aria-busy="true">Loading lesson…</p>
  if (!step) {
    return (
      <div className="pad">
        <p className="muted">That lesson isn’t on your path.</p>
        <button type="button" className="btn dark" onClick={() => navigate('/path')}>Back to path</button>
      </div>
    )
  }

  const state = step.state
  const allChecked = step.checklist.every((_, i) => checks[String(i)])
  const leave = () => navigate('/path')

  function toggle(i) {
    if (state === 'completed') return
    const key = String(i)
    const next = { ...checks, [key]: !checks[key] }
    setChecks(next)
    setSaveState('Saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      t.saveChecks(step.id, next).then(() => setSaveState('Saved')).catch(() => setSaveState('Not saved'))
    }, 500)
  }

  async function markDone() {
    clearTimeout(timer.current)
    try {
      const res = await t.complete(step.id, checks)
      setResult(res)
    } catch {
      // actionError is shown by the provider
    }
  }

  async function undo() {
    if (!window.confirm('Undo this lesson? Later lessons in this unit lock again. Your notes stay.')) return
    try {
      await t.undo(step.id)
      navigate('/path')
    } catch {
      // shown below
    }
  }

  // Completion screen: XP, streak, quest progress.
  if (result) {
    const nextStep = unit.steps.find((s) => s.state === 'available' && s.id !== step.id)
    const me = t.me
    const quest = me?.quests?.list?.find((q) => !q.done)
    return (
      <LessonShell
        progress={3}
        total={3}
        onClose={leave}
        footer={
          <>
            {nextStep && (
              <button type="button" className="btn dark lg block" onClick={() => navigate(`/lesson/${nextStep.id}`)}>
                Next lesson
              </button>
            )}
            <button type="button" className={`btn lg block${nextStep ? '' : ' dark'}`} onClick={leave}>
              Back to path
            </button>
          </>
        }
      >
        <div className="done-screen">
          <h1>{result.finishedTrail ? 'Path complete!' : 'Lesson complete!'}</h1>
          <ul className="tiles">
            <li className="tile y"><small>XP earned</small><b>+{result.alreadyComplete ? 0 : STEP_XP}</b></li>
            <li className="tile"><small>Streak</small><b>{me?.streak ?? 1}</b></li>
            <li className="tile"><small>This week</small><b>{me?.xpWeek ?? 0}</b></li>
          </ul>
          {quest && <p className="muted">Next quest: {quest.label} ({quest.progress}/{quest.goal})</p>}
          {me?.quests?.canClaim && <p className="notice">All daily quests done. Claim your chest in Quests.</p>}
        </div>
      </LessonShell>
    )
  }

  const last = page === PAGES.length - 1
  let reason = ''
  if (state === 'locked') reason = 'Finish the earlier lessons to mark this one done. You can still read it.'
  else if (!allChecked) reason = 'Tick every item after you try the task.'

  const footer = last ? (
    state === 'completed' ? (
      <>
        <p className="muted">This lesson is saved.</p>
        <button type="button" className="btn lg block" onClick={undo}>Undo this lesson</button>
      </>
    ) : (
      <>
        {reason && <p className="muted" role="status">{reason}</p>}
        <button type="button" className="btn dark lg block" disabled={Boolean(reason) || t.busy} onClick={markDone}>
          {t.busy ? 'Saving…' : `Mark done +${STEP_XP} XP`}
        </button>
      </>
    )
  ) : (
    <button type="button" className="btn dark lg block" onClick={() => setPage(page + 1)}>Continue</button>
  )

  return (
    <>
      <LessonShell progress={page} total={PAGES.length} onClose={leave} footer={footer} label="Lesson progress">
        <p className="mono">{unit.title} · {PAGES[page]} · {step.estimateMinutes} min</p>
        <h1>{step.title}</h1>
        {page === 0 && (
          <>
            <p className="lesson-lead">{step.goal}</p>
            <p className="muted">You will make: {step.requiredOutput}</p>
          </>
        )}
        {page === 1 && (
          <>
            <p>{step.task}</p>
            <div className="resource">
              <p className="mono">{step.resource.publisher}</p>
              <a href={step.resource.url} target="_blank" rel="noreferrer">{step.resource.title}</a>
              <p className="muted">{step.resource.slice}</p>
            </div>
            {step.links?.map((l) => (
              <p key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.title}</a> <span className="muted">{l.publisher}</span></p>
            ))}
            <p className="muted">Link not opening? Do the task anyway, you don’t need it.</p>
          </>
        )}
        {page === 2 && (
          <>
            <p className="lesson-lead">Tick each one once you have done it.</p>
            <ul className="checklist">
              {step.checklist.map((label, i) => (
                <li key={label}>
                  <label className={`check-card${checks[String(i)] ? ' on' : ''}`}>
                    <input type="checkbox" checked={Boolean(checks[String(i)])} disabled={state !== 'available'} onChange={() => toggle(i)} />
                    <span>{label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mono" role="status">{saveState}</p>
            {state !== 'locked' && (
              <button type="button" className="linkish" onClick={() => setNotesOpen(true)}>My notes</button>
            )}
          </>
        )}
        {t.actionError && <p className="form-error" role="alert">{t.actionError}</p>}
        {page > 0 && <button type="button" className="linkish" onClick={() => setPage(page - 1)}>← Back</button>}
      </LessonShell>
      {notesOpen && <NotesDialog stepId={step.id} onClose={() => setNotesOpen(false)} />}
    </>
  )
}
