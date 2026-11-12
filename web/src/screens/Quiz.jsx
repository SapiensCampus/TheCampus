import { useEffect } from 'react'
import { useSession } from '../lib/session'
import { LessonShell, LufySays } from '../components/Chrome'

const COACH = [
  'No right answers. Just your first reaction.',
  'Tap a feeling. The next card appears automatically.',
  'Choose for your interest, not your experience.',
  '“Maybe” is a good answer.',
  'Imagine trying it, not being good at it.',
]

export default function Quiz() {
  const { current, quiz, index, answeredCount, pack, liveTrivia, boostIndex, answer, quizBack, go } = useSession()

  // Nothing to show (e.g. opened by URL): go back to the intro, which starts or resumes the quiz.
  useEffect(() => {
    if (!current) go('/start/intro', { replace: true })
  }, [current, go])
  if (!current) return null

  const reactions = (
    <div className="reactions" role="group" aria-label="Your reaction">
      {(pack.anchors || []).map((a) => (
        <button key={a.value} type="button" className={`reaction ${a.color || ''}`} onClick={() => answer(a.value)}>
          <strong>{a.label}</strong>
          <span>{a.detail}</span>
        </button>
      ))}
    </div>
  )

  return (
    <LessonShell
      progress={answeredCount}
      total={quiz.length}
      label="Quiz progress"
      onClose={() => go('/start/intro')}
      footer={reactions}
    >
      <button type="button" className="linkish quiz-back" onClick={quizBack}>
        ← Back
      </button>
      <div key={liveTrivia ? boostIndex : index % COACH.length} role="status" aria-live="polite">
        <LufySays>
          {liveTrivia ? (
            <>
              <strong>{liveTrivia.title}</strong> {liveTrivia.body}
            </>
          ) : (
            COACH[index % COACH.length]
          )}
        </LufySays>
      </div>
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
    </LessonShell>
  )
}
