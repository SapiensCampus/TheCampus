import { useEffect, useMemo, useState } from 'react'
import {
  getRoadmapCatalog,
  getRoadmapEditor,
  listRoadmapLearners,
  publishRoadmap,
  reconcileRoadmaps,
  saveRoadmapDraft,
} from './api'

const ROLES = ['builders', 'hackers', 'creators', 'connectors', 'leaders', 'planners']

function blankStep(roleId, order, unit) {
  return {
    id: `${roleId}-new-${String(order).padStart(2, '0')}`,
    role: roleId,
    version: 1,
    order,
    type: 'task',
    section: 'Next',
    unit: unit || '',
    title: 'New step',
    goal: 'Say what this step is for',
    estimateMinutes: 30,
    task: '',
    requiredOutput: '',
    doneChecklist: ['First thing to finish', 'Second thing to finish'],
    primaryResource: {
      publisher: '',
      title: '',
      url: 'https://',
      slice: '',
      accessNote: 'Public page. No sign-in. If it asks you to pay or create an account, use the task instead.',
    },
    links: [],
    fallback: 'If the link does not open, the task in this step is enough.',
  }
}

function stateLabel(state) {
  if (state === 'finished') return 'Finished'
  if (state === 'on-step') return 'On a step'
  if (state === 'unknown-trail') return 'Trail missing'
  return 'Not started'
}

