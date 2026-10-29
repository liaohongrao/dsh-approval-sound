#!/usr/bin/env node
/**
 * Local smoke checks for the bundle. No dependency installation and no audio.
 *
 * Verifies: manifest, bundle patch, runtime entry, locale metadata, icon,
 * JavaScript syntax, and Python syntax (when an interpreter is available).
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const failures = []
const passes = []

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function readJson(relative) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))
  } catch (error) {
    failures.push(`parse ${relative} — ${error.message}`)
    return null
  }
}

const pkg = readJson('package.json')
check('package.json exists', pkg !== null)
if (pkg) {
  check('package name', pkg.name === 'dsh-approval-sound', String(pkg.name))
  check('ESM module', pkg.type === 'module')
  check('bundle patch declared', pkg.dsh?.bundle?.patch === './cordis.patch.yml')
  check('license', pkg.license === 'MIT')
  check('windows only', Array.isArray(pkg.os) && pkg.os.includes('win32'))
}

const patchPath = join(ROOT, 'cordis.patch.yml')
check('cordis.patch.yml exists', existsSync(patchPath))
if (existsSync(patchPath)) {
  const patch = readFileSync(patchPath, 'utf8')
  check('patch inserts a row', patch.includes('- insert:'))
  check('patch row id', patch.includes('id: approval-sound'))
  check('patch package name', patch.includes('name: dsh-approval-sound'))
  check('patch has config', patch.includes('config:'))
}

for (const relative of ['index.js', 'sound/sound_player.py', 'icon.svg', 'README.md', 'LICENSE']) {
  check(`${relative} exists`, existsSync(join(ROOT, relative)))
}

for (const relative of ['locale/zh.json', 'locale/en.json']) {
  const locale = readJson(relative)
  check(`${relative} title`, Boolean(locale?.meta?.title), JSON.stringify(locale?.meta ?? null))
  check(`${relative} description`, Boolean(locale?.meta?.description))
}

const iconPath = join(ROOT, 'icon.svg')
if (existsSync(iconPath)) {
  const icon = readFileSync(iconPath, 'utf8')
  check('icon is SVG', icon.trimStart().startsWith('<svg'))
  check('icon under 256 KiB', statSync(iconPath).size <= 256 * 1024)
}

// `stdio: 'inherit'` is deliberate: under the DSH Windows sandbox a piped
// child (the spawnSync default) fails with EPERM before Node even starts.
// The check only needs the exit status; a syntax error prints to the terminal.
const nodeCheck = spawnSync(process.execPath, ['--check', join(ROOT, 'index.js')], {
  stdio: 'inherit',
  windowsHide: true,
})
check('index.js parses', nodeCheck.status === 0, nodeCheck.error ? String(nodeCheck.error) : 'exit ' + nodeCheck.status)

const pythonCandidates = [
  ...(process.env.PYTHON ? [{ command: process.env.PYTHON, args: [] }] : []),
  { command: 'python', args: [] },
  { command: 'python3', args: [] },
  { command: 'py', args: ['-3'] },
]
let pythonChecked = false
for (const candidate of pythonCandidates) {
  const compile = spawnSync(candidate.command, [
    ...candidate.args,
    '-c',
    'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")',
    join(ROOT, 'sound', 'sound_player.py'),
  ], { stdio: 'inherit', windowsHide: true })
  if (!compile.error && compile.status === 0) {
    pythonChecked = true
    check('sound_player.py parses', true)
    break
  }
  if (!compile.error && compile.status !== 0) {
    check('sound_player.py parses', false, 'exit ' + compile.status)
    pythonChecked = true
    break
  }
}
if (!pythonChecked) {
  passes.push('sound_player.py parse skipped (no python interpreter)')
}

for (const line of passes) console.log(`  ok  ${line}`)
for (const line of failures) console.error(`FAIL  ${line}`)

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log(`\nAll ${passes.length} checks passed.`)
