import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Builds the portfolio background (src/embed/portfolio.jsx) as one
// self-contained, minified classic script + stylesheet (an 'es' library
// build isn't whitespace-minified, which more than doubled the size), straight into the portfolio repo
// next to snapshot.json. See docs/PORTFOLIO.md.
const { outputDir } = JSON.parse(readFileSync(new URL('./scripts/portfolio-snapshot.config.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: outputDir,
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: 'src/embed/portfolio.jsx',
      formats: ['iife'],
      name: 'BrainBackground',
      fileName: () => 'brain-background.js'
    },
    rolldownOptions: {
      output: { assetFileNames: 'brain-background.[ext]' }
    }
  }
})
