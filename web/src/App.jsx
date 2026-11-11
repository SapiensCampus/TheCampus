import { useEffect, useMemo, useRef, useState } from 'react'
import {
  checkInvite,
  fetchCollegeStats,
  fetchColleges,
  fetchMe,
  fetchMyRoadmap,
  fetchQuestions,
  peekColleges,
  peekQuestions,
  saveDiscovery,
  saveProfile,
  switchRoadmap,
} from './lib/api'
import {
  QUIZ_LENGTH,
  QUESTIONS_PER_AREA,
  RIASEC_KEYS,
  resolveRoles,
  selectQuizQuestions,
  scoreAnswers,
} from './lib/scoring'
import {
  auth,
  createUserWithEmailAndPassword,
  googleProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from './firebase'
import {
  identifyUser,
  startQuizTrace,
  stopQuizTrace,
  track,
  trackOnce,
  trackScreen,
} from './lib/analytics'
import { avatarForRole } from './lib/roleAvatars'
import RoadmapView from './roadmap/RoadmapView'
import './App.css'

function parseRoadmapHash(hash = '') {
  const match = String(hash).match(/^#roadmap\/([a-z]+)(?:\/([a-z0-9-]+))?$/)
  if (!match) return null
  return { roleId: match[1], stepId: match[2] || '' }
}

const STORAGE_KEY = 'sapiens-campus-discovery-v5'

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY)
    return JSON.parse(raw || 'null')
  } catch {
    return null
  }
}

function saveState(payload) {
  try {
    const raw = JSON.stringify(payload)
    localStorage.setItem(STORAGE_KEY, raw)
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Quota / private mode — ignore.
  }
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

const COACH = [
  'No right answers. Just your first reaction.',
  'Tap a feeling. The next card appears automatically.',
  'Choose for your interest, not your experience.',
  '“Maybe” is a good answer.',
  'Imagine trying it — not being good at it.',
]

const FALLBACK_BOOSTS = [
  {
    id: 'welcome',
    title: 'You’re in.',
    body: 'Discovery here is inspired by Ikigai — where what you love, what you’re good at, what the world needs, and what can pay you start to overlap.',
  },
  {
    id: 'ikigai-intro',
    title: 'How this works',
    body: 'Ikigai means “reason for being.” You don’t need a perfect answer — just honest gut reactions. We’ll turn those into roles you can grow into.',
  },
  {
    id: 'mid-1',
    title: 'Nice pace.',
    body: 'Trivia: people who explore interests early often find paid work they enjoy faster — because they sample more.',
  },
  {
    id: 'mid-2',
    title: 'Halfway energy',
    body: 'You’re mapping curiosity, not talent. Ikigai grows through tiny experiments — this quiz is your first map.',
  },
  {
    id: 'mid-3',
    title: 'Keep going',
    body: 'Trivia: “maybe” is data. Soft yeses often point to skills you can grow into paid roles.',
  },
  {
    id: 'mid-4',
    title: 'Almost there',
    body: 'Your mix becomes Builders, Hackers, Creators, Connectors, Leaders, or Planners — campus roles, not alphabet soup.',
  },
  {
    id: 'mid-5',
    title: 'Last stretch',
    body: 'One more round. Then roles, careers that pay, interesting paths, and peers waiting on WhatsApp.',
  },
]

const PASSOUT_YEARS = Array.from({ length: 12 }, (_, i) => 2028 + i)

function isValidMobile(value) {
  const digits = String(value || '').replace(/\D/g, '')
  let mobile = digits
  if (mobile.length === 12 && mobile.startsWith('91')) mobile = mobile.slice(2)
  else if (mobile.length === 11 && mobile.startsWith('0')) mobile = mobile.slice(1)
  return /^[6-9]\d{9}$/.test(mobile)
}

function Header({ note = true, user, onSignOut, onBrand }) {
  return (
    <header className="site-header">
      <div className="nav-wrap">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            onBrand?.()
          }}
        >
          <img src="/lufy-icon.png" alt="" />
          <span>
            SapiensCampus<span aria-hidden="true">.</span>
          </span>
        </a>
        {user ? (
          <button type="button" className="linkish" onClick={onSignOut}>
            Sign out
          </button>
        ) : note ? (
          <span className="header-note">
            A campus for your kind of curious <span aria-hidden="true">✳</span>
          </span>
        ) : null}
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="site-footer">
      <span>Explore. Evelve. Engineer.</span>
      <span>
        Made for the life beyond class. <span className="y" aria-hidden="true">✳</span>
      </span>
    </footer>
  )
}

function Progress({ answered, total, onBack }) {
  const rounds = Math.ceil(total / RIASEC_KEYS.length) || 5
  const perRound = RIASEC_KEYS.length
  const currentRound = Math.min(
    rounds,
    Math.floor(answered / perRound) + (answered < total ? 1 : rounds)
  )

  return (
    <div className="progress-block">
      <div className="progress-caption">
        {onBack ? (
          <button type="button" className="linkish progress-back" onClick={onBack}>
            ← Back
          </button>
        ) : (
          <span>Round {currentRound} / {rounds}</span>
        )}
        <span className="progress-meta">
          {onBack ? (
            <>
              Round {currentRound} / {rounds}
              <span aria-hidden="true"> · </span>
              {answered} / {total}
            </>
          ) : (
            <>
              {answered} / {total} explored
            </>
          )}
        </span>
      </div>
      <div
        className="round-progress"
        role="progressbar"
        aria-label="Activities explored"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        {Array.from({ length: rounds }, (_, i) => {
          const start = i * perRound
          const inRound = Math.max(0, Math.min(perRound, answered - start))
          const pct = (inRound / perRound) * 100
          return (
            <i key={i}>
              <b style={{ width: `${pct}%` }} />
            </i>
          )
        })}
      </div>
    </div>
  )
}

