import { useState } from 'react'
import './InputPanel.css'

// Just the "add a conversation" form - the collapsible chrome around it
// (expand/collapse, section header) now lives in Sidebar.jsx, which can host
// other sections (e.g. search) the same way.
function InputPanel({ onSubmit, loading, onRecalculate, recalculating }) {
  const [conversation, setConversation] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (conversation.trim()) {
      onSubmit(conversation)
      setConversation('')
    }
  }

  const sampleConversation = `User: I'm really into web development, especially React and Next.js. I've been building a lot of side projects lately.

AI: That's great! What kind of side projects have you been working on?

User: Mostly full-stack apps. I love working with TypeScript and I'm learning more about database design with Postgres. I also use Prisma as my ORM.

AI: Sounds like you're building a solid tech stack! Are you working on anything specific right now?

User: Yeah, I'm building a task management app with real-time collaboration features using WebSockets.`

  const loadSample = () => {
    setConversation(sampleConversation)
  }

  return (
    <div className="panel-content">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="conversation">
            Paste Conversation
            <button
              type="button"
              className="sample-button"
              onClick={loadSample}
              disabled={loading}
            >
              Load Sample
            </button>
          </label>
          <textarea
            id="conversation"
            placeholder="Paste your conversation with ChatGPT or Claude here...&#10;&#10;The AI will extract key facts and memories automatically."
            value={conversation}
            onChange={(e) => setConversation(e.target.value)}
            className="conversation-input"
            rows={12}
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          className="submit-button"
          disabled={loading || !conversation.trim()}
        >
          {loading ? 'Processing...' : '✨ Extract Memories'}
        </button>
      </form>

      <div className="info-box">
        <p><strong>How it works:</strong></p>
        <ul>
          <li>Paste a conversation from ChatGPT or Claude</li>
          <li>AI extracts key facts and concepts about you</li>
          <li>Nodes are positioned based on semantic similarity</li>
          <li>Related memories are automatically connected</li>
        </ul>
      </div>

      <button
        type="button"
        className="recalculate-button"
        onClick={onRecalculate}
        disabled={recalculating}
        title="Re-score every relationship using the current formula - local only, no API cost"
      >
        {recalculating ? 'Recalculating...' : '🔄 Recalculate Relationships'}
      </button>
    </div>
  )
}

export default InputPanel
