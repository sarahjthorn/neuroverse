import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getSetting } from './services/db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env file manually (simple implementation)
function loadEnv() {
  try {
    // BRAIN_ENV_FILE swaps in another .env - the smoke tests point it at
    // nothing so they run without API keys and can't make paid calls.
    const envPath = process.env.BRAIN_ENV_FILE || join(__dirname, '..', '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    const env = {}
    
    envContent.split('\n').forEach(line => {
      line = line.trim()
      if (line && !line.startsWith('#')) {
        const [key, ...values] = line.split('=')
        env[key.trim()] = values.join('=').trim()
      }
    })
    
    return env
  } catch (error) {
    console.warn('No .env file found, using environment variables')
    return {}
  }
}

const env = loadEnv()

export const config = {
  openaiApiKey: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  anthropicApiKey: env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  extractionModel: env.EXTRACTION_MODEL || process.env.EXTRACTION_MODEL || 'claude-haiku',
  // Model for "ask your brain" answers on Home (server/routes/search.js)
  answerModel: env.ANSWER_MODEL || process.env.ANSWER_MODEL || 'claude-sonnet-5-5',
  // Model that writes the brain's questions (Reflect / Home curious card)
  questionModel: env.QUESTION_MODEL || process.env.QUESTION_MODEL || 'claude-sonnet-5-5',
  port: env.PORT || process.env.PORT || 3001,
  // Fallback for whose brain this is. The name the First Light intro asks
  // for is saved in the database and wins - see userName() below.
  userName: (env.USER_NAME || process.env.USER_NAME || '').trim()
}

// The owner's name: the database first (set by the intro), then USER_NAME
// from .env (older setups), else ''.
export const userName = () => (getSetting('owner_name') || config.userName || '').trim()

// How AI prompts refer to the brain's owner, falling back to "the user"
export const ownerName = () => userName() || 'the user'
export const ownerPossessive = () => userName() ? `${userName()}'s` : "the user's"

