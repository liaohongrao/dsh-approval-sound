#!/usr/bin/env node
/**
 * Event-wiring check. Uses a fake Cordis context and a PowerShell backend with
 * deliberately missing sound files, so it never plays audio and never spawns
 * a helper. This is the closest check possible without installing the bundle.
 *
 * Trigger events are post-commit session events:
 *   - approval/asked
 *   - tool/call with name === 'ask_user_question'
 */

import { apply } from '../index.js'

const passes = []
const failures = []

function check(name, condition, detail = '') {
  if (condition) passes.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const RING_MESSAGE = 'neither sound file exists'

function makeContext() {
  const handlers = new Map()
  const disposed = []
  const logs = []
  let cleanup = null
  const logger = {
    info: (...args) => logs.push(args.join(' ')),
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
  }
  const ctx = {
    logger,
    effect(callback) {
      cleanup = callback()
      return () => {
        cleanup?.()
        cleanup = null
      }
    },
    on(name, handler) {
      handlers.set(name, handler)
      return () => disposed.push(name)
    },
  }
  return { ctx, handlers, disposed, logs, runCleanup: () => cleanup?.() }
}

if (process.platform !== 'win32') {
  console.log('  ok  skipped on non-Windows')
  process.exit(0)
}

const baseConfig = {
  enabled: true,
  backend: 'powershell',
  sound: 'Z:\\definitely-missing\\primary.wav',
  fallbackSound: 'Z:\\definitely-missing\\fallback.wav',
  debounceMs: 150,
  pythonPath: '',
}

{
  const { ctx, handlers, disposed, logs, runCleanup } = makeContext()
  apply(ctx, baseConfig)

  check('registers session/event', handlers.has('session/event'))
  check('does not claim approval/request', !handlers.has('approval/request'))
  check('does not claim user-questions/request', !handlers.has('user-questions/request'))

  const sessionEvent = handlers.get('session/event')
  const ringCount = () => logs.filter((line) => line.includes(RING_MESSAGE)).length

  sessionEvent?.({}, { type: 'approval/asked', data: { id: 'a1', toolName: 'pwsh' } })
  check('approval/asked rings once', ringCount() === 1)

  await sleep(250)
  sessionEvent?.({}, {
    type: 'tool/call',
    data: { name: 'ask_user_question', callId: 'c1', arguments: '{}' },
  })
  check('ask_user_question tool/call rings once', ringCount() === 2)

  await sleep(250)
  sessionEvent?.({}, {
    type: 'tool/call',
    data: { name: 'read', callId: 'c2', arguments: '{}' },
  })
  check('other tool/call is ignored', ringCount() === 2)

  runCleanup()
  check('cleanup releases session/event', disposed.includes('session/event'))
}

{
  const { ctx, handlers, logs, runCleanup } = makeContext()
  apply(ctx, { ...baseConfig, enabled: false })

  handlers.get('session/event')?.({}, { type: 'approval/asked', data: { id: 'a2' } })
  await sleep(50)
  check('disabled plugin does not ring', logs.every((line) => !line.includes(RING_MESSAGE)))
  runCleanup()
}

for (const line of passes) console.log(`  ok  ${line}`)
for (const line of failures) console.error(`FAIL  ${line}`)

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log(`\nAll ${passes.length} event checks passed.`)
