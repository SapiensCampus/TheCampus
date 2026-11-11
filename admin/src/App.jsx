import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { ADMIN_EMAIL, auth, googleProvider } from './firebase'
import {
  batchDeleteQuestions,
  createCollege,
  createDepartment,
  createInvite,
  createQuestion,
  deactivateInvite,
  deleteQuestion,
  exportQuestions,
  getCampus,
  importQuestions,
  listColleges,
  listInvites,
  listQuestions,
  updateCampus,
  updateCollege,
  updateDepartment,
  updateInvite,
  updateQuestion,
} from './api'
import RoadmapAdmin from './RoadmapAdmin'
import UsersAdmin from './UsersAdmin'
import './App.css'

function EditIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function TrashIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

const EMPTY_QUESTION = {
  id: '',
  area: 'R',
  title: '',
  cue: '',
  icon: 'spark',
  scene: '',
  sortOrder: 0,
  active: true,
}

const AREA_COLORS = {
  R: 'mint',
  I: 'sky',
  A: 'lilac',
  S: 'yellove',
  E: 'peach',
  C: 'mint',
}

function Window({ title, children, actions }) {
  return (
    <section className="window">
      <div className="window-bar">
        <div className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="title">{title}</div>
        {actions}
      </div>
      <div className="window-body">{children}</div>
    </section>
  )
}

function Flash({ ok, err }) {
  if (!ok && !err) return null
  return (
    <div className={`flash ${err ? 'err' : 'ok'}`} role="status">
      <span className="mono">{err ? 'Error' : 'Done'}</span>
      <div>{err || ok}</div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="pulse" aria-hidden="true" />
      <p className="mono">Checking session</p>
      <h2>Hang tight…</h2>
    </div>
  )
}

function LoginScreen({ busy, error, onSignIn }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <span className="sticker">Admin ✳</span>
        <div className="login-hero">
          <img className="mascot" src="/lufy-standing.png" alt="" />
          <p className="mono">Sapiens Campus</p>
          <h1>Admin portal</h1>
          <p>Users, questions, and the boring bits that keep campus humming.</p>
        </div>
        <div className="login-body">
          <p className="hint">
            Sign in with the allowlisted Google account (
            <strong>{ADMIN_EMAIL}</strong>).
          </p>
          <button
            type="button"
            className="btn dark block"
            disabled={busy}
            onClick={onSignIn}
          >
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <Flash err={error} />
        </div>
      </div>
    </div>
  )
}

function NavItem({ id, label, code, active, onClick }) {
  return (
    <button
      type="button"
      className={`nav-item${active ? ' active' : ''}`}
      onClick={() => onClick(id)}
      aria-current={active ? 'page' : undefined}
    >
      <span className="nav-ico">{code}</span>
      {label}
    </button>
  )
}

const RIASEC_ORDER = ['R', 'I', 'A', 'S', 'E', 'C']
/** One discovery set per page: 5 questions × 6 RIASEC types. */
const QUESTIONS_PER_TYPE = 5
const QUESTIONS_PAGE_SIZE = RIASEC_ORDER.length * QUESTIONS_PER_TYPE

