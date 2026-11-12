import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
} from './api'
import {
  QUIZ_LENGTH,
  QUESTIONS_PER_AREA,
  resolveRoles,
  selectQuizQuestions,
  scoreAnswers,
} from './scoring'
import {
  auth,
  createUserWithEmailAndPassword,
  googleProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from '../firebase'
import { identifyUser, startQuizTrace, stopQuizTrace, track, trackScreen } from './analytics'
import { avatarForRole } from './roleAvatars'

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
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

export const FALLBACK_BOOSTS = [
  {
    id: 'ikigai-intro',
    title: 'How this works',
    body: 'Ikigai means “reason for being.” You don’t need a perfect answer — just honest gut reactions. We’ll turn those into roles you can grow into.',
  },
  { id: 'mid-1', title: 'Nice pace.', body: 'Trying a few things is how you find out what you like. That is all this quiz asks.' },
  { id: 'mid-2', title: 'Halfway energy', body: 'You’re mapping curiosity, not talent. Ikigai grows through tiny experiments — this quiz is your first map.' },
  { id: 'mid-3', title: 'Keep going', body: 'A “maybe” still tells us something. Keep answering honestly.' },
  { id: 'mid-4', title: 'Almost there', body: 'Your mix becomes Builders, Hackers, Creators, Connectors, Leaders, or Planners — campus roles, not alphabet soup.' },
  { id: 'mid-5', title: 'Last stretch', body: 'One more round. Then your path, careers and peers.' },
]

export const PASSOUT_YEARS = Array.from({ length: 12 }, (_, i) => 2028 + i)

export function isValidMobile(value) {
  let mobile = String(value || '').replace(/\D/g, '')
  if (mobile.length === 12 && mobile.startsWith('91')) mobile = mobile.slice(2)
  else if (mobile.length === 11 && mobile.startsWith('0')) mobile = mobile.slice(1)
  return /^[6-9]\d{9}$/.test(mobile)
}

export function authErrorMessage(err, mode) {
  const code = err?.code || ''
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) {
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

export const PATHS = {
  landing: '/',
  invite: '/start/invite',
  signin: '/start/signin',
  profile: '/start/profile',
  intro: '/start/intro',
  quiz: '/quiz',
  result: '/result',
  path: '/path',
}
const ENTRY_PATHS = new Set(['/', PATHS.invite, PATHS.signin])

const SessionContext = createContext(null)
export const useSession = () => useContext(SessionContext)

export function SessionProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname

  const [pack, setPack] = useState(null)
  const [colleges, setColleges] = useState([])
  const [departments, setDepartments] = useState([])
  const [globalWhatsapp, setGlobalWhatsapp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [quiz, setQuiz] = useState([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [boostIndex, setBoostIndex] = useState(0)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteLabel, setInviteLabel] = useState('')
  const [collegeId, setCollegeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [passoutYear, setPassoutYear] = useState('')
  const [mobile, setMobile] = useState('')
  const [nickname, setNickname] = useState('')
  const [collegeCount, setCollegeCount] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyAuth, setBusyAuth] = useState(false)
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [roleConfirmed, setRoleConfirmed] = useState(false)
  const [confirmingRole, setConfirmingRole] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const pendingAuthEvent = useRef(null)
  const appliedUserRef = useRef(null)
  const profileRef = useRef(profile)
  profileRef.current = profile

  const boosts = pack?.boosts?.length ? pack.boosts : FALLBACK_BOOSTS
  const midBoosts = boosts.filter((b) => String(b.id || '').startsWith('mid-'))
  const introBoost = boosts.find((b) => b.id === 'ikigai-intro') || FALLBACK_BOOSTS[0]

  const go = (path, opts) => navigate(path, opts)

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

  /** Where a signed-in student belongs. */
  function homeFor(me) {
    if (me?.selectedRole?.id) return PATHS.path
    if (me?.hasAnswers && me?.roles?.length) return PATHS.result
    if (me?.collegeId && me?.mobile) return PATHS.intro
    return PATHS.profile
  }

  function goGetStarted() {
    setError('')
    track('get_started_click', {
      has_profile: Boolean(profile?.collegeId),
      has_results: Boolean(profile?.hasAnswers),
      signed_in: Boolean(user),
    })
    if (user && profile) go(homeFor(profile))
    else if (user) go(PATHS.profile)
    else go(inviteCode ? PATHS.signin : PATHS.invite)
  }

  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      if (next?.uid) {
        identifyUser(next.uid, { auth_provider: next.providerData?.[0]?.providerId || 'unknown' })
      }
      setAuthChecked(true)
    })
  }, [])

  useEffect(() => {
    trackScreen(location.pathname)
  }, [location.pathname])

  // Catalog + saved quiz session.
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
        if (saved.quiz.every((q) => ids.has(q.id))) {
          setQuiz(saved.quiz)
          setAnswers(saved.answers)
          setIndex(Math.min(saved.index || 0, QUIZ_LENGTH - 1))
          setBoostIndex(saved.boostIndex || 0)
        }
      }
      if (saved?.collegeId) setCollegeId(saved.collegeId)
      if (saved?.departmentId) setDepartmentId(saved.departmentId)
      if (saved?.passoutYear) setPassoutYear(String(saved.passoutYear))
      if (saved?.mobile) setMobile(saved.mobile)
      if (saved?.selectedRoleId) setSelectedRoleId(saved.selectedRoleId)
      if (saved?.roleConfirmed) setRoleConfirmed(Boolean(saved.roleConfirmed))
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

  // Load the student's profile when they sign in.
  useEffect(() => {
    if (!user) {
      appliedUserRef.current = null
      setProfile(null)
      return undefined
    }
    if (!pendingAuthEvent.current && appliedUserRef.current === user.uid && profileRef.current) {
      return undefined
    }
    let alive = true
    fetchMe()
      .then((data) => {
        if (!alive) return
        const me = data.user
        appliedUserRef.current = user.uid
        applyMe(me)
        setError('')
        const authKind = pendingAuthEvent.current
        if (authKind) {
          pendingAuthEvent.current = null
          track(
            authKind === 'google' ? 'sign_in_google_success' : authKind === 'signup' ? 'sign_up_email_success' : 'sign_in_email_success',
            { returning: Boolean(me?.collegeId), has_results: Boolean(me?.hasAnswers) }
          )
          go(homeFor(me))
        } else if (ENTRY_PATHS.has(pathRef.current)) {
          go(homeFor(me), { replace: true })
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    saveState({
      quiz, index, answers, boostIndex, inviteCode, inviteLabel,
      collegeId, departmentId, passoutYear, mobile, selectedRoleId, roleConfirmed,
    })
  }, [quiz, index, answers, boostIndex, inviteCode, inviteLabel, collegeId, departmentId, passoutYear, mobile, selectedRoleId, roleConfirmed])

  useEffect(() => {
    if (!collegeId) {
      setCollegeCount(null)
      return undefined
    }
    let active = true
    fetchCollegeStats(collegeId)
      .then((data) => active && setCollegeCount(data.signedUpCount || 0))
      .catch(() => active && setCollegeCount(null))
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
    if (scores && pack) return resolveRoles(scores, pack.roleMap || {}, { max: 2 })
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
        title: roles.length === 2 ? `${roles[0].name} · ${roles[1].name}` : roles[0].name,
        description: roles[0].blurb || '',
        keys: roles.map((r) => r.key).filter(Boolean),
      }
    }
    return null
  }, [scores, pack, savedRoles])

  const selectedCollege = useMemo(() => colleges.find((c) => c.id === collegeId) || null, [colleges, collegeId])
  const chosenRole = useMemo(
    () => (selectedRoleId && roleProfile?.roles?.find((r) => r.id === selectedRoleId)) || null,
    [selectedRoleId, roleProfile]
  )
  const whatsappUrl = globalWhatsapp || pack?.whatsappUrl || ''

  // Single suggested role pre-fills (still needs Continue). A fresh blend is never preselected.
  useEffect(() => {
    if (!roleProfile) return
    if (profile?.selectedRole?.id) {
      setSelectedRoleId(profile.selectedRole.id)
      setRoleConfirmed(true)
    } else if (roleProfile.roles.length === 1) {
      setSelectedRoleId((prev) => prev || roleProfile.roles[0].id)
    }
  }, [roleProfile, profile?.selectedRole?.id])

  async function onCheckInvite(code) {
    setSubmitting(true)
    setError('')
    track('invite_submit')
    try {
      const data = await checkInvite(code)
      setInviteCode(data.code)
      setInviteLabel(data.label || '')
      track('invite_unlocked', { invite_label: data.label || '' })
      go(PATHS.signin)
    } catch (err) {
      track('invite_failed', { error: String(err.message || '').slice(0, 80) })
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function onGoogleAuth() {
    setBusyAuth(true)
    setError('')
    track('sign_in_google_click')
    try {
      pendingAuthEvent.current = 'google'
      appliedUserRef.current = null
      await signInWithPopup(auth, googleProvider)
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

  async function onEmailAuth({ mode, email, password }) {
    setBusyAuth(true)
    setError('')
    track(mode === 'signup' ? 'sign_up_email_submit' : 'sign_in_email_submit')
    try {
      pendingAuthEvent.current = mode === 'signup' ? 'signup' : 'email'
      appliedUserRef.current = null
      if (mode === 'signup') await createUserWithEmailAndPassword(auth, email.trim(), password)
      else await signInWithEmailAndPassword(auth, email.trim(), password)
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
  }

  /** Validates the onboarding fields and saves them. `extraInvite` is used when the code was lost. */
  async function onSaveProfile(extraInvite = '') {
    if (!user) {
      showProfileError('Please sign in again to continue.', 'not_signed_in')
      go(PATHS.signin)
      return
    }
    setSubmitting(true)
    setError('')
    const codeToUse = String(inviteCode || profile?.inviteCode || extraInvite || '').trim().toUpperCase()
    try {
      if (!codeToUse) return showProfileError('Invite code missing — enter the invite code you unlocked with, then try again.', 'invite_required')
      if (!collegeId) return showProfileError('Select your college.', 'college_required')
      if (!departmentId) return showProfileError('Select your department.', 'department_required')
      if (!passoutYear) return showProfileError('Select your passout year.', 'passout_required')
      if (!nickname.trim()) return showProfileError('Tell us what to call you.', 'name_required')
      if (!isValidMobile(mobile)) {
        return showProfileError('Enter a valid 10-digit mobile number — the same one you’ll use for campus WhatsApp.', 'mobile_invalid')
      }
      if (!inviteCode) setInviteCode(codeToUse)
      const data = await saveProfile({
        inviteCode: codeToUse,
        collegeId,
        departmentId,
        passoutYear: Number(passoutYear),
        mobile,
        displayName: nickname.trim().slice(0, 30),
      })
      setProfile(data.user)
      if (data.user?.inviteCode) setInviteCode(data.user.inviteCode)
      track('profile_completed', { college_id: collegeId, department_id: departmentId, passout_year: Number(passoutYear) })
      go(PATHS.intro)
    } catch (err) {
      showProfileError(err.message || 'Couldn’t save your profile. Please try again.', err.code || 'profile_save_failed')
    } finally {
      setSubmitting(false)
    }
  }

  const resumable = quiz.length === QUIZ_LENGTH && answeredCount > 0 && answeredCount < quiz.length

  function startQuiz() {
    try {
      if (resumable) {
        setError('')
        go(PATHS.quiz)
        return
      }
      const next = selectQuizQuestions(pack.questions)
      if (next.length !== QUIZ_LENGTH) throw new Error(`Expected ${QUIZ_LENGTH} questions, got ${next.length}.`)
      setQuiz(next)
      setAnswers({})
      setIndex(0)
      setBoostIndex(0)
      startQuizTrace()
      track('quiz_started', { question_count: next.length })
      setError('')
      go(PATHS.quiz)
    } catch (err) {
      track('quiz_start_failed', { error: String(err.message || '').slice(0, 80) })
      setError(err.message)
      go(PATHS.intro)
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
      go(PATHS.result)
      return
    }
    if (answered % QUESTIONS_PER_AREA === 0) {
      setBoostIndex(answered / QUESTIONS_PER_AREA - 1)
      track('quiz_milestone', { answered, milestone: answered / QUESTIONS_PER_AREA })
    }
    setIndex((i) => i + 1)
  }

  function quizBack() {
    if (index === 0) go(PATHS.intro)
    else setIndex((i) => Math.max(0, i - 1))
  }

  const liveTrivia =
    answeredCount >= QUESTIONS_PER_AREA
      ? midBoosts[Math.min(Math.floor((answeredCount - 1) / QUESTIONS_PER_AREA), Math.max(0, midBoosts.length - 1))] || midBoosts[0]
      : null

  async function confirmSelectedRole() {
    if (!chosenRole) return setError('Pick one starting role to continue.')
    if (!user) return setError('Please sign in again to save your discovery.')
    const scoresForSave = scores || profile?.scores
    if (!scoresForSave && !profile?.hasAnswers) return setError('Finish the quiz before choosing a role.')
    setConfirmingRole(true)
    setError('')
    const avatar = avatarForRole(chosenRole)
    const selectedRole = {
      id: chosenRole.id, name: chosenRole.name, key: chosenRole.key, score: chosenRole.score, animal: avatar?.animal || '',
    }
    const rolesForSave = roleProfile.roles.map((r) => ({ id: r.id, name: r.name, key: r.key, score: r.score }))
    try {
      const payload = { roles: rolesForSave, selectedRole }
      if (Object.keys(answers).length) payload.answers = answers
      if (scoresForSave) payload.scores = scoresForSave
      await saveDiscovery(payload)
      try {
        const mine = await fetchMyRoadmap()
        if (mine?.active && mine.active.roleId !== selectedRole.id) {
          await switchRoadmap({ roleId: selectedRole.id, opId: crypto.randomUUID() })
        }
      } catch {
        // Role is saved; the trail switch can be retried from the path.
      }
      setRoleConfirmed(true)
      setProfile((p) =>
        p ? { ...p, hasAnswers: true, roles: rolesForSave, selectedRole, scores: scoresForSave || p.scores || null } : p
      )
      track('role_selected', { selected_role: selectedRole.id, suggested_count: rolesForSave.length, animal: selectedRole.animal })
      go(PATHS.path)
    } catch (err) {
      track('role_select_failed', { error: String(err.message || '').slice(0, 80), code: String(err.code || '').slice(0, 40) })
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
    go(PATHS.landing)
  }

  function retakeQuiz() {
    track('retake_quiz_click')
    setAnswers({})
    setQuiz([])
    setIndex(0)
    setBoostIndex(0)
    setSelectedRoleId('')
    setRoleConfirmed(false)
    if (profile?.collegeId && profile?.mobile) go(PATHS.intro)
    else if (user) go(PATHS.profile)
    else go(inviteCode ? PATHS.signin : PATHS.landing)
  }

  /** Switching role from the path (trail hook calls this once the server accepted it). */
  function applySelectedRole(selectedRole) {
    setProfile((p) => (p ? { ...p, selectedRole } : p))
    setSelectedRoleId(selectedRole.id)
    setRoleConfirmed(true)
  }

  const value = {
    // data
    pack, colleges, departments, whatsappUrl, loading, authChecked, error, user, profile,
    inviteCode, inviteLabel, collegeId, departmentId, passoutYear, mobile, nickname, collegeCount, selectedCollege,
    quiz, index, answers, current, answeredCount, boostIndex, liveTrivia, introBoost, resumable,
    roleProfile, chosenRole, selectedRoleId,
    // flags
    submitting, busyAuth, confirmingRole, roleConfirmed,
    // setters for form fields
    setError, setCollegeId, setDepartmentId, setPassoutYear, setMobile, setNickname, setSelectedRoleId, setRoleConfirmed,
    // actions
    go, goGetStarted, homeFor, onCheckInvite, onGoogleAuth, onEmailAuth, onSaveProfile, startQuiz, answer, quizBack,
    confirmSelectedRole, onSignOut, retakeQuiz, applySelectedRole,
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
