import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        // API_PORT lets a worktree run its own API next to main's on 3001.
        target: `http://localhost:${process.env.API_PORT || 3001}`,
        changeOrigin: true
      }
    }
  }
})
