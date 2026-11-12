import { useState } from 'react'
import { useTrail } from '../lib/trail'
import { claimChest } from '../lib/api'
import { LufySays } from '../components/Chrome'

export default function Quests() {
  const { me, setMe, loading } = useTrail()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!me) return <p className="mono pad">{loading ? 'Loading quests…' : 'Quests are not available right now.'}</p>
  const q = me.quests

  async function claim() {
    setBusy(true)
    setError('')
    try {
      const res = await claimChest()
      setMe(res.me)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pad">
      <p className="eyebrow">Resets every day</p>
      <h1>Daily quests</h1>
      <LufySays>
        {me.doneToday ? `${me.streak} day streak. Keep it going tomorrow.` : 'Do one small thing today to start your streak.'}
      </LufySays>
      <ul className="quests">
        {q.list.map((item) => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <div className="quest-top">
              <strong>{item.label}</strong>
              <span className="mono">{item.progress}/{item.goal}</span>
            </div>
            <div className="lesson-bar" role="progressbar" aria-label={item.label} aria-valuemin={0} aria-valuemax={item.goal} aria-valuenow={item.progress}>
              <b style={{ width: `${(item.progress / item.goal) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="chest">
        <strong>Daily chest (tick one item + write one line) · +{q.chestXp} XP</strong>
        {q.chestClaimed ? (
          <p className="muted">Claimed today. Come back tomorrow.</p>
        ) : (
          <button type="button" className="btn dark" disabled={!q.canClaim || busy} onClick={claim}>
            {q.canClaim ? 'Claim chest' : 'Do the two small ones to open'}
          </button>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
