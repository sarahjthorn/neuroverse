import { useMemo } from 'react'
import { ABOUT_WHY, ABOUT_QUESTIONS, ABOUT_SOURCE_GROUPS, ABOUT_SIMILAR } from '../about'
import './AboutView.css'

// About: why Neuroverse exists, the questions behind it and the papers it
// draws on. The words live in src/about.js. Each question links back to the
// memories tagged with its keywords, so the page is part of the brain too.

const STATUS_LABELS = { used: 'In the code', tried: 'Tested', planned: 'Planned', reading: 'Reading' }

function matchingIds(nodes, keywords) {
  const wanted = new Set(keywords.map(k => k.toLowerCase()))
  return nodes
    .filter(n => (n.data.keywords || []).some(k => wanted.has(k.toLowerCase())))
    .map(n => n.id)
}

function AboutView({ nodes, onViewInBrain }) {
  const questionIds = useMemo(
    () => ABOUT_QUESTIONS.map(q => matchingIds(nodes, q.keywords)),
    [nodes]
  )

  return (
    <div className="about-view">
      <div className="about-inner">
        <header className="about-hero">
          <h1>About Neuroverse</h1>
          <p>A memory for your AI conversations, and an experiment in what a memory should be.</p>
        </header>

        <section className="about-card">
          <div className="about-card-head">
            <h2>Why I started it</h2>
            {ABOUT_WHY.draft && <span className="about-draft" title="Drafted from the brain's memories - edit src/about.js">Draft</span>}
          </div>
          {ABOUT_WHY.paragraphs.map((p, i) => <p key={i} className="about-text">{p}</p>)}
        </section>

        <section className="about-section">
          <h2 className="about-section-title">Questions I keep coming back to</h2>
          <div className="about-questions">
            {ABOUT_QUESTIONS.map((q, i) => {
              const ids = questionIds[i]
              return (
                <article key={q.title} className="about-card about-question">
                  <h3>{q.title}</h3>
                  <p className="about-text">{q.body}</p>
                  {ids.length > 0 && (
                    <button
                      type="button"
                      className="about-link-btn"
                      onClick={() => onViewInBrain(ids, q.title)}
                    >
                      {ids.length} {ids.length === 1 ? 'memory' : 'memories'} about this · view in 3D
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        {ABOUT_SOURCE_GROUPS.map(group => (
          <section key={group.title} className="about-section">
            <h2 className="about-section-title">{group.title}</h2>
            <p className="about-section-note">{group.note}</p>
            <ul className="about-card about-sources">
              {group.sources.map(s => (
                <li key={s.title}>
                  <div className="about-source-top">
                    {s.url
                      ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                      : <span className="about-source-title">{s.title}</span>}
                    <span className={`about-status is-${s.status}`}>{STATUS_LABELS[s.status]}</span>
                  </div>
                  <p className="about-source-meta">{s.authors}, {s.year}</p>
                  <p className="about-source-use">{s.use}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="about-section">
          <h2 className="about-section-title">Compared with</h2>
          <p className="about-section-note">
            Other memory systems for AI that Neuroverse was checked against. Hybrid search came from this comparison.
          </p>
          <div className="about-chips">
            {ABOUT_SIMILAR.map(name => <span key={name} className="about-chip">{name}</span>)}
          </div>
        </section>
      </div>
    </div>
  )
}

export default AboutView