function Pager({ page, pageSize, total, hasNext, hasPrev, onPrev, onNext, busy }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total || page * pageSize)
  return (
    <div className="pager">
      <span className="pager-meta mono">
        {total != null
          ? `${from}–${Math.min(to, total)} of ${total}`
          : `Page ${page}`}
      </span>
      <div className="pager-actions">
        <button type="button" className="btn sm ghost" disabled={!hasPrev || busy} onClick={onPrev}>
          ← Prev
        </button>
        <button type="button" className="btn sm ghost" disabled={!hasNext || busy} onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [tab, setTab] = useState('users')
  const [menuOpen, setMenuOpen] = useState(false)
  const [questionsPage, setQuestionsPage] = useState(1)
  const [pack, setPack] = useState(null)
  const [invites, setInvites] = useState([])
  const [colleges, setColleges] = useState([])
  const [departments, setDepartments] = useState([])
  const [campus, setCampus] = useState({ whatsappUrl: '' })
  const [inviteForm, setInviteForm] = useState({
    code: '',
    label: '',
    maxLimit: 50,
    active: true,
  })
  const [collegeForm, setCollegeForm] = useState({
    name: '',
    sortOrder: 0,
    active: true,
  })
  const [deptForm, setDeptForm] = useState({
    name: '',
    sortOrder: 0,
    active: true,
  })
  const [selectedIds, setSelectedIds] = useState([])
  const [importPrompt, setImportPrompt] = useState(null)
  const [form, setForm] = useState(EMPTY_QUESTION)
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(
    () =>
      onAuthStateChanged(auth, async (next) => {
        if (!next) {
          setUser(null)
          return
        }
        const email = (next.email || '').toLowerCase()
        if (email !== ADMIN_EMAIL) {
          await signOut(auth)
          setUser(null)
          setError(`Only ${ADMIN_EMAIL} can access admin.`)
          return
        }
        setUser(next)
      }),
    []
  )

  const refresh = useCallback(async () => {
    setError('')
    try {
      if (tab === 'questions') {
        const data = await listQuestions()
        setPack(data.pack)
      } else if (tab === 'invites') {
        const data = await listInvites()
        setInvites(data.invites || [])
      } else if (tab === 'colleges') {
        const data = await listColleges()
        setColleges(data.colleges || [])
        setDepartments(data.departments || [])
      } else if (tab === 'campus') {
        const data = await getCampus()
        setCampus(data.campus || { whatsappUrl: '' })
      }
    } catch (err) {
      setError(err.message)
    }
  }, [tab])

  useEffect(() => {
    if (!user) return
    let active = true
    async function load() {
      try {
        if (tab === 'questions') {
          const data = await listQuestions()
          if (active) setPack(data.pack)
        } else if (tab === 'invites') {
          const data = await listInvites()
          if (active) setInvites(data.invites || [])
        } else if (tab === 'colleges') {
          const data = await listColleges()
          if (active) {
            setColleges(data.colleges || [])
            setDepartments(data.departments || [])
          }
        } else if (tab === 'campus') {
          const data = await getCampus()
          if (active) setCampus(data.campus || { whatsappUrl: '' })
        }
      } catch (err) {
        if (active) setError(err.message)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [user, tab])

  const selectedInPack = useMemo(() => {
    const valid = new Set((pack?.questions || []).map((q) => q.id))
    return selectedIds.filter((id) => valid.has(id))
  }, [pack, selectedIds])

  const questionsByType = useMemo(() => {
    const buckets = Object.fromEntries(RIASEC_ORDER.map((k) => [k, []]))
    for (const q of pack?.questions || []) {
      const area = String(q.area || '').toUpperCase()
      if (!buckets[area]) continue
      buckets[area].push(q)
    }
    for (const key of RIASEC_ORDER) {
      buckets[key].sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id))
      )
    }
    return buckets
  }, [pack])

  const questionsPageCount = useMemo(() => {
    const maxPerType = Math.max(0, ...RIASEC_ORDER.map((k) => questionsByType[k].length))
    return Math.max(1, Math.ceil(maxPerType / QUESTIONS_PER_TYPE))
  }, [questionsByType])

  const pagedQuestions = useMemo(() => {
    const page = Math.min(Math.max(1, questionsPage), questionsPageCount)
    const start = (page - 1) * QUESTIONS_PER_TYPE
    const rows = []
    for (const key of RIASEC_ORDER) {
      rows.push(...questionsByType[key].slice(start, start + QUESTIONS_PER_TYPE))
    }
    return rows
  }, [questionsByType, questionsPage, questionsPageCount])

  const questionsTotal = useMemo(
    () => RIASEC_ORDER.reduce((sum, key) => sum + questionsByType[key].length, 0),
    [questionsByType]
  )

  const activeQuestions = useMemo(
    () => (pack?.questions || []).filter((q) => q.active !== false).length,
    [pack]
  )

  async function onGoogleSignIn() {
    setError('')
    setBusy(true)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const email = (result.user.email || '').toLowerCase()
      if (email !== ADMIN_EMAIL) {
        await signOut(auth)
        setError(`Only ${ADMIN_EMAIL} can access admin.`)
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  function switchTab(next) {
    setTab(next)
    setMenuOpen(false)
    setMessage('')
    setError('')
    setSelectedIds([])
    closeForm()
    if (next === 'questions') setQuestionsPage(1)
  }

  async function onCreateInvite(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createInvite({
        code: inviteForm.code,
        label: inviteForm.label,
        maxLimit: Number(inviteForm.maxLimit),
        active: inviteForm.active !== false,
      })
      setInviteForm({ code: '', label: '', maxLimit: 50, active: true })
      setMessage('Invite code created')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onToggleInvite(invite) {
    setBusy(true)
    setError('')
    try {
      if (invite.active === false) {
        await updateInvite(invite.code, {
          ...invite,
          active: true,
        })
        setMessage(`Reactivated ${invite.code}`)
      } else {
        await deactivateInvite(invite.code)
        setMessage(`Deactivated ${invite.code}`)
      }
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onUpdateInviteLimit(invite, maxLimit) {
    setBusy(true)
    setError('')
    try {
      await updateInvite(invite.code, { ...invite, maxLimit: Number(maxLimit) })
      setMessage(`Updated limit for ${invite.code}`)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onCreateCollege(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createCollege(collegeForm)
      setCollegeForm({ name: '', sortOrder: 0, active: true })
      setMessage('College created')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onToggleCollege(college) {
    setBusy(true)
    setError('')
    try {
      await updateCollege(college.id, {
        ...college,
        active: college.active === false,
      })
      setMessage(`Updated ${college.name}`)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onCreateDepartment(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createDepartment(deptForm)
      setDeptForm({ name: '', sortOrder: 0, active: true })
      setMessage('Department created')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onToggleDepartment(dept) {
    setBusy(true)
    setError('')
    try {
      await updateDepartment(dept.id, { ...dept, active: dept.active === false })
      setMessage(`Updated ${dept.name}`)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onSaveCampus(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await updateCampus({ whatsappUrl: campus.whatsappUrl || '' })
      setMessage('Campus WhatsApp URL saved')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pageMeta = {
    users: {
      mono: 'Students',
      title: 'Users',
      desc: 'Signed-up students with scores, join date, and trail progress in one place.',
      sticker: 'Directory ✳',
    },
    questions: {
      mono: 'RIASEC pack',
      title: 'Questions',
      desc: 'Create, edit, import and export the question pack that powers discovery.',
      sticker: 'Pack editor ✳',
    },
    invites: {
      mono: 'Access',
      title: 'Invite codes',
      desc: 'Campus/batch invite codes with max limit and current consumption.',
      sticker: 'Gate ✳',
    },
    colleges: {
      mono: 'Directory',
      title: 'Colleges & departments',
      desc: 'Independent lists of college names and department names for student signup.',
      sticker: 'Campus map ✳',
    },
    campus: {
      mono: 'Config',
      title: 'Campus',
      desc: 'Optional WhatsApp campus group. Discovery trails live in the student app and do not require the group.',
      sticker: 'Connect ✳',
    },
    roadmaps: {
      mono: 'Trails',
      title: 'Roadmaps',
      desc: 'Build each role trail, then see who is on which step. Student notes stay private.',
      sticker: 'Versioned ✳',
    },
  }[tab] || {
    mono: 'Admin',
    title: 'Admin',
    desc: '',
    sticker: '✳',
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_QUESTION)
  }

  function startCreate() {
    if ((pack?.questions || []).length >= 90) {
      setError(
        'Maximum limit of 90 questions reached. Delete a few questions before creating new ones.'
      )
      return
    }
    setEditingId(null)
    setForm(EMPTY_QUESTION)
    setFormOpen(true)
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function toggleSelect(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  function toggleSelectAll() {
    const list = pack?.questions || []
    if (selectedInPack.length === list.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(list.map((q) => q.id))
    }
  }

  async function saveQuestion(e) {
    e.preventDefault()
    if (!editingId && (pack?.questions || []).length >= 90) {
      setError(
        'Maximum limit of 90 questions reached. Delete a few questions before adding new ones.'
      )
      return
    }
    setBusy(true)
    setMessage('')
    setError('')
    const wasEditing = Boolean(editingId)
    try {
      if (editingId) await updateQuestion(editingId, form)
      else await createQuestion(form)
      closeForm()
      setMessage(wasEditing ? 'Question updated' : 'Question created')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id) {
    if (!confirm(`Delete question ${id}?`)) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await deleteQuestion(id)
      setSelectedIds((prev) => prev.filter((item) => item !== id))
      if (editingId === id) closeForm()
      setMessage(`Deleted ${id}`)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onBatchDelete() {
    if (!selectedInPack.length) return
    const count = selectedInPack.length
    if (
      !confirm(
        `Are you sure you want to delete ${count} question${
          count > 1 ? 's' : ''
        }? This cannot be undone.`
      )
    ) {
      return
    }
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const res = await batchDeleteQuestions(selectedInPack)
      if (editingId && selectedInPack.includes(editingId)) {
        closeForm()
      }
      setSelectedIds([])
      setMessage(`Deleted ${res.deleted ?? count} question${count > 1 ? 's' : ''}`)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onExport() {
    try {
      const data = await exportQuestions()
      const blob = new Blob([JSON.stringify(data.pack, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'questions.export.json'
      a.click()
      URL.revokeObjectURL(url)
      setMessage('Exported questions JSON')
    } catch (err) {
      setError(err.message)
    }
  }

  async function onImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setMessage('')
    try {
      const text = await file.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error('Invalid JSON file format.')
      }

      const rawPack = json.pack || json
      const importedList = Array.isArray(rawPack)
        ? rawPack
        : Array.isArray(rawPack?.questions)
        ? rawPack.questions
        : null

      if (!importedList || !importedList.length) {
        throw new Error(
          'File must contain a questions array (e.g. { "questions": [...] }).'
        )
      }

      const seenIds = new Set()
      const normalizedList = []
      for (let i = 0; i < importedList.length; i++) {
        const item = importedList[i]
        const id = String(item.id || '').trim()
        const area = String(item.area || '').trim().toUpperCase()
        const title = String(item.title || '').trim()

        if (!id) {
          throw new Error(`Question #${i + 1} is missing an "id" field.`)
        }
        if (seenIds.has(id)) {
          throw new Error(
            `Duplicate question ID "${id}" found within the imported file.`
          )
        }
        seenIds.add(id)

        if (!/^[RIASEC]$/.test(area)) {
          throw new Error(
            `Question "${id}" has invalid area "${item.area}". Must be one of R, I, A, S, E, C.`
          )
        }
        if (!title) {
          throw new Error(`Question "${id}" is missing a "title" field.`)
        }

        normalizedList.push({
          ...item,
          id,
          area,
          title,
          cue: String(item.cue || '').trim(),
          icon: String(item.icon || 'spark').trim(),
          scene: String(item.scene || '').trim(),
          sortOrder: Number.isFinite(Number(item.sortOrder))
            ? Number(item.sortOrder)
            : i,
          active: item.active !== false,
        })
      }

      const currentQuestions = pack?.questions || []
      const currentMap = new Map(currentQuestions.map((q) => [q.id, q]))
      const matchingIds = normalizedList
        .map((q) => q.id)
        .filter((id) => currentMap.has(id))
      const newQuestions = normalizedList.filter((q) => !currentMap.has(q.id))

      const promptData = {
        rawPack,
        importedList: normalizedList,
        matchingIds,
        newQuestions,
        currentQuestions,
      }

      if (matchingIds.length > 0) {
        setImportPrompt(promptData)
      } else {
        await executeImport(promptData, false)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      e.target.value = ''
    }
  }

  async function executeImport(promptData, overwrite) {
    setImportPrompt(null)
    setBusy(true)
    setError('')
    setMessage('')

    try {
      const finalMap = new Map(
        promptData.currentQuestions.map((q) => [q.id, { ...q }])
      )

      for (const q of promptData.importedList) {
        if (!finalMap.has(q.id) || overwrite) {
          finalMap.set(q.id, { ...q })
        }
      }

      const resultingQuestions = Array.from(finalMap.values())

      // 1. Capacity check: Max 90 questions
      if (resultingQuestions.length > 90) {
        throw new Error(
          `Total questions cannot exceed 90 (currently at ${promptData.currentQuestions.length}, import would result in ${resultingQuestions.length}). Please delete a few questions and try again.`
        )
      }

      // 2. Proportion check: all 6 RIASEC types must have equal counts
      const counts = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 }
      for (const q of resultingQuestions) {
        if (counts[q.area] === undefined) {
          throw new Error(
            `Invalid question area "${q.area}" for question ${q.id}. Must be R, I, A, S, E, or C.`
          )
        }
        counts[q.area] += 1
      }

      const countValues = Object.values(counts)
      const targetCount = countValues[0]
      const isBalanced = countValues.every((c) => c === targetCount)

      if (!isBalanced) {
        throw new Error(
          `All 6 RIASEC types must have an equal number of questions. Current resulting distribution: R: ${counts.R}, I: ${counts.I}, A: ${counts.A}, S: ${counts.S}, E: ${counts.E}, C: ${counts.C}. Please ensure each type has the same count (up to 15 each, max 90 total).`
        )
      }

      const packPayload = {
        version: promptData.rawPack?.version || pack?.version || 'sc-discovery-1',
        areas: promptData.rawPack?.areas || pack?.areas || {},
        pairs: promptData.rawPack?.pairs || pack?.pairs || {},
        anchors: promptData.rawPack?.anchors || pack?.anchors || [],
        questions: resultingQuestions,
      }

      await importQuestions(packPayload, { overwrite })
      setMessage(
        `Import complete! Pack now has ${resultingQuestions.length} questions (${targetCount} per RIASEC type).`
      )
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(q) {
    setEditingId(q.id)
    setForm({
      id: q.id,
      area: q.area,
      title: q.title || '',
      cue: q.cue || '',
      icon: q.icon || 'spark',
      scene: q.scene || '',
      sortOrder: q.sortOrder ?? 0,
      active: q.active !== false,
    })
    setFormOpen(true)
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (user === undefined) return <LoadingScreen />

  if (!user) {
    return (
      <LoginScreen busy={busy} error={error} onSignIn={onGoogleSignIn} />
    )
  }

  const initial = (user.email || 'A').slice(0, 1).toUpperCase()

  return (
    <div className="shell">
      <header className={`topnav${menuOpen ? ' is-open' : ''}`}>
        <div className="topnav-inner">
          <a className="brand" href="/" onClick={(e) => e.preventDefault()}>
            <img src="/lufy-icon.png" alt="" />
            <div className="brand-text">
              <strong>Sapiens Campus</strong>
              <span>Admin · Explore ✦ Evelve ✦ Engineer</span>
            </div>
          </a>

          <div className="user-chip" title={user.email}>
            {user.photoURL ? (
              <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar">{initial}</span>
            )}
            <div className="meta">
              <strong>{user.displayName || user.email}</strong>
              <span>Allowlisted</span>
            </div>
          </div>

          <button
            type="button"
            className="btn sm dark top-signout"
            onClick={() => signOut(auth)}
          >
            Sign out
          </button>

          <button
            type="button"
            className="nav-toggle"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="burger" />
          </button>
        </div>

        <nav className="side-nav side-nav-mobile" aria-label="Mobile">
          <NavItem
            id="users"
            label="Users"
            code="01"
            active={tab === 'users'}
            onClick={switchTab}
          />
          <NavItem
            id="questions"
            label="Questions"
            code="02"
            active={tab === 'questions'}
            onClick={switchTab}
          />
          <NavItem
            id="invites"
            label="Invites"
            code="03"
            active={tab === 'invites'}
            onClick={switchTab}
          />
          <NavItem
            id="colleges"
            label="Colleges"
            code="04"
            active={tab === 'colleges'}
            onClick={switchTab}
          />
          <NavItem
            id="campus"
            label="Campus"
            code="05"
            active={tab === 'campus'}
            onClick={switchTab}
          />
          <NavItem
            id="roadmaps"
            label="Roadmaps"
            code="06"
            active={tab === 'roadmaps'}
            onClick={switchTab}
          />
          <button
            type="button"
            className="btn sm block mobile-signout"
            onClick={() => signOut(auth)}
          >
            Sign out
          </button>
        </nav>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <nav className="side-nav" aria-label="Admin">
            <NavItem
              id="users"
              label="Users"
              code="01"
              active={tab === 'users'}
              onClick={switchTab}
            />
            <NavItem
              id="questions"
              label="Questions"
              code="02"
              active={tab === 'questions'}
              onClick={switchTab}
            />
            <NavItem
              id="invites"
              label="Invites"
              code="03"
              active={tab === 'invites'}
              onClick={switchTab}
            />
            <NavItem
              id="colleges"
              label="Colleges"
              code="04"
              active={tab === 'colleges'}
              onClick={switchTab}
            />
            <NavItem
              id="campus"
              label="Campus"
              code="05"
              active={tab === 'campus'}
              onClick={switchTab}
            />
            <NavItem
              id="roadmaps"
              label="Roadmaps"
              code="06"
              active={tab === 'roadmaps'}
              onClick={switchTab}
            />
          </nav>
        </aside>

        <main className="main">
          <div className="page-head">
            <div>
              <p className="mono">{pageMeta.mono}</p>
              <h1>{pageMeta.title}</h1>
              <p>{pageMeta.desc}</p>
            </div>
            <span className={`sticker${tab === 'questions' || tab === 'invites' ? ' mint' : ''}`}>
              {pageMeta.sticker}
            </span>
          </div>

          <Flash ok={message} err={error} />

          {tab === 'users' && <UsersAdmin />}

          {tab === 'questions' && (
            <>
              <div className="stats">
                <div className="stat">
                  <span className="label">In pack</span>
                  <strong>{pack?.questions?.length || 0}</strong>
                  <span>total questions</span>
                </div>
                <div className="stat mint">
                  <span className="label">Active</span>
                  <strong>{activeQuestions}</strong>
                  <span>live in product</span>
                </div>
                <div className="stat lilac">
                  <span className="label">Mode</span>
                  <strong style={{ fontSize: '22px' }}>
                    {!formOpen ? 'Browse' : editingId ? 'Edit' : 'Create'}
                  </strong>
                  <span>
                    {!formOpen
                      ? 'list view'
                      : editingId || 'new question'}
                  </span>
                </div>
              </div>

              <Window title="Import · Export">
                <div className="actions-bar">
                  {!formOpen && (
                    <button type="button" className="btn dark sm" onClick={startCreate}>
                      Create question
                    </button>
                  )}
                  <button type="button" className="btn sm" onClick={onExport}>
                    Export JSON
                  </button>
                  <label className="btn sm file-btn">
                    Import JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={onImport}
                    />
                  </label>
                  <a className="btn sm ghost" href="/questions.template.json" download>
                    Download template
                  </a>
                </div>
              </Window>

              {formOpen && (
                <Window title={editingId ? `Edit · ${editingId}` : 'Create question'}>
                  <form className="grid two" onSubmit={saveQuestion}>
                    <label className="field">
                      <span>ID</span>
                      <input
                        value={form.id}
                        disabled={Boolean(editingId)}
                        onChange={(e) => setForm({ ...form, id: e.target.value })}
                        required
                        placeholder="R1"
                        autoFocus
                      />
                    </label>
                    <label className="field">
                      <span>Area</span>
                      <select
                        value={form.area}
                        onChange={(e) => setForm({ ...form, area: e.target.value })}
                      >
                        {'RIASEC'.split('').map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field wide">
                      <span>Title</span>
                      <input
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        required
                      />
                    </label>
                    <label className="field wide">
                      <span>Cue</span>
                      <input
                        value={form.cue}
                        onChange={(e) => setForm({ ...form, cue: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Icon</span>
                      <input
                        value={form.icon}
                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Scene</span>
                      <input
                        value={form.scene}
                        onChange={(e) => setForm({ ...form, scene: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Sort order</span>
                      <input
                        type="number"
                        value={form.sortOrder}
                        onChange={(e) =>
                          setForm({ ...form, sortOrder: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) =>
                          setForm({ ...form, active: e.target.checked })
                        }
                      />
                      Active in pack
                    </label>
                    <div className="wide row">
                      <button disabled={busy} type="submit" className="btn dark">
                        {editingId ? 'Update question' : 'Create question'}
                      </button>
                      <button type="button" className="btn" onClick={closeForm}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </Window>
              )}

              <Window
                title={`Questions · ${pack?.questions?.length || 0}${
                  selectedInPack.length > 0 ? ` (${selectedInPack.length} selected)` : ''
                }`}
              >
                {(pack?.questions || []).length === 0 ? (
                  <div className="empty">
                    <strong>Empty pack</strong>
                    <p className="muted">Create a question or import a JSON pack.</p>
                    <button type="button" className="btn dark sm" onClick={startCreate}>
                      Create question
                    </button>
                  </div>
                ) : (
                  <>
                    {selectedInPack.length > 0 && (
                      <div className="batch-toolbar">
                        <div className="batch-toolbar-info">
                          <span className="tag mint">{selectedInPack.length} selected</span>
                          <span>
                            {selectedInPack.length === (pack?.questions || []).length
                              ? 'All questions selected'
                              : `${selectedInPack.length} of ${pack?.questions?.length || 0} questions selected`}
                          </span>
                        </div>
                        <div className="batch-toolbar-actions">
                          <button
                            type="button"
                            className="btn sm danger"
                            disabled={busy}
                            onClick={onBatchDelete}
                          >
                            <TrashIcon size={14} />
                            Delete selected ({selectedInPack.length})
                          </button>
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => setSelectedIds([])}
                          >
                            Deselect all
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: 44, textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                className="table-check"
                                checked={
                                  (pack?.questions || []).length > 0 &&
                                  selectedInPack.length === (pack?.questions || []).length
                                }
                                ref={(el) => {
                                  if (el) {
                                    el.indeterminate =
                                      selectedInPack.length > 0 &&
                                      selectedInPack.length < (pack?.questions || []).length
                                  }
                                }}
                                onChange={toggleSelectAll}
                                title={
                                  selectedInPack.length === (pack?.questions || []).length
                                    ? 'Deselect all'
                                    : 'Select all'
                                }
                                aria-label="Select all questions"
                              />
                            </th>
                            <th>ID</th>
                            <th>Area</th>
                            <th>Title</th>
                            <th>Active</th>
                            <th style={{ width: 100, textAlign: 'center' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedQuestions.map((q) => {
                            const isSelected = selectedInPack.includes(q.id)
                            return (
                              <tr key={q.id} className={isSelected ? 'selected' : ''}>
                                <td style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    className="table-check"
                                    checked={isSelected}
                                    onChange={() => toggleSelect(q.id)}
                                    aria-label={`Select question ${q.id}`}
                                  />
                                </td>
                                <td>
                                  <span className="tag yellove">{q.id}</span>
                                </td>
                                <td>
                                  <span className={`tag ${AREA_COLORS[q.area] || ''}`}>
                                    {q.area}
                                  </span>
                                </td>
                                <td>{q.title}</td>
                                <td>
                                  <span
                                    className={`tag ${
                                      q.active === false ? 'peach' : 'mint'
                                    }`}
                                  >
                                    {q.active === false ? 'Off' : 'On'}
                                  </span>
                                </td>
                                <td>
                                  <div
                                    className="row"
                                    style={{ justifyContent: 'center', gap: 6 }}
                                  >
                                    <button
                                      type="button"
                                      className="btn-icon"
                                      title={`Edit question ${q.id}`}
                                      aria-label={`Edit question ${q.id}`}
                                      onClick={() => startEdit(q)}
                                    >
                                      <EditIcon />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-icon danger"
                                      title={`Delete question ${q.id}`}
                                      aria-label={`Delete question ${q.id}`}
                                      onClick={() => onDelete(q.id)}
                                    >
                                      <TrashIcon />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Pager
                      page={Math.min(questionsPage, questionsPageCount)}
                      pageSize={QUESTIONS_PAGE_SIZE}
                      total={questionsTotal}
                      hasPrev={questionsPage > 1}
                      hasNext={questionsPage < questionsPageCount}
                      onPrev={() => setQuestionsPage((p) => Math.max(1, p - 1))}
                      onNext={() =>
                        setQuestionsPage((p) => Math.min(questionsPageCount, p + 1))
                      }
                      busy={busy}
                    />
                    <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                      Each page is one discovery set: {QUESTIONS_PER_TYPE} questions ×{' '}
                      {RIASEC_ORDER.length} types ({QUESTIONS_PAGE_SIZE} total), ordered R → I →
                      A → S → E → C.
                    </p>
                  </>
                )}
              </Window>
            </>
          )}

          {tab === 'invites' && (
            <>
              <div className="stats">
                <div className="stat">
                  <span className="label">Codes</span>
                  <strong>{invites.length}</strong>
                  <span>configured</span>
                </div>
                <div className="stat mint">
                  <span className="label">Active</span>
                  <strong>{invites.filter((i) => i.active !== false).length}</strong>
                  <span>usable</span>
                </div>
                <div className="stat sky">
                  <span className="label">Consumed</span>
                  <strong>
                    {invites.reduce((sum, i) => sum + (Number(i.consumption) || 0), 0)}
                  </strong>
                  <span>signups bound</span>
                </div>
              </div>

              <Window title="Create invite code">
                <form className="stack" onSubmit={onCreateInvite}>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                    <label>
                      <span>Code</span>
                      <input
                        required
                        value={inviteForm.code}
                        onChange={(e) =>
                          setInviteForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                        }
                        placeholder="CAMPUS26"
                      />
                    </label>
                    <label>
                      <span>Label</span>
                      <input
                        value={inviteForm.label}
                        onChange={(e) =>
                          setInviteForm((f) => ({ ...f, label: e.target.value }))
                        }
                        placeholder="Batch / college"
                      />
                    </label>
                    <label>
                      <span>Max limit</span>
                      <input
                        type="number"
                        min={1}
                        required
                        value={inviteForm.maxLimit}
                        onChange={(e) =>
                          setInviteForm((f) => ({ ...f, maxLimit: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <button type="submit" className="btn dark sm" disabled={busy}>
                    {busy ? 'Saving…' : 'Create invite'}
                  </button>
                </form>
              </Window>

              <Window title={`Invite codes · ${invites.length}`} actions={
                <button type="button" className="btn sm ghost" onClick={refresh}>
                  Refresh
                </button>
              }>
                {invites.length === 0 ? (
                  <p className="muted">No invite codes yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Label</th>
                          <th>Used</th>
                          <th>Limit</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((invite) => (
                          <tr key={invite.code}>
                            <td>
                              <strong>{invite.code}</strong>
                            </td>
                            <td>{invite.label || '—'}</td>
                            <td>{invite.consumption || 0}</td>
                            <td>
                              <input
                                type="number"
                                min={1}
                                defaultValue={invite.maxLimit}
                                style={{ width: 88 }}
                                onBlur={(e) => {
                                  const next = Number(e.target.value)
                                  if (next && next !== invite.maxLimit) {
                                    onUpdateInviteLimit(invite, next)
                                  }
                                }}
                              />
                            </td>
                            <td>{invite.active === false ? 'Inactive' : 'Active'}</td>
                            <td>
                              <button
                                type="button"
                                className="btn sm ghost"
                                disabled={busy}
                                onClick={() => onToggleInvite(invite)}
                              >
                                {invite.active === false ? 'Reactivate' : 'Deactivate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Window>
            </>
          )}

          {tab === 'colleges' && (
            <>
              <div className="stats">
                <div className="stat">
                  <span className="label">Colleges</span>
                  <strong>{colleges.length}</strong>
                  <span>in directory</span>
                </div>
                <div className="stat mint">
                  <span className="label">Departments</span>
                  <strong>{departments.length}</strong>
                  <span>shared list</span>
                </div>
              </div>

              <Window title="Add college">
                <form className="stack" onSubmit={onCreateCollege}>
                  <label>
                    <span>College name</span>
                    <input
                      required
                      value={collegeForm.name}
                      onChange={(e) =>
                        setCollegeForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder="e.g. Anna University"
                    />
                  </label>
                  <button type="submit" className="btn dark sm" disabled={busy}>
                    {busy ? 'Saving…' : 'Add college'}
                  </button>
                </form>
              </Window>

              <Window title={`Colleges · ${colleges.length}`}>
                {colleges.length === 0 ? (
                  <p className="muted">No colleges yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {colleges.map((college) => (
                          <tr key={college.id}>
                            <td>
                              <strong>{college.name}</strong>
                            </td>
                            <td>{college.active === false ? 'Inactive' : 'Active'}</td>
                            <td>
                              <button
                                type="button"
                                className="btn sm ghost"
                                disabled={busy}
                                onClick={() => onToggleCollege(college)}
                              >
                                {college.active === false ? 'Reactivate' : 'Deactivate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Window>

              <Window title="Add department">
                <form className="stack" onSubmit={onCreateDepartment}>
                  <label>
                    <span>Department name</span>
                    <input
                      required
                      value={deptForm.name}
                      onChange={(e) =>
                        setDeptForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder="e.g. Computer Science"
                    />
                  </label>
                  <button type="submit" className="btn dark sm" disabled={busy}>
                    {busy ? 'Saving…' : 'Add department'}
                  </button>
                </form>
              </Window>

              <Window title={`Departments · ${departments.length}`}>
                {departments.length === 0 ? (
                  <p className="muted">No departments yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map((dept) => (
                          <tr key={dept.id}>
                            <td>
                              <strong>{dept.name}</strong>
                            </td>
                            <td>{dept.active === false ? 'Inactive' : 'Active'}</td>
                            <td>
                              <button
                                type="button"
                                className="btn sm ghost"
                                disabled={busy}
                                onClick={() => onToggleDepartment(dept)}
                              >
                                {dept.active === false ? 'Reactivate' : 'Deactivate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Window>
            </>
          )}

          {tab === 'roadmaps' && <RoadmapAdmin />}

          {tab === 'campus' && (
            <Window title="WhatsApp campus group">
              <form className="stack" onSubmit={onSaveCampus}>
                <label>
                  <span>WhatsApp campus group URL</span>
                  <input
                    value={campus.whatsappUrl || ''}
                    onChange={(e) =>
                      setCampus((c) => ({ ...c, whatsappUrl: e.target.value }))
                    }
                    placeholder="https://chat.whatsapp.com/…"
                  />
                </label>
                <p className="muted" style={{ fontSize: 13 }}>
                  Optional campus group link. It does not unlock or hide a student’s roadmap.
                </p>
                <button type="submit" className="btn dark sm" disabled={busy}>
                  {busy ? 'Saving…' : 'Save campus config'}
                </button>
              </form>
            </Window>
          )}
        </main>
      </div>

      {importPrompt && (
        <div className="modal-backdrop" onClick={() => setImportPrompt(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <Window
              title="Import · Overwrite Confirmation"
              actions={
                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
                  onClick={() => setImportPrompt(null)}
                  title="Close"
                  aria-label="Close confirmation dialog"
                >
                  ✕
                </button>
              }
            >
              <div style={{ display: 'grid', gap: 14 }}>
                <p>
                  The import file contains{' '}
                  <strong>{importPrompt.importedList.length}</strong> question
                  {importPrompt.importedList.length > 1 ? 's' : ''}.
                </p>
                <div className="callout yellove">
                  <strong>
                    {importPrompt.matchingIds.length} existing record
                    {importPrompt.matchingIds.length > 1 ? 's' : ''} with
                    matching ID
                    {importPrompt.matchingIds.length > 1 ? 's' : ''}:
                  </strong>
                  <p className="mono" style={{ fontSize: 12, marginTop: 4 }}>
                    {importPrompt.matchingIds.slice(0, 10).join(', ')}
                    {importPrompt.matchingIds.length > 10
                      ? ` (+${importPrompt.matchingIds.length - 10} more)`
                      : ''}
                  </p>
                </div>
                <p className="muted" style={{ fontSize: 13 }}>
                  Do you want to overwrite the existing records with the
                  imported content, or keep existing records and only append new
                  ones?
                </p>
                <div
                  className="row"
                  style={{ flexWrap: 'wrap', gap: 8, marginTop: 6 }}
                >
                  <button
                    type="button"
                    className="btn dark sm"
                    disabled={busy}
                    onClick={() => executeImport(importPrompt, true)}
                  >
                    Overwrite matching ({importPrompt.matchingIds.length})
                  </button>
                  {importPrompt.newQuestions.length > 0 && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => executeImport(importPrompt, false)}
                    >
                      Keep existing &amp; Append new (
                      {importPrompt.newQuestions.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={busy}
                    onClick={() => setImportPrompt(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Window>
          </div>
        </div>
      )}
    </div>
  )
}
