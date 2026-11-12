import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  completeRoadmapStep,
  fetchMyRoadmap,
  fetchRoadmap,
  fetchSocial,
  saveRoadmapChecklist,
  saveRoadmapNotes,
  startRoadmap,
  undoRoadmapStep,
} from './api'
import { useSession } from './session'

const TrailContext = createContext(null)
export const useTrail = () => useContext(TrailContext)

const newOp = () => crypto.randomUUID()

/** Roles authored before units existed get one linear unit so the path still renders. */
function unitsOf(role) {
  if (role.units?.length) return role.units
  return [{ id: 'trail', kind: 'skill', title: `${role.title} trail`, skill: '' }]
}

export function TrailProvider({ children }) {
  const { user, profile } = useSession()
  const roleId = profile?.selectedRole?.id || ''
  const [pack, setPack] = useState(null)
  const [mine, setMine] = useState(null)
  const [me, setMe] = useState(null) // XP, streak, quests
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const revisionRef = useRef(0)
  const completeOp = useRef('')

  const role = pack?.role || null
  const trail = useMemo(
    () => (mine?.trails || []).find((t) => t.roleId === role?.id && t.version === role?.version && !t.missingContent) || null,
    [mine, role]
  )
  revisionRef.current = trail?.revision ?? revisionRef.current

  const load = useCallback(async () => {
    if (!user || !roleId) {
      setPack(null)
      setMine(null)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [owner, latest] = await Promise.all([fetchMyRoadmap(), fetchRoadmap(roleId)])
      const saved = (owner?.trails || []).filter((t) => t.roleId === roleId && !t.missingContent)
      const preferred = saved.find((t) => t.active) || saved[saved.length - 1]
      let data = latest
      if (preferred?.version && preferred.version !== latest?.role?.version) {
        data = await fetchRoadmap(roleId, preferred.version)
      }
      setMine(owner)
      setPack(data)
      fetchSocial().then((s) => setMe(s.me)).catch(() => {})
    } catch (err) {
      setLoadError(err.message || 'Your path could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [user, roleId])

  useEffect(() => {
    load()
  }, [load])

  const reloadMine = useCallback(async () => {
    const owner = await fetchMyRoadmap()
    setMine(owner)
    return owner
  }, [])

  // First visit to the path enrols the student in their chosen role. No separate "start" screen.
  const enrolling = useRef(false)
  useEffect(() => {
    if (!role || trail || !profile?.selectedRole || enrolling.current || loading) return
    enrolling.current = true
    startRoadmap({ roleId: role.id, opId: newOp() })
      .then(reloadMine)
      .catch((err) => setActionError(err.message || 'Could not start your path.'))
      .finally(() => {
        enrolling.current = false
      })
  }, [role, trail, profile?.selectedRole, loading, reloadMine])

  const stepState = useMemo(() => {
    const map = {}
    for (const s of trail?.steps || []) map[s.id] = s
    return map
  }, [trail])

  const units = useMemo(() => {
    if (!role) return []
    return unitsOf(role).map((unit) => {
      const steps = role.steps
        .filter((s) => (role.units?.length ? s.unit === unit.id : true))
        .map((s) => ({ ...s, state: stepState[s.id]?.state || 'locked', ticks: stepState[s.id]?.checklist || {} }))
      const done = steps.filter((s) => s.state === 'completed').length
      return { ...unit, steps, done, total: steps.length, finished: steps.length > 0 && done === steps.length }
    })
  }, [role, stepState])

  const tryUnit = units.find((u) => u.kind === 'try') || null
  const skillUnits = units.filter((u) => u.kind === 'skill')
  const outdated = Boolean(pack && pack.latestVersion && role && pack.latestVersion > role.version)
  const totalDone = trail?.progress?.done || 0
  const totalSteps = role?.steps?.length || 0

  const getStep = useCallback((stepId) => {
    for (const u of units) {
      const s = u.steps.find((x) => x.id === stepId)
      if (s) return { step: s, unit: u }
    }
    return { step: null, unit: null }
  }, [units])

  async function run(fn, fallback) {
    setBusy(true)
    setActionError('')
    try {
      return await fn()
    } catch (err) {
      setActionError(err.message || fallback)
      throw err
    } finally {
      setBusy(false)
    }
  }

  const adoptSocial = (result) => {
    if (result?.social) setMe(result.social)
  }

  async function saveChecks(stepId, checklist) {
    try {
      const saved = await saveRoadmapChecklist({
        opId: newOp(), roleId: role.id, version: role.version, stepId,
        expectedRevision: revisionRef.current, checklist,
      })
      revisionRef.current = saved.revision
      adoptSocial(saved)
      return saved
    } catch (err) {
      if (err.code === 'revision_conflict') await reloadMine()
      throw err
    }
  }

  async function complete(stepId, checklist) {
    const opId = completeOp.current || newOp()
    completeOp.current = opId
    const saved = await run(
      () => completeRoadmapStep({
        opId, roleId: role.id, version: role.version, stepId,
        expectedRevision: revisionRef.current, checklist,
      }),
      'This step was not saved.'
    )
    completeOp.current = ''
    revisionRef.current = saved.revision
    adoptSocial(saved)
    await reloadMine()
    return saved
  }

  async function undo(stepId) {
    const saved = await run(
      () => undoRoadmapStep({
        opId: newOp(), roleId: role.id, version: role.version, stepId, expectedRevision: revisionRef.current,
      }),
      'Could not undo that step.'
    )
    revisionRef.current = saved.revision
    adoptSocial(saved)
    await reloadMine()
    return saved
  }

  const saveNotes = (stepId, text, evidence, expectedRevision) =>
    saveRoadmapNotes({
      opId: newOp(), roleId: role.id, version: role.version, stepId, expectedRevision, text, evidence,
    })

  /** Move to the newest published version of this role (the old attempt is kept). */
  async function upgrade() {
    await run(() => startRoadmap({ roleId: role.id, version: pack.latestVersion, opId: newOp() }), 'Could not update your path.')
    await load()
  }

  const refreshSocial = useCallback(() => fetchSocial().then((s) => setMe(s.me)).catch(() => {}), [])

  const value = {
    role, trail, units, tryUnit, skillUnits, me, setMe, refreshSocial,
    loading, loadError, busy, actionError, setActionError, outdated, totalDone, totalSteps,
    getStep, saveChecks, complete, undo, saveNotes, upgrade, reload: load,
  }
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>
}
