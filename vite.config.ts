import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset URLs, so the build runs from a subpath (GitHub Pages serves
  // at /<repo>/) as happily as from a domain root.
  base: './',
  // Escape non-ASCII in the bundle. A single-file build can end up somewhere
  // that serves HTML without a charset, and mojibake is the result.
  esbuild: { charset: 'ascii' },
  plugins: [react()],
  server: { port: 5180 },
})
