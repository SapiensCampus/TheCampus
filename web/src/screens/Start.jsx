import { useEffect, useState } from 'react'
import { PASSOUT_YEARS, useSession } from '../lib/session'
import { setLeagueVisible } from '../lib/api'
import { track } from '../lib/analytics'
import { Header, LufySays } from '../components/Chrome'

/** Duolingo-style onboarding frame: back + progress on top, one thing in the middle, CTA at the bottom. */
function Frame({ step, of, onBack, children, cta, ctaDisabled, onCta, ctaBusy, secondary }) {
  return (
    <div className="onboard">
      <div className="onboard-top">
        <button type="button" className="lesson-x" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="lesson-bar" role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={step} aria-label="Setup progress">
          <b style={{ width: `${(step / of) * 100}%` }} />
        </div>
      </div>
      <div className="onboard-body">{children}</div>
      <div className="lesson-foot">
        {secondary}
        <button type="submit" className="btn dark lg block" disabled={ctaDisabled || ctaBusy} onClick={onCta}>
          {ctaBusy ? 'Working…' : cta}
        </button>
      </div>
    </div>
  )
}

export function Invite() {
  const { onCheckInvite, submitting, error, go } = useSession()
  const [code, setCode] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onCheckInvite(code)
      }}
    >
      <Frame step={1} of={5} onBack={() => go('/')} cta="Unlock" ctaDisabled={!code.trim()} ctaBusy={submitting}>
        <LufySays>Got an invite code? SapiensCampus opens with a code so the first wave stays intentional.</LufySays>
        <label className="field">
          <span className="field-label">Invite code</span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
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
      </Frame>
    </form>
  )
}

