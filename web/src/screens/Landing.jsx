import { useSession } from '../lib/session'
import { Footer, Header } from '../components/Chrome'

export default function Landing() {
  const { goGetStarted, go } = useSession()
  return (
    <>
      <Header />
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
                      onClick={() => go("/start/invite")}
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
      <Footer />
    </>
  )
}
