#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""dsh-approval-sound — persistent Windows sound helper.

Why this exists
---------------
Node has no in-process audio API. A short-lived child process that plays a WAV
was measured silent when spawned from the DSH sandbox, while `winsound` played
from a process that owns its own audio session is audible. So the Host plugin
keeps this helper alive and writes one JSON line per ring to its stdin:

    {"file": "C:\\Windows\\Media\\Windows User Account Control.wav",
     "fallback": "C:\\Windows\\Media\\notify.wav"}

The helper never touches DSH files or settings; it only plays audio.

Usage
-----
    python sound_player.py --daemon [--sound FILE] [--fallback FILE]
    python sound_player.py --test [--sound FILE]
    python sound_player.py --selfcheck
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    import winsound
except ImportError:  # pragma: no cover - only on non-Windows
    winsound = None

DEFAULT_SOUND = r"C:\Windows\Media\Windows User Account Control.wav"
DEFAULT_FALLBACK = r"C:\Windows\Media\notify.wav"


def play(path: str, fallback: str, synchronous: bool = False) -> bool:
    """Play the first existing file; fall back to the system asterisk sound."""
    if winsound is None:
        print("winsound is unavailable (this plugin requires Windows)", file=sys.stderr)
        return False

    flags = winsound.SND_FILENAME
    if not synchronous:
        flags |= winsound.SND_ASYNC

    for candidate in (path, fallback):
        if candidate and os.path.isfile(candidate):
            try:
                winsound.PlaySound(candidate, flags)
                return True
            except Exception as exc:  # noqa: BLE001 - keep the daemon alive
                print(f"cannot play {candidate!r}: {exc}", file=sys.stderr)

    try:
        winsound.MessageBeep(winsound.MB_ICONASTERISK)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"system beep failed: {exc}", file=sys.stderr)
        return False


def run_daemon(sound: str, fallback: str) -> int:
    stdin = sys.stdin.buffer
    for raw in stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            continue
        if not isinstance(payload, dict):
            continue
        if payload.get("cmd") == "stop":
            return 0
        play(
            str(payload.get("file") or sound),
            str(payload.get("fallback") or fallback),
        )
    return 0


def selfcheck(sound: str, fallback: str) -> int:
    ok = True
    if winsound is None:
        print("[FAIL] winsound is unavailable; run on Windows with Python 3.8+")
        ok = False
    for label, path in (("sound", sound), ("fallback", fallback)):
        if os.path.isfile(path):
            print(f"[ OK ] {label}: {path}")
        else:
            print(f"[warn] {label} missing: {path}")
    if winsound is not None and not any(os.path.isfile(p) for p in (sound, fallback)):
        print("[warn] neither file exists; the helper will use MessageBeep()")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="dsh-approval-sound helper")
    parser.add_argument("--daemon", action="store_true", help="read JSON lines from stdin")
    parser.add_argument("--test", action="store_true", help="play once and exit")
    parser.add_argument("--selfcheck", action="store_true", help="check winsound and sound files")
    parser.add_argument("--sound", default=DEFAULT_SOUND)
    parser.add_argument("--fallback", default=DEFAULT_FALLBACK)
    args = parser.parse_args()

    if args.selfcheck:
        return selfcheck(args.sound, args.fallback)
    if args.test:
        return 0 if play(args.sound, args.fallback, synchronous=True) else 1
    if args.daemon:
        return run_daemon(args.sound, args.fallback)

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
