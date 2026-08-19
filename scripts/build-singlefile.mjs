// Inlines the built CSS and JS into one HTML file, for publishing the prototype
// somewhere that only takes a single self-contained page.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const out = process.argv[2] ?? join(dist, 'standalone.html')

const assets = readdirSync(join(dist, 'assets'))
const cssFile = assets.find((f) => f.endsWith('.css'))
const jsFile = assets.find((f) => f.endsWith('.js'))
if (!cssFile || !jsFile) throw new Error('expected one css and one js asset in dist/assets')

const css = readFileSync(join(dist, 'assets', cssFile), 'utf8')
const js = readFileSync(join(dist, 'assets', jsFile), 'utf8')

// A literal </script> inside a string would close the tag early.
const safe = (code) => code.replace(/<\/script>/gi, '<\\/script>')

// Declared up front: some hosts serve HTML with no charset at all.
const html = `<meta charset="utf-8">
<title>Recall</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${safe(js)}
</script>
`

writeFileSync(out, html)
console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB)`)
