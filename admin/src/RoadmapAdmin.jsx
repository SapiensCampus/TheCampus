import { useEffect, useMemo, useState } from 'react'
import {
  getRoadmapCatalog,
  getRoadmapEditor,
  publishRoadmap,
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

/** Unit titles and careers for the student path. Unit ids and kinds stay fixed. */
function PathEditor({ role, setRole }) {
  const patchUnit = (id, patch) =>
    setRole((cur) => ({ ...cur, units: cur.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) }))
  const patchCareer = (index, patch) =>
    setRole((cur) => ({ ...cur, careers: cur.careers.map((c, i) => (i === index ? { ...c, ...patch } : c)) }))
  const careers = role.careers || []
  return (
    <div className="stack path-editor">
      <h3>Units</h3>
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
      <h3>Careers</h3>
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
    </div>
  )
}

export default function RoadmapAdmin() {
  const [view, setView] = useState('steps')
  const [roleId, setRoleId] = useState('builders')
  const [role, setRole] = useState(null)
  const [baseIds, setBaseIds] = useState([])
  const [stepIndex, setStepIndex] = useState(0)
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
    if (!roleId) return undefined
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
  }, [roleId])

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

  return (
    <section className="roadmap-admin stack">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      {(
        <>
          <div className="role-switch" role="group" aria-label="Role">
            {ROLES.map((id) => (
              <button key={id} type="button" className={`btn sm ${roleId === id ? 'dark' : ''}`} aria-pressed={roleId === id} onClick={() => setRoleId(id)}>
                {id}
              </button>
            ))}
          </div>
          {role && (
            <div className="roadmap-modes" role="group" aria-label="Edit">
              <button type="button" className={`btn sm ${view === 'steps' ? 'dark' : ''}`} aria-pressed={view === 'steps'} onClick={() => setView('steps')}>
                Trail steps
              </button>
              <button type="button" className={`btn sm ${view === 'path' ? 'dark' : ''}`} aria-pressed={view === 'path'} onClick={() => setView('path')}>
                Units and careers
              </button>
            </div>
          )}
          {role && view === 'path' && role.units?.length > 0 && (
            <div className="path-panel">
              <PathEditor role={role} setRole={setRole} />
              <div className="roadmap-actions">
                <button type="button" className="btn dark" disabled={busy} onClick={onPublish}>
                  {busy ? 'Saving…' : 'Publish changes'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={onSaveDraft}>
                  Save draft
                </button>
              </div>
            </div>
          )}
          {role && step && view === 'steps' && (
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
        </>
      )}

    </section>
  )
}
