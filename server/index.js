import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import graphRoutes from './routes/graph.js'
import conversationRoutes from './routes/conversation.js'
import nodeRoutes from './routes/nodes.js'
import searchRoutes from './routes/search.js'
import categoryRoutes from './routes/categories.js'
import keywordRoutes from './routes/keywords.js'
import statsRoutes from './routes/stats.js'
import questionRoutes from './routes/questions.js'
import introRoutes from './routes/intro.js'
import overviewRoutes from './routes/overview.js'
import wishlistRoutes from './routes/wishlist.js'
import tabRoutes from './routes/tabs.js'
import inboxRoutes from './routes/inbox.js'
import { backfillKeywordEmbeddings } from './services/taxonomy.js'
import { PHOTO_DIR } from './services/wishlistPhotos.js'

const app = express()

// Middleware
// Restricted to the Vite dev server's origin - this API serves the user's
// entire personal memory graph with no auth, so a wildcard/default `cors()`
// would let any site the user visits read it cross-origin via fetch().
app.use(cors({ origin: 'http://localhost:3000' }))
app.use(express.json({ limit: '10mb' }))

// Routes
app.use('/api', graphRoutes)
app.use('/api', conversationRoutes)
app.use('/api', nodeRoutes)
app.use('/api', searchRoutes)
app.use('/api', categoryRoutes)
app.use('/api', keywordRoutes)
app.use('/api', statsRoutes)
app.use('/api', questionRoutes)
app.use('/api', introRoutes)
app.use('/api', overviewRoutes)
app.use('/api', wishlistRoutes)
app.use('/api', tabRoutes)
app.use('/api', inboxRoutes)
// File names are unique per upload, so they can be cached for good.
app.use('/api/wishlist-images', express.static(PHOTO_DIR, { maxAge: '365d', immutable: true }))

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = config.port || 3001

app.listen(PORT, async () => {
  console.log(`🧠 AI Brain server running on http://localhost:${PORT}`)
  console.log(`📊 Graph API: http://localhost:${PORT}/api/graph`)

  const model = config.extractionModel || 'claude-haiku'
  console.log(`🤖 Extraction model: ${model}`)

  if (!config.openaiApiKey) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not set (required for embeddings)')
  }

  if (model.startsWith('claude-') && !config.anthropicApiKey) {
    console.warn('⚠️  Warning: ANTHROPIC_API_KEY not set (required for Claude extraction)')
  }

  if (config.openaiApiKey) {
    try {
      await backfillKeywordEmbeddings()
    } catch (error) {
      console.error('⚠️  Keyword embedding backfill failed (will retry on next restart):', error.message)
    }
  }
})
