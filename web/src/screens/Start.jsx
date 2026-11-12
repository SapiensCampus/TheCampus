import { useEffect, useState } from 'react'
import { PASSOUT_YEARS, useSession } from '../lib/session'
import { track } from '../lib/analytics'
import { LufySays } from '../components/Chrome'

/** Duolingo-style onboarding frame: back + progress on top, one thing in the middle, CTA at the bottom. */
function Frame({ step, of, onBack, children, cta, ctaDisabled, onCta, ctaBusy, secondary, reason }) {
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
        {ctaDisabled && reason && <p className="muted" role="status">{reason}</p>}
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
      <Frame step={1} of={5} onBack={() => go('/')} cta="Unlock" ctaDisabled={!code.trim()} reason="Type your invite code to continue." ctaBusy={submitting}>
        <LufySays>Got a code from your campus group? Type it in.</LufySays>
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
          You’re unlocked{inviteLabel ? ` · ${inviteLabel}` : ''}. Sign in to save your path.
        </LufySays>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!showEmail ? (
          <button
            type="button"
            className="linkish email-auth-link"
            onClick={() => {
              setShowEmail(true)
              track('email_auth_open')
            }}
          >
            Use email instead
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
      <div className="lesson-foot">
        <button type="button" className="btn dark lg block" disabled={busyAuth} onClick={onGoogleAuth}>
          {busyAuth ? 'Opening…' : 'Continue with Google'}
        </button>
      </div>
    </div>
  )
}

function collegeCountCopy(count, name) {
  if (!name) return ''
  if (!count || count < 5) return `You’re among the first from ${name}.`
  return `${count} students from ${name} already exploring.`
}

const PROFILE_STEPS = ['name', 'college', 'department', 'year', 'mobile']

/** One question per screen: name → college → department → passout year → mobile. */
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

  // Prefill with the first word of the sign-in name; the student can change it.
  useEffect(() => {
    if (!s.nickname) s.setNickname(String(s.profile?.displayName || s.user?.displayName || '').trim().split(/\s+/)[0] || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ready = {
    name: s.nickname.trim().length > 0,
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
    name: 'What should we call you? A first name or nickname is fine.',
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
        reason={{ name: 'Add a name to continue.', college: 'Pick your college to continue.', department: 'Pick your department to continue.', year: 'Pick your passout year to continue.', mobile: 'Enter your 10-digit mobile number to continue.' }[key]}
        ctaBusy={s.submitting}
      >
        <LufySays>{prompt}</LufySays>
        {key === 'name' && (
          <label className="field">
            <span className="field-label">First name or nickname</span>
            <input required maxLength={30} autoComplete="given-name" value={s.nickname} onChange={(e) => s.setNickname(e.target.value)} />
            <span className="field-hint">This is the name classmates see on the leaderboard.</span>
          </label>
        )}
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

/** Before the quiz: how it works. The leaderboard opt-in waits until they have seen XP and streaks. */
export function Intro() {
  const s = useSession()
  return (
    <Frame
      step={5}
      of={5}
      onBack={() => s.go('/start/profile')}
      cta={s.resumable ? 'Continue your quiz' : 'Start the quiz'}
      onCta={s.startQuiz}
    >
      <LufySays>{s.introBoost.body}</LufySays>
      <p className="muted">30 quick cards, about 5 minutes. No right answers. You earn 20 XP at the end.</p>
      {s.error && (
        <p className="form-error" role="alert">
          {s.error}
        </p>
      )}
    </Frame>
  )
}
