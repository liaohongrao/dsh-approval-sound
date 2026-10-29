# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-28

### Added

- Host plugin listening to the post-commit session events `approval/asked` and
  `tool/call` (`ask_user_question`).
- Once-per-request sound with an 800 ms debounce window.
- Persistent Python `winsound` helper (`sound/sound_player.py`) with
  `--test`, `--selfcheck` and `--daemon` modes.
- PowerShell playback fallback when Python is unavailable.
- Configurable sound file, fallback sound, debounce, Python path and backend.
- Automatic Python discovery: configured path, DSH bundled runtime
  (`resources\runtime`, `%DSH_HOME%\dsh-runtimes`), then `PATH`.
- Localized plugin-manager metadata (`zh`, `en`) and an original bell icon.
- `npm test` smoke checks for manifest, entry points and JavaScript syntax.
- `test/apply.mjs` event-wiring checks with a fake Cordis context.
- GitHub Actions syntax check for the Node entry and the Python helper.

### Notes

- Prepared from the 2026-10-27 `.dsh-approval-sound` implementation, but the
  trigger path was replaced: in-process Host session events instead of tailing
  zstd session logs.
- Installed locally in the `desktop` profile for listening tests.
- Published to GitHub as <https://github.com/liaohongrao/dsh-approval-sound>.
- Not published to npm.