export function SignIn() {
  const { inviteLabel, error, busyAuth, onGoogleAuth, onEmailAuth, go } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signup')
  const [showEmail, setShowEmail] = useState(false)
  return (
    <div className="onboard">
      <div className="onboard-top">
        <button type="button" className="lesson-x" onClick={() => go('/start/invite')} aria-label="Back">
          ←
        </button>
        <div className="lesson-bar" role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={2} aria-label="Setup progress">
          <b style={{ width: '40%' }} />
        </div>
      </div>
      <div className="onboard-body">
        <LufySays>
          You’re unlocked{inviteLabel ? ` · ${inviteLabel}` : ''}. Create your account to save your path.
        </LufySays>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn dark lg block" disabled={busyAuth} onClick={onGoogleAuth}>
          {busyAuth ? 'Opening…' : 'Continue with Google'}
        </button>
        {!showEmail ? (
          <button
            type="button"
            className="linkish email-auth-link"
            onClick={() => {
              setShowEmail(true)
              track('email_auth_open')
            }}
          >
            Sign up or sign in with email
          </button>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              onEmailAuth({ mode, email, password })
            }}
          >
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@college.edu" />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="At least 6 characters"
              />
            </label>
            <button type="submit" className="btn dark lg block" disabled={busyAuth}>
              {busyAuth ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            <button type="button" className="linkish email-auth-link" onClick={() => setMode((m) => (m === 'signup' ? 'signin' : 'signup'))}>
              {mode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function collegeCountCopy(count, name) {
  if (!name) return ''
  if (!count || count < 5) return `You’re among the first from ${name}.`
  return `${count} students from ${name} already exploring.`
}

const PROFILE_STEPS = ['college', 'department', 'year', 'mobile']

/** One question per screen: college → department → passout year → mobile. */
export function ProfileSteps() {
  const s = useSession()
  const [step, setStep] = useState(0)
  const [inviteInput, setInviteInput] = useState('')
  const needsInvite = !(s.inviteCode || s.profile?.inviteCode)
  const key = PROFILE_STEPS[step]

  // Errors from a failed save belong to the last screen; clear them when moving back.
  useEffect(() => {
    s.setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const ready = {
    college: Boolean(s.collegeId),
    department: Boolean(s.departmentId),
    year: Boolean(s.passoutYear),
    mobile: s.mobile.replace(/\D/g, '').length >= 10 && (!needsInvite || inviteInput.trim()),
  }[key]

  function next(e) {
    e.preventDefault()
    if (step < PROFILE_STEPS.length - 1) setStep(step + 1)
    else s.onSaveProfile(inviteInput)
  }

  const prompt = {
    college: 'Where do you study? Pick your college.',
    department: 'Which department are you in?',
    year: 'When do you finish college?',
    mobile: 'Last one. Your mobile number, for the campus WhatsApp group.',
  }[key]

  return (
    <form onSubmit={next}>
      <Frame
        step={3 + step / PROFILE_STEPS.length}
        of={5}
        onBack={() => (step ? setStep(step - 1) : s.go('/start/signin'))}
        cta={step === PROFILE_STEPS.length - 1 ? 'Save and continue' : 'Continue'}
        ctaDisabled={!ready}
        ctaBusy={s.submitting}
      >
        <LufySays>{prompt}</LufySays>
        {key === 'college' && (
          <>
            <label className="field">
              <span className="field-label">College</span>
              <select required value={s.collegeId} onChange={(e) => s.setCollegeId(e.target.value)}>
                <option value="">Select college</option>
                {s.colleges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {s.collegeId && s.collegeCount !== null && (
              <p className="college-count">{collegeCountCopy(s.collegeCount, s.selectedCollege?.name)}</p>
            )}
          </>
        )}
        {key === 'department' && (
          <label className="field">
            <span className="field-label">Department</span>
            <select required value={s.departmentId} onChange={(e) => s.setDepartmentId(e.target.value)}>
              <option value="">Select department</option>
              {s.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {key === 'year' && (
          <label className="field">
            <span className="field-label">Passout year</span>
            <select required value={s.passoutYear} onChange={(e) => s.setPassoutYear(e.target.value)}>
              <option value="">Select year</option>
              {PASSOUT_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
        {key === 'mobile' && (
          <>
            <label className="field">
              <span className="field-label">Mobile number</span>
              <input
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel"
                value={s.mobile}
                onChange={(e) => s.setMobile(e.target.value)}
                placeholder="10-digit mobile"
                pattern="[6-9][0-9]{9}"
              />
            </label>
            {needsInvite && (
              <label className="field">
                <span className="field-label">Invite code</span>
                <input required value={inviteInput} onChange={(e) => setInviteInput(e.target.value.toUpperCase())} placeholder="CAMPUS26" autoComplete="off" />
                <span className="field-hint">Your unlock code was lost from this session. Enter it again.</span>
              </label>
            )}
          </>
        )}
        {s.error && (
          <div className="form-error" role="alert">
            <strong>Couldn’t continue</strong>
            <p>{s.error}</p>
          </div>
        )}
      </Frame>
    </form>
  )
}

/** Before the quiz: how it works, plus the opt-in for the college league. */
export function Intro() {
  const s = useSession()
  const [join, setJoin] = useState(s.profile?.leagueVisible === true)
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      if (join) await setLeagueVisible(true)
    } catch {
      // Not blocking: they can switch it on later from Profile.
    }
    setBusy(false)
    s.startQuiz()
  }

  return (
    <Frame
      step={5}
      of={5}
      onBack={() => s.go('/start/profile')}
      cta={s.resumable ? 'Continue your quiz' : 'Start the quiz'}
      ctaBusy={busy}
      onCta={start}
    >
      <LufySays>{s.introBoost.body}</LufySays>
      <p className="muted">30 quick cards, about 5 minutes. No right answers. You earn 20 XP at the end.</p>
      <label className="check-card">
        <input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} />
        <span>
          <strong>Show me on my college leaderboard</strong>
          <small>Only your name, college, role, XP and streak. You can turn this off any time.</small>
        </span>
      </label>
      {s.error && (
        <p className="form-error" role="alert">
          {s.error}
        </p>
      )}
    </Frame>
  )
}

export function StartHeader() {
  return <Header />
}
