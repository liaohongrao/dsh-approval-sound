/**
 * dsh-approval-sound — Host half.
 *
 * Plays a Windows notification sound at the two moments DSH needs a human:
 *
 *   - session event `approval/asked`       a tool wants permission (同意 / 拒绝)
 *   - session event `tool/call` named      the agent calls `ask_user_question`
 *
 * Why session events instead of the `approval/request` waterfall: the desktop
 * Web UI composes an `api-remotes` answerer that claims the waterfall first and
 * only resolves after the browser answers. A plugin listener registered later
 * would therefore ring after the user already clicked, not when the prompt
 * appears. Session events are post-commit append notifications, emitted
 * independently of answerer order, so they fire while the prompt is still new.
 * Ringing is fire-and-forget and can never block or fail the decision.
 *
 * Sound is produced by a tiny persistent Python helper (`sound/sound_player.py`)
 * using `winsound`, i.e. inside a process that owns an audio session. Spawning a
 * short-lived player per ring was measurably silent under the DSH sandbox, so
 * the helper stays alive and receives one JSON line per ring on stdin.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLAYER_SCRIPT = join(HERE, 'sound', 'sound_player.py')

const DEFAULT_SOUND = 'C:\\Windows\\Media\\Windows User Account Control.wav'
const DEFAULT_FALLBACK = 'C:\\Windows\\Media\\notify.wav'

const DEFAULTS = {
  enabled: true,
  sound: DEFAULT_SOUND,
  fallbackSound: DEFAULT_FALLBACK,
  debounceMs: 800,
  /** Optional absolute path to pythonw.exe / python.exe. Empty = auto-detect. */
  pythonPath: '',
  /** 'auto' (default), 'python' or 'powershell'. */
  backend: 'auto',
}

function normalizeConfig(config) {
  const merged = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  merged.enabled = merged.enabled !== false
  merged.sound = typeof merged.sound === 'string' && merged.sound.trim()
    ? merged.sound
    : DEFAULT_SOUND
  merged.fallbackSound = typeof merged.fallbackSound === 'string' && merged.fallbackSound.trim()
    ? merged.fallbackSound
    : DEFAULT_FALLBACK
  merged.debounceMs = Number.isFinite(Number(merged.debounceMs))
    ? Math.max(150, Number(merged.debounceMs))
    : DEFAULTS.debounceMs
  merged.pythonPath = typeof merged.pythonPath === 'string' ? merged.pythonPath.trim() : ''
  merged.backend = ['auto', 'python', 'powershell'].includes(merged.backend)
    ? merged.backend
    : 'auto'
  return merged
}

function makeLogger(ctx) {
  return (...args) => {
    try {
      const logger = ctx.logger
      if (!logger) return
      if (typeof logger === 'function') logger(...args)
      else if (typeof logger.info === 'function') logger.info(...args)
    } catch {
      /* logging must never break sound or approvals */
    }
  }
}

function canImportWinsound(command, prefixArgs) {
  try {
    const result = spawnSync(command, [...prefixArgs, '-c', 'import winsound'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    })
    return !result.error && result.status === 0
  } catch {
    return false
  }
}

/**
 * Python shipped with the DSH desktop runtime. The Host process PATH does not
 * necessarily contain it, so look next to the executable and in DSH_HOME.
 * Mirrors the discovery the original VBS launcher used, without scanning the
 * whole disk.
 */
function runtimePythonPaths() {
  const paths = []
  const addRuntime = (runtimeDir) => {
    if (!runtimeDir) return
    paths.push(join(runtimeDir, 'dependencies', 'python', 'pythonw.exe'))
  }

  if (process.resourcesPath) {
    addRuntime(join(process.resourcesPath, 'runtime', 'primary-runtime'))
  }
  addRuntime(join(dirname(process.execPath), 'resources', 'runtime', 'primary-runtime'))

  if (process.env.DSH_HOME) {
    const runtimesRoot = join(process.env.DSH_HOME, 'dsh-runtimes')
    addRuntime(join(runtimesRoot, 'dsh-primary-runtime'))
    try {
      for (const entry of readdirSync(runtimesRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) addRuntime(join(runtimesRoot, entry.name))
      }
    } catch {
      /* no runtimes directory: fall back to PATH */
    }
  }

  return [...new Set(paths)].filter((path) => existsSync(path))
}

function findPython(config, log) {
  if (config.pythonPath) {
    const configured = { command: config.pythonPath, prefixArgs: [] }
    if (canImportWinsound(configured.command, configured.prefixArgs)) return configured
    log(`[approval-sound] configured pythonPath is not usable, trying auto-detection: ${config.pythonPath}`)
  }

  const candidates = [
    ...runtimePythonPaths().map((command) => ({ command, prefixArgs: [] })),
    { command: 'pythonw.exe', prefixArgs: [] },
    { command: 'python.exe', prefixArgs: [] },
    { command: 'py.exe', prefixArgs: ['-3'] },
  ]

  for (const candidate of candidates) {
    if (canImportWinsound(candidate.command, candidate.prefixArgs)) {
      return candidate
    }
  }
  return null
}

