import { useEffect } from 'react'
import { useSession } from '../lib/session'
import { avatarForRole } from '../lib/roleAvatars'
import { trackOnce } from '../lib/analytics'
import { LufySays } from '../components/Chrome'

/** Role reveal. Pick one starting role (never preselected for a blend), then go to the path. */
export default function Result() {
  const s = useSession()
  const { roleProfile, selectedRoleId, confirmingRole, error, chosenRole, quiz, answers } = s

  useEffect(() => {
    if (!roleProfile) return
    const roleKey = roleProfile.roles.map((r) => r.id || r.name).join('|')
    trackOnce(`results_view:${roleKey}`, 'results_view', {
      role_count: roleProfile.roles.length,
      roles: roleProfile.roles.map((r) => r.name).join(','),
    })
  }, [roleProfile])

  // Opened without a finished quiz: send them where they belong.
  useEffect(() => {
    if (!roleProfile && s.authChecked && !s.loading) s.go(s.profile ? s.homeFor(s.profile) : '/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleProfile])
  if (!roleProfile) return null

  const two = roleProfile.roles.length === 2
  const loved = chosenRole?.key
    ? (quiz || []).filter((q) => q.area === chosenRole.key && answers?.[q.id] === 2).slice(0, 2).map((q) => q.title)
    : []
  return (
    <>
      <div className="onboard reveal">
        <div className="onboard-body">
          <LufySays>
            {two ? 'You’re a blend! Pick the one you want to try first. You can change it later.' : 'Here’s where your curiosity points.'}
          </LufySays>
          <p className="eyebrow">Your discovery</p>
          <h1>{roleProfile.title}</h1>
          <fieldset className="role-pick">
            <legend className="role-pick-legend">{two ? 'Choose one to start' : 'Your starting role'}</legend>
            <div className={`role-pick-grid${two ? '' : ' one'}`}>
              {roleProfile.roles.map((role) => {
                const avatar = avatarForRole(role)
                const checked = selectedRoleId === role.id
                return (
                  <label key={role.id} className={`role-avatar-card${checked ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="selected-campus-role"
                      value={role.id}
                      checked={checked}
                      onChange={() => {
                        s.setSelectedRoleId(role.id)
                        s.setRoleConfirmed(false)
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
          {chosenRole && (
            <>
              <p className="desc">{chosenRole.blurb || roleProfile.description}</p>
              {loved.length > 0 && <p className="muted">Because you said “I’d love it” to: {loved.join('; ')}.</p>}
              <ul className="tiles"><li className="tile y"><small>Quiz XP</small><b>+20</b></li></ul>
            </>
          )}
          {error && (
            <div className="form-error" role="alert">
              <strong>Couldn’t save</strong>
              <p>{error}</p>
            </div>
          )}
        </div>
        <div className="lesson-foot">
          {!selectedRoleId && <p className="muted" role="status">Pick one role to continue.</p>}
          <button type="button" className="btn dark lg block" disabled={!selectedRoleId || confirmingRole} onClick={s.confirmSelectedRole}>
            {confirmingRole ? 'Saving…' : 'Continue with this role'}
          </button>
          <button type="button" className="linkish" onClick={s.retakeQuiz}>
            Take the quiz again
          </button>
        </div>
      </div>
    </>
  )
}
