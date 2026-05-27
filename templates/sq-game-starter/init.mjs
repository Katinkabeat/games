#!/usr/bin/env node
// SQ Game Starter — scaffolder.
//
// Copies _template/ into a sibling folder of rae-side-quest, substitutes
// placeholders, runs `git init`, and creates an initial commit.
//
// Usage (from rae-side-quest/ root):
//   node templates/sq-game-starter/init.mjs \
//     --slug=mygame \
//     --name="My Game" \
//     --description="A cozy word game" \
//     --color="#7c3aed" \
//     --background="#fef3c7" \
//     --emoji="🎲" \
//     --port=5184

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(__dirname, '_template')

// ── Parse args ─────────────────────────────────────────────────────────
const args = {}
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)=(.*)$/)
  if (m) args[m[1]] = m[2]
}

const required = ['slug', 'name']
const missing = required.filter(k => !args[k])
if (missing.length) {
  console.error(`Missing required flags: ${missing.map(k => '--' + k).join(', ')}`)
  console.error('')
  console.error('Usage:')
  console.error('  node templates/sq-game-starter/init.mjs \\')
  console.error('    --slug=mygame \\')
  console.error('    --name="My Game" \\')
  console.error('    --description="A cozy word game" \\')
  console.error('    --color="#7c3aed" \\')
  console.error('    --background="#fef3c7" \\')
  console.error('    --emoji="🎲" \\')
  console.error('    --port=5184')
  process.exit(1)
}

const slug = args.slug.toLowerCase()
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error(`Invalid slug "${args.slug}": must start with a letter and contain only lowercase letters, digits, hyphens.`)
  process.exit(1)
}

const emoji = args.emoji || ''
const subs = {
  slug,
  name: args.name,
  description: args.description || `A SideQuest game.`,
  themeColor: args.color || '#7c3aed',
  backgroundColor: args.background || '#faf5ff',
  port: args.port || '5184',
  initial: args.name.trim()[0].toUpperCase(),
  date: new Date().toISOString().slice(0, 10),
  emoji,
  // emojiSuffix = " 🎲" when emoji provided, "" otherwise. Used in titles
  // so the trailing space disappears cleanly when no emoji is set.
  emojiSuffix: emoji ? ` ${emoji}` : '',
}

// ── Resolve target dir (sibling of rae-side-quest) ─────────────────────
// __dirname is rae-side-quest/templates/sq-game-starter, so up 3 = parent of rae-side-quest
const RSQ_ROOT = resolve(__dirname, '..', '..')
const PARENT = resolve(RSQ_ROOT, '..')
const targetDir = join(PARENT, slug)

if (existsSync(targetDir)) {
  console.error(`Refusing to scaffold: target folder already exists at ${targetDir}`)
  process.exit(1)
}

console.log(`\nScaffolding "${subs.name}" (slug: ${slug})`)
console.log(`  -> ${targetDir}\n`)

// ── Substitute placeholders in a string ────────────────────────────────
function substitute(str) {
  return str
    .replace(/\{\{slug\}\}/g, subs.slug)
    .replace(/\{\{name\}\}/g, subs.name)
    .replace(/\{\{description\}\}/g, subs.description)
    .replace(/\{\{themeColor\}\}/g, subs.themeColor)
    .replace(/\{\{backgroundColor\}\}/g, subs.backgroundColor)
    .replace(/\{\{port\}\}/g, subs.port)
    .replace(/\{\{initial\}\}/g, subs.initial)
    .replace(/\{\{date\}\}/g, subs.date)
    .replace(/\{\{emojiSuffix\}\}/g, subs.emojiSuffix)
    .replace(/\{\{emoji\}\}/g, subs.emoji)
}

// ── Walk _template/ recursively, copying + substituting ────────────────
function walk(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry)
    // Filename substitution: GAMENAME.md → <slug>.md (legacy), and
    // any {{slug}} / {{name}}-style placeholders in filenames get
    // expanded the same way as in file contents.
    const destEntry = entry === 'GAMENAME.md'
      ? `${slug}.md`
      : substitute(entry)
    const destPath = join(destDir, destEntry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      walk(srcPath, destPath)
    } else {
      const content = readFileSync(srcPath, 'utf8')
      writeFileSync(destPath, substitute(content), 'utf8')
      console.log(`  + ${relative(targetDir, destPath).replace(/\\/g, '/')}`)
    }
  }
}

walk(TEMPLATE_DIR, targetDir)

// ── git init + initial commit ──────────────────────────────────────────
console.log(`\nInitialising git repo...`)
try {
  execSync('git init -b main', { cwd: targetDir, stdio: 'inherit' })
  execSync('git add .', { cwd: targetDir, stdio: 'inherit' })
  execSync(
    `git commit -m "Initial scaffold from sq-game-starter"`,
    { cwd: targetDir, stdio: 'inherit' }
  )
} catch (err) {
  console.error(`\ngit step failed: ${err.message}`)
  console.error(`Files were created at ${targetDir} — you can run git init manually.`)
  process.exit(1)
}

console.log(`\n✓ Done.\n`)
console.log(`Next steps (ask Claude to do these):`)
console.log(`  1. "Add ${slug} to dev:all so I can test it locally"`)
console.log(`  2. Run \`npm install\` in ${targetDir}`)
console.log(`  3. Stand up multiplayer (N-player MP is baked in):`)
console.log(`       a. Run supabase/migrations/${slug}_multiplayer.sql in the`)
console.log(`          Supabase SQL editor, then ${slug}_nudge.sql (it adds the`)
console.log(`          ${slug}_games/${slug}_players tables, RPCs, RLS, invite`)
console.log(`          expiry, push triggers, and adds both tables to the`)
console.log(`          supabase_realtime publication — no separate realtime step).`)
console.log(`       b. In ${slug}_multiplayer.sql section 20, replace <PROJECT_REF>`)
console.log(`          and <ANON_JWT> in the push triggers before they'll fire.`)
console.log(`       c. Then run ${slug}_admin_close_game.sql (needs the tables).`)
console.log(`       d. Deploy the edge fn: \`supabase functions deploy`)
console.log(`          ${slug}-push-notification\` (reuses the shared VAPID secrets).`)
console.log(`  4. Build the game — the turn engine works end-to-end via the stub`)
console.log(`     ${slug}_submit_turn RPC + the MultiGamePage demo play area;`)
console.log(`     replace both with real gameplay (see README "Multiplayer").`)
console.log(`  5. "Add ${slug} to the SQ hub" (+ patch the hub LandingPage's`)
console.log(`     hub-inbox channel to subscribe to ${slug}_games/${slug}_players;`)
console.log(`     ${slug}_pending_for() already exists from the migration).`)
console.log(`  6. "Wire ${slug} into the shared notification system" (subscription)`)
console.log(`  7. "Deploy ${slug}" when ready`)
console.log()