class SoundPlayer {
  constructor(config, log) {
    this.config = config
    this.log = log
    this.child = null
    this.python = null
    this.stopped = false
    this.lastRingAt = 0
    this.warnedFallback = false
  }

  start() {
    if (this.config.backend === 'powershell') {
      this.log('[approval-sound] backend=powershell (Python helper disabled by config)')
      return
    }
    if (!existsSync(PLAYER_SCRIPT)) {
      this.log(`[approval-sound] missing player script: ${PLAYER_SCRIPT}`)
      return
    }

    this.python = findPython(this.config, this.log)
    if (!this.python) {
      this.log('[approval-sound] Python with winsound not found; falling back to PowerShell playback')
      return
    }

    this.spawnPython()
  }

  spawnPython() {
    if (!this.python || this.stopped || this.child) return
    const args = [
      ...this.python.prefixArgs,
      PLAYER_SCRIPT,
      '--daemon',
      '--sound',
      this.config.sound,
      '--fallback',
      this.config.fallbackSound,
    ]

    try {
      const child = spawn(this.python.command, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      })

      child.on('error', (error) => {
        this.log(`[approval-sound] player failed to start: ${error.message}`)
        this.child = null
      })
      child.on('exit', (code, signal) => {
        if (this.child === child) this.child = null
        if (!this.stopped) {
          this.log(`[approval-sound] player exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
        }
      })
      child.stderr?.on('data', (chunk) => {
        const text = String(chunk).trim()
        if (text) this.log(`[approval-sound] player: ${text}`)
      })
      child.stdin?.on('error', (error) => {
        this.log(`[approval-sound] player stdin failed: ${error.message}`)
        if (this.child === child) this.child = null
      })

      this.child = child
      this.log(`[approval-sound] player started with ${this.python.command}`)
    } catch (error) {
      this.child = null
      this.log(`[approval-sound] player spawn threw: ${error.message}`)
    }
  }

  ring(kind) {
    if (this.stopped) return

    const now = Date.now()
    if (now - this.lastRingAt < this.config.debounceMs) return
    this.lastRingAt = now

    if (this.config.backend !== 'powershell') {
      if (!this.child) {
        // The helper may have died; try once more before falling back.
        if (this.python && this.config.backend === 'auto') this.spawnPython()
      }
      if (this.child?.stdin?.writable) {
        try {
          this.child.stdin.write(JSON.stringify({
            file: this.config.sound,
            fallback: this.config.fallbackSound,
          }) + '\n')
          return
        } catch (error) {
          this.log(`[approval-sound] writing to player failed: ${error.message}`)
          this.child = null
        }
      }
    }

    if (this.config.backend === 'python') {
      this.log('[approval-sound] python backend unavailable, no sound played')
      return
    }
    this.playWithPowerShell()
  }

  playWithPowerShell() {
    if (this.warnedFallback === false) {
      this.warnedFallback = true
      this.log('[approval-sound] using PowerShell fallback playback')
    }

    const sound = existsSync(this.config.sound)
      ? this.config.sound
      : (existsSync(this.config.fallbackSound) ? this.config.fallbackSound : '')
    if (!sound) {
      this.log('[approval-sound] neither sound file exists; nothing to play')
      return
    }

    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const command = `(New-Object Media.SoundPlayer '${sound.replace(/'/g, "''")}').PlaySync()`

    try {
      const child = spawn(powershell, [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        command,
      ], { stdio: 'ignore', windowsHide: true })
      child.on('error', (error) => {
        this.log(`[approval-sound] PowerShell playback failed: ${error.message}`)
      })
    } catch (error) {
      this.log(`[approval-sound] PowerShell playback threw: ${error.message}`)
    }
  }

  stop() {
    this.stopped = true
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.stdin?.end()
      child.kill()
    } catch {
      /* already gone */
    }
  }
}

export function apply(ctx, config) {
  if (process.platform !== 'win32') {
    try {
      ctx.logger?.info?.('[approval-sound] skipped: Windows only')
    } catch {
      /* ignore */
    }
    return
  }

  const cfg = normalizeConfig(config)
  const log = makeLogger(ctx)
  const player = new SoundPlayer(cfg, log)

  ctx.effect(() => {
    if (cfg.enabled) player.start()

    const onSessionEvent = (session, event) => {
      if (!cfg.enabled) return
      const type = event?.type
      let kind = ''
      if (type === 'approval/asked') {
        kind = 'approval'
      } else if (type === 'tool/call' && event?.data?.name === 'ask_user_question') {
        kind = 'question'
      }
      if (!kind) return

      try {
        player.ring(kind)
      } catch (error) {
        log(`[approval-sound] ring failed: ${error?.message ?? error}`)
      }
    }

    const offSession = ctx.on('session/event', onSessionEvent)

    return () => {
      try { offSession?.() } catch { /* ignore */ }
      player.stop()
    }
  })

  log(`[approval-sound] ready (enabled=${cfg.enabled}, backend=${cfg.backend})`)
}
