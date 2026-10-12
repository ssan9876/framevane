# Generates seed media for development and tests (never shipped):
#   talk.mp4   1080p30 test pattern + synthesized speech with deliberate long pauses (captions + silence cutting)
#   broll.mp4  1080p30 moving gradient, no audio
#   music.m4a  20 s synth pad
#   still.png  a 1920x1080 still
# Usage: pwsh scripts/make-seed-media.ps1 [-Out <dir>]
param([string]$Out = (Join-Path $PSScriptRoot '..\..\..\replica\seed-media'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$wav = Join-Path $Out 'talk-voice.wav'
$synth.SetOutputToWaveFile($wav)
$p = New-Object System.Speech.Synthesis.PromptBuilder
$lines = @(
  'Welcome back to the channel. Today we are testing a brand new video editor.',
  'This part has a long pause after it.',
  'And here we keep going. Captions should line up with every word.',
  'Free shipping on every order this week only.',
  'Thanks for watching, and see you next time.'
)
$pauses = @(1.6, 2.4, 1.2, 1.8, 0.8)
for ($i = 0; $i -lt $lines.Count; $i++) {
  $p.AppendText($lines[$i])
  $p.AppendBreak([TimeSpan]::FromSeconds($pauses[$i]))
}
$synth.Speak($p)
$synth.Dispose()

$ff = (Get-Command ffmpeg).Source
& $ff -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -i $wav -shortest -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart (Join-Path $Out 'talk.mp4')
& $ff -hide_banner -loglevel error -y -f lavfi -i "gradients=size=1920x1080:rate=30:speed=0.02:duration=12" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart (Join-Path $Out 'broll.mp4')
& $ff -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=220:duration=20" -f lavfi -i "sine=frequency=330:duration=20" -filter_complex "[0][1]amix=inputs=2,volume=0.25,afade=t=in:d=2,afade=t=out:st=18:d=2[a]" -map "[a]" -c:a aac -b:a 160k (Join-Path $Out 'music.m4a')
& $ff -hide_banner -loglevel error -y -f lavfi -i "gradients=size=1920x1080:c0=0x203a5c:c1=0xd07a3c:duration=1" -frames:v 1 (Join-Path $Out 'still.png')
Remove-Item $wav
Get-ChildItem $Out | Select-Object Name, Length