function BoostCard({ boost, onContinue, cta = 'Continue →' }) {
  if (!boost) return null
  return (
    <section className="screen dots-bg">
      <div className="wrap funnel-card boost-card">
        <p className="eyebrow">Boost ✳</p>
        <h1>{boost.title}</h1>
        <p className="muted boost-body">{boost.body}</p>
        <button type="button" className="btn dark lg" onClick={onContinue}>
          {cta}
        </button>
      </div>
    </section>
  )
}

function collegeCountCopy(count, collegeName) {
  if (!collegeName) return ''
  if (!count || count < 5) return `You’re among the first from ${collegeName}.`
  return `${count} students from ${collegeName} already exploring.`
}

export default function App() {
  const [pack, setPack] = useState(null)
  const [colleges, setColleges] = useState([])
  const [departments, setDepartments] = useState([])
  const [globalWhatsapp, setGlobalWhatsapp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('landing')
  const [quiz, setQuiz] = useState([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [boostIndex, setBoostIndex] = useState(0)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteLabel, setInviteLabel] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [authMode, setAuthMode] = useState('signup')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [showEmailAuth, setShowEmailAuth] = useState(false)
  const [collegeId, setCollegeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [passoutYear, setPassoutYear] = useState('')
  const [mobile, setMobile] = useState('')
  const [collegeCount, setCollegeCount] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyAuth, setBusyAuth] = useState(false)
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [roleConfirmed, setRoleConfirmed] = useState(false)
  const [confirmingRole, setConfirmingRole] = useState(false)
  const [roadmapEntry, setRoadmapEntry] = useState(() => parseRoadmapHash(window.location.hash))
  const [roadmapSummary, setRoadmapSummary] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const profileErrorRef = useRef(null)
  const pendingAuthEvent = useRef(null)
  const appliedUserRef = useRef(null)
  const justConfirmedRole = useRef(false)

  const boosts = pack?.boosts?.length ? pack.boosts : FALLBACK_BOOSTS
  const midBoosts = boosts.filter((b) => String(b.id || '').startsWith('mid-'))
  const introBoost = boosts.find((b) => b.id === 'ikigai-intro') || FALLBACK_BOOSTS[1]

  function applyMe(me) {
    setProfile(me)
    if (me?.inviteCode) setInviteCode(me.inviteCode)
    if (me?.collegeId) {
      setCollegeId(me.collegeId)
      setDepartmentId(me.departmentId || '')
      setPassoutYear(me.passoutYear ? String(me.passoutYear) : '')
      if (me.mobile) setMobile(me.mobile)
    }
    if (me?.selectedRole?.id) {
      setSelectedRoleId(me.selectedRole.id)
      setRoleConfirmed(true)
    }
  }

  function routeAfterAuth(me) {
    setError('')
    if (me?.hasAnswers && me?.roles?.length) {
      setView('results')
      return
    }
    if (me?.collegeId && me?.mobile) {
      setView('intro')
      return
    }
    setView('profile')
  }

  function goGetStarted() {
    setError('')
    track('get_started_click', {
      has_profile: Boolean(profile?.collegeId),
      has_results: Boolean(profile?.hasAnswers),
      signed_in: Boolean(user),
    })
    if (profile?.hasAnswers && profile?.roles?.length) setView('results')
    else if (profile?.collegeId && profile?.mobile) setView('intro')
    else if (user) setView('profile')
    else if (inviteCode) setView('welcome')
    else setView('invite')
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next)
      if (next?.uid) {
        identifyUser(next.uid, {
          auth_provider: next.providerData?.[0]?.providerId || 'unknown',
        })
      }
      setAuthChecked(true)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!view) return
    trackScreen(view)
  }, [view])

  const profileRef = useRef(profile)
  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  useEffect(() => {
    function syncHash() {
      const parsed = parseRoadmapHash(window.location.hash)
      if (parsed) {
        setRoadmapEntry(parsed)
        setView('roadmap')
        return
      }
      setView((current) => {
        if (current !== 'roadmap') return current
        return profileRef.current?.hasAnswers ? 'results' : 'landing'
      })
    }
    window.addEventListener('hashchange', syncHash)
    window.addEventListener('popstate', syncHash)
    return () => {
      window.removeEventListener('hashchange', syncHash)
      window.removeEventListener('popstate', syncHash)
    }
  }, [])

  function openRoadmap(roleId, stepId = '', mode = 'push') {
    const next = stepId ? `#roadmap/${roleId}/${stepId}` : `#roadmap/${roleId}`
    if (window.location.hash !== next) {
      const historyMode = mode === 'replace' ? 'replaceState' : 'pushState'
      window.history[historyMode]({ roadmap: true }, '', next)
    }
    setRoadmapEntry({ roleId, stepId })
    setView('roadmap')
  }

  function goHome() {
    setError('')
    if (view === 'roadmap') {
      leaveRoadmap()
      return
    }
    if (profile?.hasAnswers && profile?.roles?.length) {
      setView('results')
      return
    }
    if (user && profile?.collegeId && profile?.mobile) {
      setView('intro')
      return
    }
    if (user) {
      setView('profile')
      return
    }
    setView('landing')
  }

  function leaveRoadmap() {
    if (window.location.hash.startsWith('#roadmap')) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    setView(profile?.hasAnswers || roleConfirmed ? 'results' : 'landing')
  }

  useEffect(() => {
    let alive = true
    let restored = false

    function restoreSession(qData) {
      if (restored) return
      restored = true
      const saved = loadState()
      if (saved?.inviteCode) {
        setInviteCode(saved.inviteCode)
        setInviteLabel(saved.inviteLabel || '')
      }
      if (saved?.quiz?.length === QUIZ_LENGTH && saved.answers) {
        const ids = new Set((qData.questions || []).map((q) => q.id))
        const stillValid = saved.quiz.every((q) => ids.has(q.id))
        if (stillValid) {
          setQuiz(saved.quiz)
          setAnswers(saved.answers)
          setIndex(Math.min(saved.index || 0, QUIZ_LENGTH - 1))
          setBoostIndex(saved.boostIndex || 0)
        }
      }
      if (saved?.view) setView(saved.view)
      if (saved?.collegeId) setCollegeId(saved.collegeId)
      if (saved?.departmentId) setDepartmentId(saved.departmentId)
      if (saved?.passoutYear) setPassoutYear(String(saved.passoutYear))
      if (saved?.mobile) setMobile(saved.mobile)
      if (saved?.selectedRoleId) setSelectedRoleId(saved.selectedRoleId)
      if (saved?.roleConfirmed) setRoleConfirmed(Boolean(saved.roleConfirmed))
      const fromHash = parseRoadmapHash(window.location.hash)
      if (fromHash) {
        setRoadmapEntry(fromHash)
        setView('roadmap')
      }
    }

    function applyCatalog(qData, cData) {
      setPack(qData)
      setColleges(cData?.colleges || [])
      setDepartments(cData?.departments || [])
      setGlobalWhatsapp(cData?.whatsappUrl || qData?.whatsappUrl || '')
    }

    const warmQ = peekQuestions()
    const warmC = peekColleges()
    if (warmQ) {
      applyCatalog(warmQ, warmC || {})
      restoreSession(warmQ)
      setLoading(false)
    }

    Promise.all([fetchQuestions({ force: true }), fetchColleges({ force: true })])
      .then(([qData, cData]) => {
        if (!alive) return
        applyCatalog(qData, cData)
        restoreSession(qData)
      })
      .catch((err) => {
        if (alive && !warmQ) setError(err.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!user) {
      appliedUserRef.current = null
      setProfile(null)
      return
    }
    if (
      !pendingAuthEvent.current &&
      appliedUserRef.current === user.uid &&
      profileRef.current
    ) {
      return
    }
    let alive = true
    fetchMe()
      .then((data) => {
        if (!alive) return
        const me = data.user
        appliedUserRef.current = user.uid
        applyMe(me)
        const authKind = pendingAuthEvent.current
        if (authKind) {
          pendingAuthEvent.current = null
          const eventName =
            authKind === 'google'
              ? 'sign_in_google_success'
              : authKind === 'signup'
                ? 'sign_up_email_success'
                : 'sign_in_email_success'
          track(eventName, {
            returning: Boolean(me?.collegeId),
            has_results: Boolean(me?.hasAnswers),
          })
          routeAfterAuth(me)
          return
        }
        const entryViews = new Set(['landing', 'invite', 'welcome', 'signup'])
        setError('')
        setView((v) => {
          if (!entryViews.has(v)) return v
          if (me?.hasAnswers && me?.roles?.length) return 'results'
          if (me?.collegeId && me?.mobile) return 'intro'
          return 'profile'
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user])

  useEffect(() => {
    saveState({
      view,
      quiz,
      index,
      answers,
      boostIndex,
      inviteCode,
      inviteLabel,
      collegeId,
      departmentId,
      passoutYear,
      mobile,
      selectedRoleId,
      roleConfirmed,
    })
  }, [
    view,
    quiz,
    index,
    answers,
    boostIndex,
    inviteCode,
    inviteLabel,
    collegeId,
    departmentId,
    passoutYear,
    mobile,
    selectedRoleId,
    roleConfirmed,
  ])

  useEffect(() => {
    if (!collegeId) {
      setCollegeCount(null)
      return
    }
    let active = true
    fetchCollegeStats(collegeId)
      .then((data) => {
        if (active) setCollegeCount(data.signedUpCount || 0)
      })
      .catch(() => {
        if (active) setCollegeCount(null)
      })
    return () => {
      active = false
    }
  }, [collegeId])

  const current = quiz[index]
  const answeredCount = Object.keys(answers).length

  const scores = useMemo(() => {
    if (!quiz.length || answeredCount < quiz.length) return null
    return scoreAnswers(quiz, answers)
  }, [quiz, answers, answeredCount])

  const savedRoles = profile?.roles
  const roleProfile = useMemo(() => {
    if (scores && pack) {
      return resolveRoles(scores, pack.roleMap || {}, { max: 2 })
    }
    if (savedRoles?.length && pack?.roleMap) {
      const roles = savedRoles
        .map((r) => {
          const key = r.key || Object.keys(pack.roleMap).find((k) => pack.roleMap[k]?.id === r.id)
          const meta = (key && pack.roleMap[key]) || {}
          return {
            key,
            score: r.score || 0,
            id: r.id || meta.id,
            name: r.name || meta.name,
            color: meta.color || 'cream',
            icon: meta.icon || 'spark',
            blurb: meta.blurb || '',
            careers: Array.isArray(meta.careers) ? meta.careers : [],
            skills: Array.isArray(meta.skills) ? meta.skills : [],
          }
        })
        .filter((r) => r.name)
      if (!roles.length) return null
      return {
        roles,
        mode: roles.length === 2 ? 'blend' : 'single',
        title:
          roles.length === 2 ? `${roles[0].name} · ${roles[1].name}` : roles[0].name,
        description: roles[0].blurb || '',
        keys: roles.map((r) => r.key).filter(Boolean),
      }
    }
    return null
  }, [scores, pack, savedRoles])

  const selectedCollege = useMemo(
    () => colleges.find((c) => c.id === collegeId) || null,
    [colleges, collegeId]
  )

  const whatsappUrl = globalWhatsapp || pack?.whatsappUrl || ''

  async function onCheckInvite(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    track('invite_submit')
    try {
      const data = await checkInvite(inviteInput)
      setInviteCode(data.code)
      setInviteLabel(data.label || '')
      track('invite_unlocked', { invite_label: data.label || '' })
      setView('welcome')
    } catch (err) {
      track('invite_failed', { error: String(err.message || '').slice(0, 80) })
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function authErrorMessage(err, mode) {
    const code = err?.code || ''
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-login-credentials') {
      return 'That email and password don’t match. Try again, or create an account.'
    }
    if (code === 'auth/email-already-in-use') return 'That email already has an account. Sign in instead.'
    if (code === 'auth/weak-password') return 'Use at least 6 characters.'
    if (code === 'auth/invalid-email') return 'Enter a valid email address.'
    if (code === 'auth/too-many-requests') return 'Too many tries. Wait a moment, then try again.'
    if (code === 'auth/network-request-failed') return 'You appear to be offline. Check your connection and try again.'
    if (mode === 'google') return 'Google sign-in didn’t finish. Try again.'
    return mode === 'signup' ? 'Couldn’t create the account. Try again.' : 'Couldn’t sign in. Try again.'
  }

  async function onGoogleAuth() {
    setBusyAuth(true)
    setError('')
    track('sign_in_google_click')
    try {
      pendingAuthEvent.current = 'google'
      appliedUserRef.current = null
      await signInWithPopup(auth, googleProvider)
      // Profile load + success event happen once in the auth effect.
    } catch (err) {
      pendingAuthEvent.current = null
      if (err.code !== 'auth/popup-closed-by-user') {
        track('sign_in_google_failed', { error: String(err.code || err.message).slice(0, 80) })
        setError(authErrorMessage(err, 'google'))
      } else {
        track('sign_in_google_cancelled')
      }
    } finally {
      setBusyAuth(false)
    }
  }

  async function onEmailAuth(e) {
    e.preventDefault()
    setBusyAuth(true)
    setError('')
    const mode = authMode
    track(mode === 'signup' ? 'sign_up_email_submit' : 'sign_in_email_submit')
    try {
      const email = authForm.email.trim()
      const password = authForm.password
      pendingAuthEvent.current = mode === 'signup' ? 'signup' : 'email'
      appliedUserRef.current = null
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      // Profile load + success event happen once in the auth effect.
    } catch (err) {
      pendingAuthEvent.current = null
      track(mode === 'signup' ? 'sign_up_email_failed' : 'sign_in_email_failed', {
        error: String(err.code || err.message).slice(0, 80),
      })
      setError(authErrorMessage(err, mode))
    } finally {
      setBusyAuth(false)
    }
  }

  function showProfileError(message, code = 'profile_error') {
    setError(message)
    track('profile_failed', {
      error: String(message || '').slice(0, 100),
      code: String(code || '').slice(0, 40),
      has_invite: Boolean(inviteCode || profile?.inviteCode),
      college_id: collegeId || '',
      department_id: departmentId || '',
    })
    requestAnimationFrame(() => {
      profileErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  async function onSaveProfile(e) {
    e.preventDefault()
    if (!user) {
      showProfileError('Please sign in again to continue.', 'not_signed_in')
      setView('welcome')
      return
    }
    setSubmitting(true)
    setError('')
    const codeToUse = String(inviteCode || profile?.inviteCode || inviteInput || '')
      .trim()
      .toUpperCase()
    try {
      if (!codeToUse) {
        showProfileError(
          'Invite code missing — enter the invite code you unlocked with, then try again.',
          'invite_required'
        )
        setSubmitting(false)
        return
      }
      if (!collegeId) {
        showProfileError('Select your college.', 'college_required')
        setSubmitting(false)
        return
      }
      if (!departmentId) {
        showProfileError('Select your department.', 'department_required')
        setSubmitting(false)
        return
      }
      if (!passoutYear) {
        showProfileError('Select your passout year.', 'passout_required')
        setSubmitting(false)
        return
      }
      if (!isValidMobile(mobile)) {
        showProfileError(
          'Enter a valid 10-digit mobile number — the same one you’ll use for campus WhatsApp.',
          'mobile_invalid'
        )
        setSubmitting(false)
        return
      }
      if (!inviteCode && codeToUse) {
        setInviteCode(codeToUse)
      }
      const data = await saveProfile({
        inviteCode: codeToUse,
        collegeId,
        departmentId,
        passoutYear: Number(passoutYear),
        mobile,
        displayName: user.displayName || '',
      })
      setProfile(data.user)
      if (data.user?.inviteCode) setInviteCode(data.user.inviteCode)
      track('profile_completed', {
        college_id: collegeId,
        department_id: departmentId,
        passout_year: Number(passoutYear),
      })
      setError('')
      setView('intro')
    } catch (err) {
      showProfileError(
        err.message || 'Couldn’t save your profile. Please try again.',
        err.code || 'profile_save_failed'
      )
    } finally {
      setSubmitting(false)
    }
  }

  function startQuiz() {
    try {
      if (quiz.length === QUIZ_LENGTH && answeredCount > 0 && answeredCount < quiz.length) {
        setError('')
        setView('quiz')
        return
      }
      const next = selectQuizQuestions(pack.questions)
      if (next.length !== QUIZ_LENGTH) {
        throw new Error(`Expected ${QUIZ_LENGTH} questions, got ${next.length}.`)
      }
      setQuiz(next)
      setAnswers({})
      setIndex(0)
      setBoostIndex(0)
      startQuizTrace()
      track('quiz_started', { question_count: next.length })
      setView('quiz')
      setError('')
    } catch (err) {
      track('quiz_start_failed', { error: String(err.message || '').slice(0, 80) })
      setError(err.message)
      setView('intro')
    }
  }

  function answer(value) {
    if (!current) return
    const next = { ...answers, [current.id]: value }
    setAnswers(next)
    const answered = Object.keys(next).length

    if (answered >= quiz.length) {
      track('quiz_completed', { question_count: answered })
      stopQuizTrace({ questions: String(answered) })
      setView('results')
      return
    }

    if (answered % QUESTIONS_PER_AREA === 0) {
      setBoostIndex(answered / QUESTIONS_PER_AREA - 1)
      track('quiz_milestone', {
        answered,
        milestone: answered / QUESTIONS_PER_AREA,
      })
    }

    setIndex((i) => i + 1)
  }

  function goBack() {
    if (index === 0) {
      setView('intro')
      return
    }
    setIndex((i) => Math.max(0, i - 1))
  }

  const liveTrivia =
    answeredCount >= QUESTIONS_PER_AREA
      ? midBoosts[
          Math.min(
            Math.floor((answeredCount - 1) / QUESTIONS_PER_AREA),
            Math.max(0, midBoosts.length - 1)
          )
        ] || midBoosts[0]
      : null

  useEffect(() => {
    if (!justConfirmedRole.current || view !== 'results' || !roleConfirmed) return
    justConfirmedRole.current = false
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('roadmap')?.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [view, roleConfirmed])

  useEffect(() => {
    if (view !== 'results' || !roleProfile) return
    const roleKey = roleProfile.roles.map((r) => r.id || r.name).join('|')
    trackOnce(`results_view:${roleKey}`, 'results_view', {
      role_count: roleProfile.roles.length,
      roles: roleProfile.roles.map((r) => r.name).join(','),
    })
  }, [view, roleProfile])

  // Single suggested role: prefill selection (still requires Continue). Never preselect a blend.
  useEffect(() => {
    if (view !== 'results' || !roleProfile) return
    if (profile?.selectedRole?.id) {
      setSelectedRoleId(profile.selectedRole.id)
      setRoleConfirmed(true)
      return
    }
    if (roleProfile.roles.length === 1) {
      setSelectedRoleId((prev) => prev || roleProfile.roles[0].id)
      return
    }
    if (roleProfile.roles.length === 2 && !roleConfirmed) {
      // Keep any in-progress choice; do not invent a default for a fresh blend.
      return
    }
  }, [view, roleProfile, profile?.selectedRole?.id, roleConfirmed])

  useEffect(() => {
    if (!user || !profile?.selectedRole?.id) {
      setRoadmapSummary(null)
      return undefined
    }
    let alive = true
    fetchMyRoadmap()
      .then((data) => {
        if (!alive) return
        const active = data?.active
        if (active?.roleId === profile.selectedRole.id) setRoadmapSummary(active.progress || null)
        else setRoadmapSummary(null)
      })
      .catch(() => {
        if (alive) setRoadmapSummary(null)
      })
    return () => {
      alive = false
    }
  }, [user, profile?.selectedRole?.id])

  const suggestedRolePayload = useMemo(() => {
    if (!roleProfile?.roles?.length) return []
    return roleProfile.roles.map((r) => ({
      id: r.id,
      name: r.name,
      key: r.key,
      score: r.score,
    }))
  }, [roleProfile])

  const chosenRole = useMemo(() => {
    if (!selectedRoleId || !roleProfile?.roles?.length) return null
    return roleProfile.roles.find((r) => r.id === selectedRoleId) || null
  }, [selectedRoleId, roleProfile])

  async function confirmSelectedRole() {
    if (!chosenRole) {
      setError('Pick one starting role to continue.')
      return
    }
    if (!user) {
      setError('Please sign in again to save your discovery.')
      return
    }
    const scoresForSave = scores || profile?.scores
    const answersForSave = Object.keys(answers).length ? answers : null
    if (!scoresForSave && !profile?.hasAnswers) {
      setError('Finish the quiz before choosing a role.')
      return
    }
    setConfirmingRole(true)
    setError('')
    const avatar = avatarForRole(chosenRole)
    const selectedRole = {
      id: chosenRole.id,
      name: chosenRole.name,
      key: chosenRole.key,
      score: chosenRole.score,
      animal: avatar?.animal || '',
    }
    const rolesForSave = suggestedRolePayload.length
      ? suggestedRolePayload
      : profile?.roles || []
    try {
      const payload = {
        roles: rolesForSave,
        selectedRole,
      }
      if (answersForSave) payload.answers = answersForSave
      if (scoresForSave) payload.scores = scoresForSave
      await saveDiscovery(payload)
      try {
        const mine = await fetchMyRoadmap()
        if (mine?.active && mine.active.roleId !== selectedRole.id) {
          await switchRoadmap({ roleId: selectedRole.id, opId: crypto.randomUUID() })
        }
      } catch {
        // The role choice is already saved. The trail switch can be retried from the roadmap.
      }
      setRoleConfirmed(true)
      justConfirmedRole.current = true
      setProfile((p) =>
        p
          ? {
              ...p,
              hasAnswers: true,
              roles: rolesForSave,
              selectedRole,
              scores: scoresForSave || p.scores || null,
            }
          : p
      )
      track('role_selected', {
        selected_role: selectedRole.id,
        suggested_count: rolesForSave.length,
        animal: selectedRole.animal,
      })
    } catch (err) {
      track('role_select_failed', {
        error: String(err.message || '').slice(0, 80),
        code: String(err.code || '').slice(0, 40),
      })
      setError(err.message || 'Couldn’t save your role choice.')
    } finally {
      setConfirmingRole(false)
    }
  }

  async function onSignOut() {
    track('sign_out')
    await signOut(auth)
    appliedUserRef.current = null
    pendingAuthEvent.current = null
    setProfile(null)
    setSelectedRoleId('')
    setRoleConfirmed(false)
    setAnswers({})
    setQuiz([])
    setIndex(0)
    clearState()
    setView('landing')
  }

  function retakeQuiz() {
    track('retake_quiz_click')
    setAnswers({})
    setQuiz([])
    setIndex(0)
    setBoostIndex(0)
    setSelectedRoleId('')
    setRoleConfirmed(false)
    if (profile?.collegeId && profile?.mobile) {
      setView('intro')
      return
    }
    if (user) {
      setView('profile')
      return
    }
    setView(inviteCode ? 'welcome' : 'landing')
  }

  function onWhatsAppClick() {
    track('whatsapp_join_click', {
      has_url: Boolean(whatsappUrl),
      college_id: collegeId || '',
    })
  }

  if (loading || !authChecked) {
    return (
      <div className="boot">
        <div className="pulse" aria-hidden="true" />
        <p className="mono">Loading discovery</p>
        <h2>Hang tight…</h2>
      </div>
    )
  }

  if (error && !pack) {
    return (
      <div className="err-screen">
        <Header note={false} />
        <h1>Couldn’t load questions</h1>
        <p className="muted">{error}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Header
        user={user}
        onSignOut={onSignOut}
        onBrand={goHome}
      />

      {error && !['quiz', 'invite', 'welcome', 'profile', 'results', 'roadmap'].includes(view) && (
        <div className="wrap" style={{ paddingTop: 16 }}>
          <p className="status" role="alert">
            {error}
          </p>
        </div>
      )}

      {view === 'landing' && (
        <>
          <section className="hero-band">
            <div className="wrap hero">
              <div>
                <p className="eyebrow">
                  <span className="star" aria-hidden="true">
                    ✳
                  </span>
                  Your digital campus, beyond college
                </p>
                <h1>
                  Your campus.
                  <br />
                  Without
                  <br />
                  the <span className="hl">limits.</span>
                </h1>
                <p className="hero-desc">
                  Find what makes you, <em>you.</em> Meet your people across
                  colleges. Build the things you wish existed.
                </p>
                <div className="hero-actions">
                  <button type="button" className="btn dark lg" onClick={goGetStarted}>
                    Get started ✳
                  </button>
                </div>
                <div className="hero-footnote">
                  <span className="faces" aria-hidden="true">
                    <i>:)</i>
                    <i>:D</i>
                    <i>;)</i>
                  </span>
                  <span>
                    Invite unlock · about 2 minutes · Google or email signup
                    <br />
                    <strong>Discover yourself. Find your people.</strong>
                  </span>
                </div>
              </div>

              <div className="campus-visual">
                <div className="campus-window">
                  <div className="window-bar">
                    <span className="dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>Campus.exe</span>
                    <span aria-hidden="true">✳</span>
                  </div>
                  <div className="campus-map">
                    <button
                      type="button"
                      className="map-card"
                      onClick={() => setView('invite')}
                    >
                      <span className="top">
                        <span>01</span>
                        <span>→</span>
                      </span>
                      <strong>Explore</strong>
                      <span>Find your kind of curious.</span>
                    </button>
                    <div className="map-card">
                      <span className="top">
                        <span>02</span>
                        <span className="soon">Next up</span>
                      </span>
                      <strong>Evelve</strong>
                      <span>Good people. New perspectives.</span>
                    </div>
                    <div className="map-card">
                      <span className="top">
                        <span>03</span>
                        <span className="soon">Next up</span>
                      </span>
                      <strong>Engineer</strong>
                      <span>Small starts. Real things.</span>
                    </div>
                  </div>
                  <div className="window-status">Your journey starts with an invite.</div>
                </div>
                <div className="sticker" aria-hidden="true">
                  Come as
                  <br />
                  you are.
                  <small>✳ ✳ ✳</small>
                </div>
              </div>
            </div>
          </section>
          <div className="manifesto" aria-label="Explore. Evelve. Engineer.">
            <div>
              <span>Explore yourself</span>
              <b aria-hidden="true">✳</b>
              <span>Evelve together</span>
              <b aria-hidden="true">✳</b>
              <span>Engineer the new</span>
              <b aria-hidden="true">✳</b>
            </div>
          </div>
        </>
      )}

      {view === 'invite' && (
        <section className="screen dots-bg">
          <div className="wrap funnel-card">
            <button type="button" className="linkish" onClick={() => setView('landing')}>
              ← Back
            </button>
            <p className="eyebrow">Unlock discovery</p>
            <h1>
              Got an
              <br />
              <span className="intro-hl">invite code?</span>
            </h1>
            <p className="muted" style={{ marginBottom: 18, maxWidth: '36ch' }}>
              SapiensCampus opens with a code — so the first wave stays intentional.
            </p>
            <form className="stack" onSubmit={onCheckInvite}>
              <label className="field">
                <span className="field-label">Invite code</span>
                <input
                  required
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
                  placeholder="CAMPUS26"
                  autoComplete="off"
                  aria-invalid={error ? 'true' : undefined}
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error} Check the code and try again.
                </p>
              )}
              <button type="submit" className="btn dark lg" disabled={submitting}>
                {submitting ? 'Checking…' : 'Unlock →'}
              </button>
            </form>
          </div>
        </section>
      )}

      {view === 'welcome' && (
        <section className="screen dots-bg welcome-ikigai">
          <div className="wrap welcome-shell">
            <button type="button" className="linkish welcome-back" onClick={() => setView('invite')}>
              ← Back
            </button>

            <div className="ikigai-grid">
              <div className="ikigai-copy">
                <p className="eyebrow">
                  <span className="star" aria-hidden="true">
                    ✳
                  </span>
                  You’re unlocked{inviteLabel ? ` · ${inviteLabel}` : ''}
                </p>
                <h1 id="explore-ikigai-title">
                  Find the overlap.
                  <br />
                  Find <span className="hl">your Ikigai.</span>
                </h1>
                <p className="ikigai-lead">
                  A short quiz turns what you enjoy into a campus role you can try.
                </p>

                <div className="welcome-auth">
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn dark lg welcome-google"
                    disabled={busyAuth}
                    onClick={onGoogleAuth}
                  >
                    {busyAuth ? 'Opening…' : 'Sign in with Google'}
                  </button>

                  {!showEmailAuth ? (
                    <button
                      type="button"
                      className="linkish email-auth-link"
                      onClick={() => {
                        setShowEmailAuth(true)
                        track('email_auth_open')
                      }}
                    >
                      Sign up or sign in with email
                    </button>
                  ) : (
                    <div className="email-auth-panel">
                      <form className="stack" onSubmit={onEmailAuth}>
                        <label className="field">
                          <span className="field-label">Email</span>
                          <input
                            type="email"
                            required
                            value={authForm.email}
                            onChange={(e) =>
                              setAuthForm((f) => ({ ...f, email: e.target.value }))
                            }
                            autoComplete="email"
                            placeholder="you@college.edu"
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Password</span>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={authForm.password}
                            onChange={(e) =>
                              setAuthForm((f) => ({ ...f, password: e.target.value }))
                            }
                            autoComplete={
                              authMode === 'signup' ? 'new-password' : 'current-password'
                            }
                            placeholder="At least 6 characters"
                          />
                        </label>
                        <button
                          type="submit"
                          className="btn dark welcome-google"
                          disabled={busyAuth}
                        >
                          {busyAuth
                            ? 'Working…'
                            : authMode === 'signup'
                              ? 'Create account →'
                              : 'Sign in →'}
                        </button>
                      </form>
                      <button
                        type="button"
                        className="linkish email-auth-link"
                        onClick={() =>
                          setAuthMode((m) => (m === 'signup' ? 'signin' : 'signup'))
                        }
                      >
                        {authMode === 'signup'
                          ? 'Already have an account? Sign in'
                          : 'Need an account? Sign up'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <figure className="ikigai-figure">
                <img
                  src="/ikigai.png"
                  alt="Ikigai diagram: what you love, what you’re good at, what people need, and what you can earn from — your Ikigai"
                />
              </figure>
            </div>
          </div>
        </section>
      )}

      {view === 'profile' && (
        <section className="screen dots-bg">
          <div className="wrap funnel-card">
            <p className="eyebrow">Almost ready</p>
            <h1>
              Where do you
              <br />
              study?
            </h1>
            <p className="muted" style={{ marginBottom: 16, maxWidth: '40ch' }}>
              Pick your college and department from the campus lists — then we’ll show who’s already exploring with you.
            </p>
            {error && (
              <div className="form-error" role="alert" ref={profileErrorRef}>
                <strong>Couldn’t continue</strong>
                <p>{error}</p>
              </div>
            )}
            <form className="stack" onSubmit={onSaveProfile}>
              {!(inviteCode || profile?.inviteCode) && (
                <label className="field">
                  <span className="field-label">Invite code</span>
                  <input
                    required
                    value={inviteInput}
                    onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
                    placeholder="CAMPUS26"
                    autoComplete="off"
                  />
                  <span className="field-hint">
                    Your unlock code was lost from this session — enter it again to continue.
                  </span>
                </label>
              )}
              <label className="field">
                <span className="field-label">College</span>
                <select
                  required
                  value={collegeId}
                  onChange={(e) => setCollegeId(e.target.value)}
                >
                  <option value="">Select college</option>
                  {colleges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {collegeId && collegeCount !== null && (
                <p className="college-count">
                  {collegeCountCopy(collegeCount, selectedCollege?.name)}
                </p>
              )}
              <label className="field">
                <span className="field-label">Department</span>
                <select
                  required
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Passout year</span>
                <select
                  required
                  value={passoutYear}
                  onChange={(e) => setPassoutYear(e.target.value)}
                >
                  <option value="">Select year</option>
                  {PASSOUT_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Mobile number</span>
                <input
                  type="tel"
                  required
                  inputMode="numeric"
                  autoComplete="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="10-digit mobile"
                  pattern="[6-9][0-9]{9}"
                />
                <span className="field-hint">For the campus WhatsApp group.</span>
              </label>
              <button type="submit" className="btn dark lg" disabled={submitting}>
                {submitting ? 'Saving…' : 'Continue to discovery →'}
              </button>
            </form>
          </div>
        </section>
      )}

      {view === 'intro' && (
        <BoostCard
          boost={introBoost}
          cta={
            quiz.length === QUIZ_LENGTH && answeredCount > 0 && answeredCount < quiz.length
              ? 'Continue your quiz →'
              : 'Start the 30 prompts →'
          }
          onContinue={startQuiz}
        />
      )}

      {view === 'quiz' && current && (
        <section className="screen dots-bg quiz-screen">
          <div className="quiz-wrap">
            <Progress answered={answeredCount} total={quiz.length} onBack={goBack} />

            {liveTrivia ? (
              <div
                key={boostIndex}
                className="trivia-strip"
                role="status"
                aria-live="polite"
              >
                <span className="trivia-label">Trivia ✳</span>
                <p>
                  <strong>{liveTrivia.title}</strong> {liveTrivia.body}
                </p>
              </div>
            ) : (
              <div className="coach">
                <span className="face" aria-hidden="true">
                  :)
                </span>
                <p>{COACH[index % COACH.length]}</p>
              </div>
            )}

            <div className="q-stack">
              <article className="q-card" key={current.id}>
                <div className="q-top">
                  <span>Would you enjoy this?</span>
                  <span>
                    {String(index + 1).padStart(2, '0')} / {quiz.length}
                  </span>
                </div>
                <div className="q-body">
                  <div className="q-icon" aria-hidden="true">
                    ✳
                  </div>
                  {current.scene && <p className="scene">{current.scene}</p>}
                  <h1>{current.title}</h1>
                  {current.cue && <p className="cue">{current.cue}</p>}
                </div>
              </article>
            </div>

            <div className="reactions" role="group" aria-label="Your reaction">
              {(pack.anchors || []).map((a) => (
                <button
                  key={a.value}
                  type="button"
                  className={`reaction ${a.color || ''}`}
                  onClick={() => answer(a.value)}
                >
                  <strong>{a.label}</strong>
                  <span>{a.detail}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {view === 'results' && roleProfile && (
        <section className="results">
          <div className="wrap">
            <div className="result-copy result-lead">
              <p className="eyebrow">Your discovery</p>
              <h1>{roleProfile.title}</h1>
              <p className="desc">{roleProfile.description}</p>
              {!(roleConfirmed && chosenRole) && (
                <p className="muted result-note">
                  A starting point, not a fixed label. Pick the role you want to try first.
                </p>
              )}
              {selectedCollege && collegeCount !== null && (
                <p className="college-count" style={{ marginTop: 12 }}>
                  {collegeCountCopy(collegeCount, selectedCollege.name)}
                </p>
              )}
            </div>

            {roleConfirmed && chosenRole && (
              <section className="waitlist" id="roadmap">
                <div>
                  <p className="eyebrow">Next step</p>
                  <h2 style={{ fontSize: 'clamp(28px, 5vw, 36px)', margin: '8px 0 12px' }}>
                    {roadmapSummary
                      ? `Continue your ${chosenRole.name} trail`
                      : `Start your ${chosenRole.name} trail`}
                  </h2>
                  <p className="muted" style={{ fontSize: 14, maxWidth: '48ch' }}>
                    Ten short steps. Finish one to unlock the next. Notes stay private.
                  </p>
                  {roadmapSummary && (
                    <p className="roadmap-progress" style={{ marginTop: 8 }}>
                      {roadmapSummary.done || 0} / {roadmapSummary.total || 10} steps saved
                    </p>
                  )}
                </div>
                <div className="waitlist-form">
                  <button
                    type="button"
                    className="btn dark block"
                    onClick={() => openRoadmap(chosenRole.id)}
                  >
                    {roadmapSummary ? 'Continue your trail →' : 'Start your trail →'}
                  </button>
                  {whatsappUrl ? (
                    <a
                      className="linkish"
                      href={whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={onWhatsAppClick}
                    >
                      Optional: join the WhatsApp group
                    </a>
                  ) : null}
                </div>
              </section>
            )}

            {roleProfile.roles.length === 0 ? (
              <div className="mix-panel" style={{ marginTop: 20 }}>
                <p className="muted">
                  No strong role signal yet. Try the quiz again when you’re ready — or retake
                  with fresh gut reactions.
                </p>
                <button type="button" className="btn dark" onClick={retakeQuiz}>
                  Take the quiz again →
                </button>
              </div>
            ) : (
              <>
                <fieldset className="role-pick" disabled={roleConfirmed && Boolean(profile?.selectedRole?.id)}>
                  <legend className="role-pick-legend">
                    {roleProfile.roles.length === 2
                      ? 'Choose one to start. You can change it later.'
                      : 'Your starting role'}
                  </legend>
                  <div
                    className={`role-pick-grid${roleProfile.roles.length === 1 ? ' one' : ''}`}
                  >
                    {roleProfile.roles.map((role) => {
                      const avatar = avatarForRole(role)
                      const checked = selectedRoleId === role.id
                      return (
                        <label
                          key={role.id}
                          className={`role-avatar-card${checked ? ' selected' : ''}${roleConfirmed && checked ? ' confirmed' : ''}`}
                        >
                          <input
                            type="radio"
                            name="selected-campus-role"
                            value={role.id}
                            checked={checked}
                            disabled={roleConfirmed && Boolean(profile?.selectedRole?.id)}
                            onChange={() => {
                              setSelectedRoleId(role.id)
                              setRoleConfirmed(false)
                            }}
                          />
                          {avatar ? (
                            <img src={avatar.src} alt={avatar.alt} width={160} height={160} />
                          ) : (
                            <div className="role-avatar-fallback" aria-hidden="true">
                              {role.name.slice(0, 1)}
                            </div>
                          )}
                          <strong>{role.name}</strong>
                          {avatar && <span className="role-animal">{avatar.animal}</span>}
                          <span className="role-blurb">{role.blurb}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>

                {error && view === 'results' && (
                  <div className="form-error" role="alert" style={{ marginTop: 16 }}>
                    <strong>Couldn’t save</strong>
                    <p>{error}</p>
                  </div>
                )}

                <div
                  className={`result-actions role-confirm-actions${
                    !roleConfirmed || !profile?.selectedRole?.id ? ' is-pending' : ''
                  }`}
                >
                  {!roleConfirmed || !profile?.selectedRole?.id ? (
                    <button
                      type="button"
                      className="btn dark lg"
                      disabled={confirmingRole}
                      onClick={confirmSelectedRole}
                    >
                      {confirmingRole ? 'Saving…' : 'Continue with this role →'}
                    </button>
                  ) : null}
                  {roleConfirmed && profile?.selectedRole?.id && (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        setRoleConfirmed(false)
                      }}
                    >
                      Change starting role
                    </button>
                  )}
                  <button type="button" className="linkish" onClick={retakeQuiz}>
                    Take the quiz again
                  </button>
                </div>
              </>
            )}

            {roleConfirmed && chosenRole && (
              <>
                <div className="result-grid">
                  <section className="mix-panel role-panel">
                    <p className="eyebrow">{chosenRole.name}</p>
                    <h2>Roles in industry</h2>
                    <div className="career-list">
                      {chosenRole.careers.map((c) => (
                        <div key={c.title} className="career-row">
                          <strong>{c.title}</strong>
                          <span
                            className={`career-tag ${c.tag === 'pays' ? 'pays' : 'interesting'}`}
                          >
                            {c.tag === 'pays' ? 'Pays well' : 'Interesting'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="dir-label">Skills to grow</p>
                    <div className="tags">
                      {chosenRole.skills.map((s) => (
                        <span key={s} className="tag">
                          {s}
                        </span>
                      ))}
                    </div>
                  </section>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {view === 'roadmap' && roadmapEntry && (
        <RoadmapView
          user={user}
          profile={profile}
          roleId={roadmapEntry.roleId}
          stepId={roadmapEntry.stepId}
          onOpenStep={(nextStepId) => openRoadmap(roadmapEntry.roleId, nextStepId)}
          onCloseStep={() => {
            if (window.history.state?.roadmap && roadmapEntry.stepId) {
              window.history.back()
              return
            }
            openRoadmap(roadmapEntry.roleId, '', 'replace')
          }}
          onChangeRole={(nextRoleId) => openRoadmap(nextRoleId)}
          onExit={leaveRoadmap}
          onSelectedRole={(selectedRole) => {
            setProfile((current) => (current ? { ...current, selectedRole } : current))
            setSelectedRoleId(selectedRole.id)
            setRoleConfirmed(true)
          }}
        />
      )}

      {view === 'landing' || view === 'results' ? <Footer /> : null}
    </div>
  )
}
