import { NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useTrail } from '../lib/trail'
import { avatarForRole } from '../lib/roleAvatars'

export function Header({ note = true }) {
  const { user, onSignOut, go } = useSession()
  return (
    <header className="site-header">
      <div className="nav-wrap">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            go('/')
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

export function Footer() {
  return (
    <footer className="site-footer">
      <span>Explore. Evelve. Engineer.</span>
      <span>
        Made for the life beyond class. <span className="y" aria-hidden="true">✳</span>
      </span>
    </footer>
  )
}

/** Lufy with a speech bubble: the Duolingo "owl says" pattern. */
export function LufySays({ children }) {
  return (
    <div className="lufy-says">
      <img src="/lufy-standing.png" alt="" width="72" height="96" />
      <div className="bubble">{children}</div>
    </div>
  )
}

/** Streak, XP and week XP. Zero values stay hidden so a new student sees no empty counters. */
export function StatRow({ me }) {
  if (!me) return null
  return (
    <ul className="stat-row" aria-label="Your progress">
      <li className={me.doneToday ? 'on' : ''}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="#0a0a0a" strokeWidth="2" strokeLinejoin="round">
          <path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 2 4-5z" />
        </svg>
        <b>{me.streak}</b>
        <small>{me.streak === 1 ? 'day' : 'days'}</small>
      </li>
      <li>
        <span aria-hidden="true">✳</span>
        <b>{me.xpTotal}</b>
        <small>XP</small>
      </li>
    </ul>
  )
}

const TABS = [
  { to: '/path', label: 'Path', icon: '◉' },
  { to: '/quests', label: 'Quests', icon: '✦' },
  { to: '/league', label: 'League', icon: '▲' },
  { to: '/me', label: 'Profile', icon: '☺' },
]

/** Signed-in shell: bottom tabs on phones, left rail on wide screens. */
export function AppShell() {
  const { profile } = useSession()
  const { me } = useTrail()
  const avatar = profile?.selectedRole ? avatarForRole(profile.selectedRole) : null
  return (
    <div className="shell">
      <nav className="tabbar" aria-label="Main">
        <a className="rail-brand" href="#/path">
          <img src="/lufy-icon.png" alt="" />
          <span>SapiensCampus</span>
        </a>
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <span aria-hidden="true">{t.icon}</span>
            <b>{t.label}</b>
          </NavLink>
        ))}
      </nav>
      <main className="shell-main">
        <div className="shell-top">
          <StatRow me={me} />
          {avatar && <img className="shell-avatar" src={avatar.src} alt="" width="40" height="40" />}
        </div>
        <Outlet />
      </main>
    </div>
  )
}

/** Full-screen lesson frame: X, progress bar, content, sticky bottom bar. */
export function LessonShell({ progress, total, onClose, footer, children, label }) {
  return (
    <div className="lesson">
      <div className="lesson-top">
        <button type="button" className="lesson-x" onClick={onClose} aria-label="Leave lesson">
          ×
        </button>
        <div
          className="lesson-bar"
          role="progressbar"
          aria-label={label || 'Lesson progress'}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={progress}
        >
          <b style={{ width: `${total ? (progress / total) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="lesson-body">{children}</div>
      <div className="lesson-foot">{footer}</div>
    </div>
  )
}
