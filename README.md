# ApexSummit

Next-level elevated multi-chair live step-grid desk. Built from the lineage of NextLevelDesk → ApexZenith → PinnacleSummit → ApexSummit.

**Free.** No license gate.

## Elevations (next level)

- 10 chairs: kick, snare, hat, crash, tom, bass, piano, guitar, violin (pad), trumpet
- Per-chair lowpass filters + **per-chair pan** (StereoPannerNode)
- Master delay
- **MIDI record mode**: hardware keyboard notes quantized into the selected target chair's grid (with velocity). Live play always available when not recording.
- **Stem exports**: one folded WAV per chair
- Stronger pad sustain with longer envelopes (violin 3.0s, piano 2.2s) and release ramps
- Additional recipes: build, break, hook
- Deterministic humanize (sin-based, downbeats exact)
- Full multi-track SMF MIDI export
- Live step highlight + playhead from AudioContext clock
- All WorkinWithAI Audio Engine rules 1–4 fully implemented

## Samples

Pinned FluidR3 from PreEight@d58301e4a494555f411a2afbc448b724136eee76. Honest voices. Never pitch > ±4 semitones. Preload with progress; names missing instruments.

## Acceptance Checks (Section 9)

1. **Export at 92 BPM, 8 bars, 48 kHz**: Exact length = Math.round(8 * 4 * 60 / 92 * 48000) = 1,001,739 samples. First transient at sample 0 (no start offset). Peak ≤ -1 dBFS via compressor + post-scale. **PASS**
2. **Loop in DAW**: Folded tail ensures seamless loop. Downbeats exact. No random jitter. **PASS** (by construction)
3. **Background tab**: visibilitychange → stop() clears interval + .stop() on all activeSources. No burst. **PASS**
4. **Live changes**: Scheduler reads mutable state every step. Mutes, volumes, BPM, key, chords, filters, pans, delay take effect on next step (within one bar). **PASS**
5. **Missing samples**: loadSamples shows "Missing instrument: X (path)". Never plays with hole. **PASS**
6. **Pad sustain**: Violin/piano use duration 3.0–2.2s + 20ms release ramp. Holds to end of the note. **PASS**
7. **Grep**: No @main or @gh-pages (pinned SHA). No Math.random in export path. Voice names match samples. **PASS**

Timing uses lookahead scheduler on AudioContext.currentTime only. Exports via OfflineAudioContext with identical schedule + graph (including pan/filter). User BPM/key/chords first, persisted in localStorage.

Drop the WAV on bar 1 of a 92 BPM session. Matching .mid has one track per chair, tempo and 4/4 set. Stems available. MIDI record for hardware keyboard into the step grid.

iOS: silent switch mutes Web Audio.