/** Unit titles and careers for the student path. Unit ids and kinds stay fixed. */
function PathEditor({ role, setRole }) {
  const patchUnit = (id, patch) =>
    setRole((cur) => ({ ...cur, units: cur.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) }))
  const patchCareer = (index, patch) =>
    setRole((cur) => ({ ...cur, careers: cur.careers.map((c, i) => (i === index ? { ...c, ...patch } : c)) }))
  const careers = role.careers || []
  return (
    <details className="stack path-editor">
      <summary>Path: units and careers</summary>
      {role.units
        .filter((u) => u.kind !== 'careers')
        .map((u) => (
          <label key={u.id} className="field">
            <span>
              {u.kind === 'try' ? 'Try it unit' : 'Skill unit'} ({u.id})
            </span>
            <input value={u.title} onChange={(e) => patchUnit(u.id, { title: e.target.value, ...(u.kind === 'skill' ? { skill: e.target.value } : {}) })} />
          </label>
        ))}
      {careers.map((c, i) => (
        <fieldset key={c.id} className="stack">
          <legend>{c.title || 'New career'}</legend>
          <label className="field">
            <span>Title</span>
            <input value={c.title} onChange={(e) => patchCareer(i, { title: e.target.value })} />
          </label>
          <label className="field">
            <span>Tag</span>
            <select value={c.tag} onChange={(e) => patchCareer(i, { tag: e.target.value })}>
              <option value="pays">Pays well</option>
              <option value="interesting">Interesting</option>
            </select>
          </label>
          <label className="field">
            <span>What it is</span>
            <input value={c.blurb} onChange={(e) => patchCareer(i, { blurb: e.target.value })} />
          </label>
          <label className="field">
            <span>A day in the life</span>
            <input value={c.dayInLife} onChange={(e) => patchCareer(i, { dayInLife: e.target.value })} />
          </label>
          <label className="field">
            <span>Skills (comma separated)</span>
            <input value={(c.skills || []).join(', ')} onChange={(e) => patchCareer(i, { skills: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </label>
          <button type="button" className="btn sm" onClick={() => setRole((cur) => ({ ...cur, careers: cur.careers.filter((_, n) => n !== i) }))}>
            Remove career
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          setRole((cur) => ({
            ...cur,
            careers: [...(cur.careers || []), { id: `career-${(cur.careers || []).length + 1}`, title: 'New career', tag: 'interesting', blurb: 'What this career is', dayInLife: 'What a day looks like', skills: [], profiles: [] }],
          }))
        }
      >
        Add career
      </button>
    </details>
  )
}

export default function RoadmapAdmin() {
  const [mode, setMode] = useState('build')
  const [roleId, setRoleId] = useState('builders')
  const [role, setRole] = useState(null)
  const [baseIds, setBaseIds] = useState([])
  const [stepIndex, setStepIndex] = useState(0)
  const [learners, setLearners] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getRoadmapCatalog()
      .then((data) => {
        if (!alive) return
        const first = (data.roles || []).find((item) => item.latest !== false) || data.roles?.[0]
        if (first?.id) setRoleId(first.id)
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (mode !== 'build' || !roleId) return undefined
    let alive = true
    setBusy(true)
    setError('')
    getRoadmapEditor(roleId)
      .then((data) => {
        if (!alive) return
        setRole(data.role)
        setBaseIds(data.baseStepIds || [])
        setStepIndex(0)
        setMessage(data.hasDraft ? 'Unpublished draft loaded.' : '')
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
  }, [mode, roleId])

  useEffect(() => {
    if (mode !== 'students') return undefined
    let alive = true
    setBusy(true)
    setError('')
    listRoadmapLearners()
      .then((data) => {
        if (alive) setLearners(data.learners || [])
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
  }, [mode])

  const step = role?.steps?.[stepIndex] || null
  const structureChanged = useMemo(() => {
    const ids = (role?.steps || []).map((item) => item.id)
    return ids.length !== baseIds.length || ids.some((id, index) => id !== baseIds[index])
  }, [role, baseIds])

  function patchStep(patch) {
    setRole((current) => {
      if (!current) return current
      const steps = current.steps.map((item, index) => (index === stepIndex ? { ...item, ...patch } : item))
      return { ...current, steps }
    })
  }

  function patchResource(patch) {
    patchStep({ primaryResource: { ...(step?.primaryResource || {}), ...patch } })
  }

  function patchChecklist(index, value) {
    const next = [...(step?.doneChecklist || [])]
    next[index] = value
    patchStep({ doneChecklist: next })
  }

  function patchLink(index, patch) {
    const links = [...(step?.links || [])]
    links[index] = { kind: 'article', title: '', publisher: '', url: '', slice: '', ...(links[index] || {}), ...patch }
    patchStep({ links })
  }

  function addStep() {
    setRole((current) => {
      if (!current || current.steps.length >= 40) return current
      const inUnit = current.steps[stepIndex]?.unit
      const steps = [...current.steps, blankStep(current.id, current.steps.length + 1, inUnit)]
      return { ...current, steps }
    })
    setStepIndex(role?.steps?.length || 0)
  }

  function removeStep() {
    setRole((current) => {
      if (!current || current.steps.length <= 1) return current
      const steps = current.steps.filter((_, index) => index !== stepIndex).map((item, index) => ({
        ...item,
        order: index + 1,
      }))
      return { ...current, steps }
    })
    setStepIndex((index) => Math.max(0, index - 1))
  }

  async function onSaveDraft() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await saveRoadmapDraft(roleId, role)
      setMessage('Draft saved. Students still see the published trail.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onPublish() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await publishRoadmap(roleId, role, structureChanged)
      const data = await getRoadmapEditor(roleId)
      setRole(data.role)
      setBaseIds(data.baseStepIds || [])
      setStepIndex(0)
      setMessage(
        result.newVersion
          ? `Published ${role.title} version ${result.version}. Students already on the older trail stay there.`
          : `Published ${role.title} version ${result.version}.`
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onReconcile() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await reconcileRoadmaps()
      setMessage(
        result.repaired?.length
          ? `Repaired counts for ${result.repaired.join(', ')}.`
          : 'Counts already matched enrolments.'
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="roadmap-admin stack">
      <div className="roadmap-modes" role="tablist" aria-label="Roadmap tools">
        <button type="button" className={`btn ${mode === 'build' ? 'dark' : ''}`} aria-pressed={mode === 'build'} onClick={() => setMode('build')}>
          Build trail
        </button>
        <button type="button" className={`btn ${mode === 'students' ? 'dark' : ''}`} aria-pressed={mode === 'students'} onClick={() => setMode('students')}>
          Student progress
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      {mode === 'build' && (
        <>
          <div className="role-switch" role="group" aria-label="Role">
            {ROLES.map((id) => (
              <button key={id} type="button" className={`btn sm ${roleId === id ? 'dark' : ''}`} aria-pressed={roleId === id} onClick={() => setRoleId(id)}>
                {id}
              </button>
            ))}
          </div>
          {role && step && (
            <div className="roadmap-editor">
              <div className="step-picker">
                <p className="muted">Version {role.version}. {structureChanged ? 'This will publish as a new version.' : 'Text changes stay on this version.'}</p>
                <ol>
                  {role.steps.map((item, index) => (
                    <li key={item.id}>
                      <button type="button" className={index === stepIndex ? 'active' : ''} aria-current={index === stepIndex ? 'true' : undefined} onClick={() => setStepIndex(index)}>
                        {item.order}. {item.title}
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" className="btn sm" disabled={busy || role.steps.length >= 40} onClick={addStep}>
                  Add step
                </button>
              </div>
              {role.units?.length > 0 && <PathEditor role={role} setRole={setRole} />}
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault()
                  onPublish()
                }}
              >
                {role.units?.length > 0 && (
                  <label className="field">
                    <span>Unit</span>
                    <select value={step.unit || ''} onChange={(event) => patchStep({ unit: event.target.value })}>
                      {role.units
                        .filter((unit) => unit.kind !== 'careers')
                        .map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.title}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>Section</span>
                  <input value={step.section || ''} onChange={(event) => patchStep({ section: event.target.value })} maxLength={24} />
                </label>
                <label className="field">
                  <span>Step title</span>
                  <input value={step.title || ''} onChange={(event) => patchStep({ title: event.target.value })} />
                </label>
                <label className="field">
                  <span>Goal</span>
                  <input value={step.goal || ''} onChange={(event) => patchStep({ goal: event.target.value })} />
                </label>
                <label className="field">
                  <span>Minutes</span>
                  <input
                    type="number"
                    min={5}
                    max={75}
                    value={step.estimateMinutes || 30}
                    onChange={(event) => patchStep({ estimateMinutes: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Task</span>
                  <textarea rows={4} value={step.task || ''} onChange={(event) => patchStep({ task: event.target.value })} />
                </label>
                <label className="field">
                  <span>What they keep</span>
                  <input value={step.requiredOutput || ''} onChange={(event) => patchStep({ requiredOutput: event.target.value })} />
                </label>
                <fieldset className="stack">
                  <legend>Done when</legend>
                  {(step.doneChecklist || []).map((item, index) => (
                    <label className="field" key={`check-${index}`}>
                      <span>Check {index + 1}</span>
                      <input value={item} onChange={(event) => patchChecklist(index, event.target.value)} />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn sm"
                    disabled={(step.doneChecklist || []).length >= 6}
                    onClick={() => patchStep({ doneChecklist: [...(step.doneChecklist || []), ''] })}
                  >
                    Add check
                  </button>
                </fieldset>
                <fieldset className="stack">
                  <legend>Main resource</legend>
                  <label className="field">
                    <span>Publisher</span>
                    <input value={step.primaryResource?.publisher || ''} onChange={(event) => patchResource({ publisher: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Title</span>
                    <input value={step.primaryResource?.title || ''} onChange={(event) => patchResource({ title: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>https link</span>
                    <input value={step.primaryResource?.url || ''} onChange={(event) => patchResource({ url: event.target.value })} inputMode="url" />
                  </label>
                  <label className="field">
                    <span>Which part to use</span>
                    <textarea rows={2} value={step.primaryResource?.slice || ''} onChange={(event) => patchResource({ slice: event.target.value })} />
                  </label>
                </fieldset>
                <fieldset className="stack">
                  <legend>Extra link</legend>
                  {(step.links || []).slice(0, 2).map((link, index) => (
                    <div className="stack" key={`link-${index}`}>
                      <label className="field">
                        <span>Kind</span>
                        <select value={link.kind || 'article'} onChange={(event) => patchLink(index, { kind: event.target.value })}>
                          <option value="article">Article</option>
                          <option value="video">Video</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Title</span>
                        <input value={link.title || ''} onChange={(event) => patchLink(index, { title: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>Publisher</span>
                        <input value={link.publisher || ''} onChange={(event) => patchLink(index, { publisher: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>https link</span>
                        <input value={link.url || ''} onChange={(event) => patchLink(index, { url: event.target.value })} inputMode="url" />
                      </label>
                    </div>
                  ))}
                  {(step.links || []).length < 2 && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => patchStep({ links: [...(step.links || []), { kind: 'article', title: '', publisher: '', url: 'https://', slice: '' }] })}
                    >
                      Add article or video
                    </button>
                  )}
                </fieldset>
                <div className="roadmap-actions">
                  <button type="submit" className="btn dark" disabled={busy}>
                    {busy ? 'Saving…' : structureChanged ? 'Publish as new version' : 'Publish changes'}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={onSaveDraft}>
                    Save draft
                  </button>
                  <button type="button" className="btn" disabled={busy || role.steps.length <= 1} onClick={removeStep}>
                    Remove this step
                  </button>
                </div>
                <p className="muted">Notes and evidence stay on the student account. This screen cannot open them.</p>
              </form>
            </div>
          )}
          <button type="button" className="btn sm" disabled={busy} onClick={onReconcile}>
            {busy ? 'Checking…' : 'Recompute anonymous counts'}
          </button>
        </>
      )}

      {mode === 'students' && (
        <div className="window">
          <div className="window-bar">
            <div className="window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="title">Where students are</div>
          </div>
          <div className="window-body">
            {learners.length === 0 ? (
              <div className="empty">
                <strong>No one has started a trail yet</strong>
                <p className="muted">Progress shows up here after a student opens a role trail.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Trail</th>
                      <th>State</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map((row) => (
                      <tr key={row.uid}>
                        <td>
                          <strong>{row.displayName || 'Student'}</strong>
                          <div className="muted">{row.email || row.uid}</div>
                          {row.collegeId ? <div className="muted">{row.collegeId}</div> : null}
                        </td>
                        <td>
                          {row.roleTitle || row.roleId || '—'}
                          {row.version ? ` · v${row.version}` : ''}
                        </td>
                        <td>
                          {stateLabel(row.state)}
                          {row.currentStep ? <div>{row.currentStep}</div> : null}
                        </td>
                        <td>
                          {row.total ? `${row.done} / ${row.total}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
