import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { SessionProvider, useSession } from './lib/session'
import { TrailProvider } from './lib/trail'
import { AppShell, Header } from './components/Chrome'
import Landing from './screens/Landing'
import { Intro, Invite, ProfileSteps, SignIn } from './screens/Start'
import Quiz from './screens/Quiz'
import Result from './screens/Result'
import Path from './screens/Path'
import Lesson from './screens/Lesson'
import Careers from './screens/Careers'
import Quests from './screens/Quests'
import League from './screens/League'
import Me, { Student } from './screens/Me'
import './App.css'
import './duo.css'

function Boot() {
  return (
    <div className="boot">
      <div className="pulse" aria-hidden="true" />
      <p className="mono">Loading discovery</p>
      <h2>Hang tight…</h2>
    </div>
  )
}

/** Signed-in students who picked a role. Everyone else is sent to where they belong. */
function RequireRole() {
  const { user, profile, homeFor } = useSession()
  if (!user) return <Navigate to="/" replace />
  if (!profile) return <Boot />
  if (!profile.selectedRole?.id) return <Navigate to={homeFor(profile)} replace />
  return <Outlet />
}

/** Old #roadmap/:roleId/:stepId links keep working. */
function LegacyRoadmap() {
  const { stepId } = useParams()
  return <Navigate to={stepId ? `/lesson/${stepId}` : '/path'} replace />
}

function Home() {
  const { user, profile, homeFor } = useSession()
  if (user && profile) return <Navigate to={homeFor(profile)} replace />
  return <Landing />
}

export default function App() {
  return (
    <SessionProvider>
      <TrailProvider>
        <Screens />
      </TrailProvider>
    </SessionProvider>
  )
}

function Screens() {
  const { loading, authChecked, error, pack } = useSession()
  if (loading || !authChecked) return <Boot />
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
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/start/invite" element={<Invite />} />
        <Route path="/start/signin" element={<SignIn />} />
        <Route path="/start/profile" element={<ProfileSteps />} />
        <Route path="/start/intro" element={<Intro />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/result" element={<Result />} />
        <Route element={<RequireRole />}>
          <Route path="/lesson/:stepId" element={<Lesson />} />
          <Route element={<AppShell />}>
            <Route path="/path" element={<Path />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/quests" element={<Quests />} />
            <Route path="/league" element={<League />} />
            <Route path="/me" element={<Me />} />
            <Route path="/student/:uid" element={<Student />} />
          </Route>
        </Route>
        <Route path="/roadmap/:roleId/:stepId?" element={<LegacyRoadmap />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
