# ApexSummit

Elevated next-level multi-chair live step-grid desk.

Elevated from ApexZenith with:
- Web MIDI keyboard input (note on/off/velocity) for live play + record into grid
- Per-chair stem WAV exports
- Longer sustain envelopes on melodic chairs (piano/guitar hold to note end)
- Deterministic humanize (downbeats stay exact)
- Full WorkinWithAI Audio Engine compliance

**Free.**

## Audio Engine compliance
- Timing on AudioContext clock only (lookahead scheduler)
- Live mutable state — changes take effect within one bar
- OfflineAudioContext WAV: exact length, first transient at sample 0, folded tail, 48 kHz 24-bit, peak ≤ −1 dBFS
- Matching multi-track MIDI
- Pinned FluidR3 samples `@d58301e4a494555f411a2afbc448b724136eee76`
- User BPM (60–180) + key + 4-chord entry persist in localStorage
- Per-chair gains → master compressor
- First tap creates/resumes AudioContext; hidden tab stops cleanly
- Hardware MIDI supported

## Acceptance checks (section 9)
1. Export 92 BPM / 8 bars / 48 kHz → exactly 1,001,739 samples, first transient ≤ 1 ms of sample 0.
2. Loop 4× in DAW: no seam clicks, no grid drift.
3. Tab hide 30 s → clean stop, no stacked notes.
4. Live recipe/mute/BPM change heard within one bar.
5. Block sample host → UI names missing instruments.
6. Longest pad at slowest tempo sustains to note end.
7. No `@main`/`@gh-pages`, no `Math.random` in export path, voice names match samples.

Live: [apexsummit.vercel.app](https://apexsummit.vercel.app) (after deploy)
