#!/usr/bin/env bash
# Generates seed media for development and tests on macOS (never shipped); the Windows twin is make-seed-media.ps1.
#   talk.mp4   1080p30 test pattern + synthesized speech with deliberate long pauses (captions + silence cutting)
#   broll.mp4  1080p30 moving gradient, no audio
#   music.m4a  20 s synth pad
#   still.png  a 1920x1080 still
# Usage: bash scripts/make-seed-media.sh [out-dir]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$HERE/../../../replica/seed-media}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# the same lines and pauses as the Windows script; [[slnc ms]] is say's embedded silence
TEXT="Welcome back to the channel. Today we are testing a brand new video editor. [[slnc 1600]]
This part has a long pause after it. [[slnc 2400]]
And here we keep going. Captions should line up with every word. [[slnc 1200]]
Free shipping on every order this week only. [[slnc 1800]]
Thanks for watching, and see you next time. [[slnc 800]]"
VOICE_ARGS=()
# Samantha is installed on every macOS; fall back to the default voice if not
if say -v '?' | grep -q '^Samantha '; then VOICE_ARGS=(-v Samantha); fi
WAV="$OUT/talk-voice.wav"
say "${VOICE_ARGS[@]}" --file-format=WAVE --data-format=LEI16@22050 -o "$WAV" "$TEXT"

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
ff -f lavfi -i "testsrc2=size=1920x1080:rate=30" -i "$WAV" -shortest -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$OUT/talk.mp4"
ff -f lavfi -i "gradients=size=1920x1080:rate=30:speed=0.02:duration=12" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart "$OUT/broll.mp4"
ff -f lavfi -i "sine=frequency=220:duration=20" -f lavfi -i "sine=frequency=330:duration=20" -filter_complex "[0][1]amix=inputs=2,volume=0.25,afade=t=in:d=2,afade=t=out:st=18:d=2[a]" -map "[a]" -c:a aac -b:a 160k "$OUT/music.m4a"
ff -f lavfi -i "gradients=size=1920x1080:c0=0x203a5c:c1=0xd07a3c:duration=1" -frames:v 1 "$OUT/still.png"
rm -f "$WAV"
ls -l "$OUT"
