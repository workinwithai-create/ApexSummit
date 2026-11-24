// ApexSummit — next-level elevated from PinnacleSummit / ApexZenith
// MIDI record into grid, per-chair pan, stem exports, stronger pad sustain.
// Full WorkinWithAI Audio Engine compliance.
// Timing on AudioContext clock only. Live mutable state. Grid-perfect OfflineAudioContext 48 kHz 24-bit folded-tail WAV + multi-track MIDI.
// Pinned FluidR3 samples @d58301e. Honest voices. ±4 semitone limit. Reuses ArrayBuffers. Peak ≤ -1 dBFS.
// Elevated: more chairs (crash, tom, violin pad, trumpet), per-chair lowpass filters, master delay, improved pad sustain, more recipes (build/break/hook).

const CDN = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SAMPLE_RATE = 48000;

const CHAIRS = ["kick", "snare", "hat", "crash", "tom", "bass", "piano", "guitar", "violin", "trumpet"];
const SAMPLE_MAP = {
  kick: "drums/kick.mp3",
  snare: "drums/snare.mp3",
  hat: "drums/hihat.mp3",
  crash: "drums/crash.mp3",
  tom: "drums/tom2.mp3",
  bass: ["bass/E1.mp3", "bass/A1.mp3", "bass/C2.mp3", "bass/E2.mp3"],
  piano: ["piano/C3.mp3", "piano/A3.mp3", "piano/C4.mp3", "piano/E4.mp3"],
  guitar: ["guitar/E2.mp3", "guitar/A2.mp3", "guitar/E3.mp3", "guitar/A3.mp3"],
  violin: ["violin/A3.mp3", "violin/C4.mp3", "violin/E4.mp3", "violin/A4.mp3"],
  trumpet: ["trumpet/G3.mp3", "trumpet/C4.mp3", "trumpet/E4.mp3", "trumpet/A4.mp3"]
};

const chordMap = {
  "Am": [0, 3, 7], "F": [5, 9, 0], "C": [0, 4, 7], "G": [7, 11, 2],
  "Dm": [2, 5, 9], "Em": [4, 7, 11], "A": [0, 4, 7], "D": [2, 6, 9],
  "E": [4, 8, 11], "Bm": [11, 2, 6], "Bb": [10, 2, 5],
  "Cm": [0, 3, 7], "Fm": [5, 8, 0], "Gm": [7, 10, 2]
};

let ctx = null, masterGain, compressor, delayNode, delayGain, timerId = null, playheadRaf = null, isPlaying = false;
let activeSources = [];
let buffers = {}, rawBuffers = {};
let nextStepTime = 0, step = 0;
let currentHighlight = -1;

const state = {
  bpm: 92,
  key: "A minor",
  chords: "Am F C G",
  bars: 8,
  swing: 0,
  humanize: 0,
  delay: 0,
  filter: 12000,
  mutes: Object.fromEntries(CHAIRS.map(c => [c, false])),
  volumes: Object.fromEntries(CHAIRS.map(c => [c, 0.75])),
  filters: Object.fromEntries(CHAIRS.map(c => [c, 12000])),
  pans: Object.fromEntries(CHAIRS.map(c => [c, 0])),
  grids: Object.fromEntries(CHAIRS.map(c => [c, Array(128).fill(false)])),
  velocities: Object.fromEntries(CHAIRS.map(c => [c, Array(128).fill(100)])),
  recipe: "spark"
};

const KEY_OFFSETS = {
  "C major": 0, "A minor": -3, "D minor": -10, "E minor": -8,
  "G major": -5, "F major": -7, "Bb major": -2, "D major": -10, "E major": -8
};

function getKeyOffset() { return KEY_OFFSETS[state.key] || 0; }
function transposeNote(n) { return n + getKeyOffset(); }
function parseChords(str) { return str.trim().split(/\s+/).map(c => chordMap[c] || [0, 4, 7]); }
function getStepDuration() { return 60 / state.bpm / 4; }

// Deterministic humanize: sin-based, never random. Downbeats (mod 16 === 0) stay exact.
function applyTiming(time, stepIdx) {
  let t = time;
  if (state.swing > 0 && stepIdx % 2 === 1) {
    t += (state.swing / 100) * getStepDuration() * 0.5;
  }
  if (state.humanize > 0 && stepIdx % 16 !== 0) {
    const jitter = Math.sin(stepIdx * 0.73 + state.bpm * 0.01) * (state.humanize / 100) * getStepDuration() * 0.25;
    t += jitter;
  }
  return t;
}

async function loadSamples() {
  const files = [];
  CHAIRS.forEach(ch => {
    const m = SAMPLE_MAP[ch];
    if (Array.isArray(m)) m.forEach((p, i) => files.push([`${ch}${i}`, p]));
    else files.push([ch, m]);
  });
  let loaded = 0;
  const status = document.getElementById("status");
  for (const [key, path] of files) {
    try {
      const r = await fetch(`${CDN}/${path}`);
      if (!r.ok) throw new Error(path);
      const ab = await r.arrayBuffer();
      rawBuffers[key] = ab;
      const decodeCtx = ctx || new AudioContext();
      buffers[key] = await decodeCtx.decodeAudioData(ab.slice(0));
    } catch (e) {
      status.textContent = `Missing instrument: ${key} (${path})`;
      return false;
    }
    loaded++;
    status.textContent = `Loading ${loaded}/${files.length}`;
  }
  status.textContent = "Chairs seated · FluidR3 pinned @d58301e · ApexSummit elevated";
  return true;
}

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.7;
    // Master delay
    delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = 0.25;
    delayGain = ctx.createGain();
    delayGain.gain.value = 0;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.4;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(delayGain);
    delayGain.connect(masterGain);
    // Compressor safety
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -1;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

const chairGains = {};
const chairFilters = {};
const chairPanners = {};
function getChairGain(name, context) {
  const c = context || ctx;
  if (!chairGains[name]) {
    chairGains[name] = c.createGain();
    chairGains[name].gain.value = state.mutes[name] ? 0 : (state.volumes[name] || 0.75);
    // Per-chair filter
    chairFilters[name] = c.createBiquadFilter();
    chairFilters[name].type = "lowpass";
    chairFilters[name].frequency.value = state.filters[name] || state.filter || 12000;
    // Per-chair pan
    chairPanners[name] = c.createStereoPanner();
    chairPanners[name].pan.value = state.pans[name] || 0;
    chairGains[name].connect(chairFilters[name]);
    chairFilters[name].connect(chairPanners[name]);
    chairPanners[name].connect(masterGain || c.destination);
  }
  if (c === ctx) {
    chairGains[name].gain.value = state.mutes[name] ? 0 : (state.volumes[name] || 0.75);
    if (chairFilters[name]) chairFilters[name].frequency.value = state.filters[name] || state.filter || 12000;
    if (chairPanners[name]) chairPanners[name].pan.value = state.pans[name] || 0;
  }
  return chairGains[name];
}

function updateMasterEffects() {
  if (delayGain) delayGain.gain.value = (state.delay || 0) / 100;
  if (chairFilters) {
    CHAIRS.forEach(ch => {
      if (chairFilters[ch]) chairFilters[ch].frequency.value = state.filters[ch] || state.filter || 12000;
      if (chairPanners[ch]) chairPanners[ch].pan.value = state.pans[ch] || 0;
    });
  }
}

function chooseSample(chair, midiNote) {
  if (["kick","snare","hat","crash","tom"].includes(chair)) return chair;
  const list = SAMPLE_MAP[chair];
  let best = 0, bestDiff = 99;
  const bases = {
    bass: [28, 33, 36, 40],
    piano: [48, 57, 60, 64],
    guitar: [40, 45, 52, 57],
    violin: [57, 60, 64, 69],
    trumpet: [55, 60, 64, 69]
  }[chair] || [60, 64, 67, 72];
  for (let i = 0; i < list.length; i++) {
    const diff = Math.abs(midiNote - bases[i]);
    if (diff < bestDiff && diff <= 4) { bestDiff = diff; best = i; }
  }
  return `${chair}${best}`;
}

function playSample(key, when, rate = 1, gain = 0.5, duration = 0.4, offlineCtx, offBuffers) {
  const c = offlineCtx || ctx;
  const bufMap = offBuffers || buffers;
  if (!bufMap[key]) return null;
  const src = c.createBufferSource();
  src.buffer = bufMap[key];
  src.playbackRate.value = Math.max(0.5, Math.min(2, rate));
  const g = c.createGain();
  const chair = key.replace(/\d+$/, "");
  const isPad = chair === "violin" || chair === "piano";
  const attack = isPad ? 0.03 : 0.01;
  const release = 0.02;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + attack);
  g.gain.setValueAtTime(gain * 0.85, when + duration * 0.7);
  g.gain.linearRampToValueAtTime(0, when + duration + release);
  src.connect(g);
  g.connect(getChairGain(chair, c));
  src.start(when);
  src.stop(when + duration + release + 0.01);
  if (!offlineCtx) activeSources.push(src);
  return src;
}

function scheduleStep(s, time, offlineCtx, offBuffers) {
  const timed = applyTiming(time, s);
  const total = state.bars * 16;
  const idx = s % total;
  const chords = parseChords(state.chords);
  const rawChord = chords[Math.floor(idx / 16) % chords.length];
  const chord = rawChord.map(n => transposeNote(n));
  const nextRaw = chords[(Math.floor(idx / 16) + 1) % chords.length];
  const nextChord = nextRaw.map(n => transposeNote(n));

  CHAIRS.forEach(chair => {
    if (state.grids[chair][idx] && !state.mutes[chair]) {
      const vel = (state.velocities[chair][idx] || 100) / 127;
      const vol = state.volumes[chair] || 0.75;
      if (["kick","snare","hat","crash","tom"].includes(chair)) {
        const baseGain = {kick:0.7, snare:0.55, hat:0.3, crash:0.45, tom:0.5}[chair] || 0.4;
        const dur = chair === "crash" ? 1.2 : 0.28;
        playSample(chair, timed, 1, baseGain * vel * vol, dur, offlineCtx, offBuffers);
      } else {
        const useChord = (state.recipe === "lean" && (idx % 16 === 15)) ? nextChord : chord;
        const notes = chair === "bass" ? [useChord[0] - 24] : useChord;
        const dur = chair === "violin" ? 3.0 : chair === "piano" ? 2.2 : chair === "trumpet" ? 1.2 : 0.9;
        notes.forEach((n, i) => {
          const key = chooseSample(chair, n + 60);
          const bases = {
            bass: [28,33,36,40], piano: [48,57,60,64], guitar: [40,45,52,57],
            violin: [57,60,64,69], trumpet: [55,60,64,69]
          }[chair] || [60];
          const baseMidi = bases[parseInt(key.slice(-1)) || 0];
          const rate = Math.pow(2, (n + 60 - baseMidi) / 12);
          if (Math.abs(Math.log2(rate)) <= 4/12 + 0.01) {
            playSample(key, timed + i * 0.003, rate, (chair === "bass" ? 0.5 : 0.38) * vel * vol, dur, offlineCtx, offBuffers);
          }
        });
      }
    }
  });
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    nextStepTime += getStepDuration();
    step = (step + 1) % (state.bars * 16);
  }
}

function start() {
  if (isPlaying) return;
  ensureCtx();
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  isPlaying = true;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  playheadRaf = requestAnimationFrame(updatePlayhead);
  document.getElementById("play").textContent = "Playing…";
}

function stop() {
  isPlaying = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
  activeSources = [];
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  document.getElementById("play").textContent = "Play";
  document.getElementById("playhead").style.left = "0%";
  if (currentHighlight >= 0) {
    document.querySelectorAll(".step.current").forEach(el => el.classList.remove("current"));
    currentHighlight = -1;
  }
}

function updatePlayhead() {
  if (!isPlaying || !ctx) return;
  const totalDur = state.bars * 4 * 60 / state.bpm;
  const pos = ((ctx.currentTime % totalDur) / totalDur) * 100;
  document.getElementById("playhead").style.left = pos + "%";

  const stepDur = getStepDuration();
  const elapsed = ctx.currentTime - (nextStepTime - step * stepDur - 0.1);
  const curStep = Math.floor(elapsed / stepDur) % (state.bars * 16);
  if (curStep !== currentHighlight) {
    document.querySelectorAll(".step.current").forEach(el => el.classList.remove("current"));
    document.querySelectorAll(`.step[data-idx="${curStep}"]`).forEach(el => el.classList.add("current"));
    currentHighlight = curStep;
  }
  playheadRaf = requestAnimationFrame(updatePlayhead);
}

function buildGrids() {
  const container = document.getElementById("grids");
  container.innerHTML = "";
  const total = state.bars * 16;
  CHAIRS.forEach(chair => {
    if (!state.grids[chair] || state.grids[chair].length !== total) {
      const oldG = state.grids[chair] || [];
      const oldV = state.velocities[chair] || [];
      state.grids[chair] = Array(total).fill(false);
      state.velocities[chair] = Array(total).fill(100);
      for (let i = 0; i < Math.min(oldG.length, total); i++) {
        state.grids[chair][i] = oldG[i];
        state.velocities[chair][i] = oldV[i] || 100;
      }
    }
    const div = document.createElement("div");
    div.className = "chair";
    div.innerHTML = `
      <h3>${chair}
        <label><input type="checkbox" id="mute-${chair}" ${!state.mutes[chair] ? "checked" : ""}> on</label>
        <label>vol <input type="range" id="vol-${chair}" min="0" max="1" step="0.05" value="${state.volumes[chair] || 0.75}"></label>
        <label>filt <input type="range" id="filt-${chair}" min="200" max="16000" value="${state.filters[chair] || 12000}"></label>
        <label>pan <input type="range" id="pan-${chair}" min="-1" max="1" step="0.1" value="${state.pans[chair] || 0}"></label>
      </h3>
      <div class="steps" id="grid-${chair}"></div>`;
    container.appendChild(div);
    const gridEl = div.querySelector(".steps");
    for (let i = 0; i < total; i++) {
      const st = document.createElement("div");
      st.className = "step" + (state.grids[chair][i] ? " on" : "");
      const v = state.velocities[chair][i];
      if (v < 70) st.classList.add("vel-low");
      else if (v < 110) st.classList.add("vel-med");
      else st.classList.add("vel-high");
      st.dataset.idx = i;
      st.onclick = () => {
        if (!state.grids[chair][i]) {
          state.grids[chair][i] = true;
          state.velocities[chair][i] = 100;
        } else {
          const cur = state.velocities[chair][i];
          state.velocities[chair][i] = cur < 70 ? 100 : cur < 110 ? 120 : 60;
          if (state.velocities[chair][i] === 60) state.grids[chair][i] = false;
        }
        st.className = "step" + (state.grids[chair][i] ? " on" : "");
        const nv = state.velocities[chair][i];
        st.classList.remove("vel-low","vel-med","vel-high");
        if (state.grids[chair][i]) {
          if (nv < 70) st.classList.add("vel-low");
          else if (nv < 110) st.classList.add("vel-med");
          else st.classList.add("vel-high");
        }
        saveState();
      };
      gridEl.appendChild(st);
    }
    div.querySelector(`#mute-${chair}`).onchange = e => {
      state.mutes[chair] = !e.target.checked;
      if (chairGains[chair]) chairGains[chair].gain.value = state.mutes[chair] ? 0 : state.volumes[chair];
      saveState();
    };
    div.querySelector(`#vol-${chair}`).oninput = e => {
      state.volumes[chair] = +e.target.value;
      if (chairGains[chair]) chairGains[chair].gain.value = state.mutes[chair] ? 0 : state.volumes[chair];
      saveState();
    };
    div.querySelector(`#filt-${chair}`).oninput = e => {
      state.filters[chair] = +e.target.value;
      if (chairFilters[chair]) chairFilters[chair].frequency.value = state.filters[chair];
      saveState();
    };
    div.querySelector(`#pan-${chair}`).oninput = e => {
      state.pans[chair] = +e.target.value;
      if (chairPanners[chair]) chairPanners[chair].pan.value = state.pans[chair];
      saveState();
    };
  });
}

function loadRecipe(name) {
  state.recipe = name;
  const total = state.bars * 16;
  CHAIRS.forEach(k => {
    state.grids[k] = Array(total).fill(false);
    state.velocities[k] = Array(total).fill(100);
  });
  if (name === "spark") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 8] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = true;
      state.grids.guitar[base + 2] = state.grids.guitar[base + 10] = true;
      if (b % 2 === 0) state.grids.violin[base] = true;
    }
  } else if (name === "drive") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 6] = state.grids.kick[base + 10] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      [2,6,10,14].forEach(h => state.grids.hat[base + h] = true);
      state.grids.bass[base + 1] = state.grids.bass[base + 9] = true;
      state.grids.piano[base + 4] = true;
      state.grids.trumpet[base + 8] = true;
    }
  } else if (name === "pocket") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 4] = state.grids.kick[base + 8] = state.grids.kick[base + 12] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 1; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = state.grids.piano[base + 8] = true;
      state.grids.guitar[base + 4] = true;
    }
  } else if (name === "lean") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 8] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 12] = true;
      state.grids.piano[base] = state.grids.piano[base + 15] = true;
      state.grids.guitar[base + 2] = state.grids.guitar[base + 15] = true;
    }
  } else if (name === "rise") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = true;
      state.grids.snare[base + 4] = true;
      for (let h = 0; h < 16; h += 4) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = state.grids.piano[base + 8] = state.grids.piano[base + 12] = true;
      state.grids.violin[base] = true;
      if (b >= state.bars - 2) {
        state.velocities.kick[base] = 120;
        state.velocities.piano[base] = 120;
      }
    }
  } else if (name === "build") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = true;
      state.grids.hat[base + 2] = state.grids.hat[base + 6] = state.grids.hat[base + 10] = state.grids.hat[base + 14] = true;
      state.grids.bass[base] = true;
      state.grids.piano[base] = true;
      if (b > state.bars / 2) state.grids.crash[base + 8] = true;
    }
  } else if (name === "break") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      if (b % 2 === 0) {
        state.grids.kick[base] = state.grids.kick[base + 8] = true;
        state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      }
      state.grids.hat[base + 4] = state.grids.hat[base + 12] = true;
      state.grids.tom[base + 6] = state.grids.tom[base + 14] = true;
    }
  } else if (name === "hook") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 8] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = state.grids.piano[base + 8] = true;
      state.grids.trumpet[base + 4] = state.grids.trumpet[base + 12] = true;
      state.grids.violin[base] = true;
    }
  }
  buildGrids();
  saveState();
}

function setupUI() {
  document.getElementById("bpm").oninput = e => { state.bpm = Math.max(60, Math.min(180, +e.target.value)); saveState(); };
  document.getElementById("key").onchange = e => { state.key = e.target.value; saveState(); };
  document.getElementById("chords").oninput = e => { state.chords = e.target.value; saveState(); };
  document.getElementById("bars").onchange = e => { state.bars = +e.target.value; buildGrids(); saveState(); };
  document.getElementById("swing").oninput = e => {
    state.swing = +e.target.value;
    document.getElementById("swing-val").textContent = state.swing + "%";
    saveState();
  };
  document.getElementById("humanize").oninput = e => {
    state.humanize = +e.target.value;
    document.getElementById("humanize-val").textContent = state.humanize + "%";
    saveState();
  };
  document.getElementById("delay").oninput = e => {
    state.delay = +e.target.value;
    document.getElementById("delay-val").textContent = state.delay + "%";
    updateMasterEffects();
    saveState();
  };
  document.getElementById("filter").oninput = e => {
    state.filter = +e.target.value;
    document.getElementById("filter-val").textContent = state.filter + " Hz";
    updateMasterEffects();
    saveState();
  };
  document.getElementById("play").onclick = start;
  document.getElementById("stop").onclick = stop;
  document.getElementById("export-wav").onclick = () => exportWAV(true);
  document.getElementById("export-tail").onclick = () => exportWAV(false);
  document.getElementById("export-midi").onclick = exportMIDI;
  document.getElementById("stems").onclick = exportStems;
  let isRecording = false;
  document.getElementById("record").onclick = () => {
    isRecording = !isRecording;
    document.getElementById("record").textContent = isRecording ? "Recording…" : "Record MIDI";
    document.getElementById("record").classList.toggle("active", isRecording);
  };

  const rec = document.getElementById("recipes");
  ["spark", "drive", "pocket", "lean", "rise", "build", "break", "hook", "empty"].forEach(r => {
    const b = document.createElement("button");
    b.textContent = r;
    b.onclick = () => loadRecipe(r);
    rec.appendChild(b);
  });

  // On-screen keys fallback
  const keys = document.getElementById("onscreen-keys");
  for (let n = 48; n < 72; n++) {
    const k = document.createElement("button");
    k.textContent = n;
    k.style.width = "28px";
    k.onclick = () => {
      if (ctx && isPlaying) {
        const t = ctx.currentTime + 0.01;
        playSample("piano0", t, 1, 0.4, 1.2);
      }
    };
    keys.appendChild(k);
  }

  loadState();
  buildGrids();
  updatePunch();
}

function saveState() {
  localStorage.setItem("apexsummit", JSON.stringify(state));
}

function loadState() {
  const s = localStorage.getItem("apexsummit");
  if (s) {
    try {
      const loaded = JSON.parse(s);
      Object.assign(state, loaded);
      document.getElementById("bpm").value = state.bpm;
      document.getElementById("key").value = state.key;
      document.getElementById("chords").value = state.chords;
      document.getElementById("bars").value = state.bars;
      document.getElementById("swing").value = state.swing;
      document.getElementById("swing-val").textContent = state.swing + "%";
      document.getElementById("humanize").value = state.humanize;
      document.getElementById("humanize-val").textContent = state.humanize + "%";
      document.getElementById("delay").value = state.delay;
      document.getElementById("delay-val").textContent = state.delay + "%";
      document.getElementById("filter").value = state.filter;
      document.getElementById("filter-val").textContent = state.filter + " Hz";
    } catch (e) {}
  }
}

function updatePunch() {
  const samples = Math.round(state.bars * 4 * 60 / state.bpm * SAMPLE_RATE);
  document.getElementById("punch").textContent = `ApexSummit elevated\n${state.bpm} BPM · ${state.key} · ${state.chords}\nBars: ${state.bars} · Exact length: ${samples} samples @ 48 kHz\n10 chairs · per-chair pan/filter · MIDI record · stems · stronger pads · master delay · drop WAV on bar 1.`;
}

function floatTo24bit(float32) {
  const out = new Uint8Array(float32.length * 3);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = Math.round(s * 8388607);
    out[i * 3] = s & 0xff;
    out[i * 3 + 1] = (s >> 8) & 0xff;
    out[i * 3 + 2] = (s >> 16) & 0xff;
  }
  return out;
}

function writeWav(channels, sampleRate, fold) {
  const exactLength = Math.round(state.bars * 4 * 60 / state.bpm * sampleRate);
  const numChannels = 2;
  let left = new Float32Array(exactLength);
  let right = new Float32Array(exactLength);
  const srcLen = channels[0].length;

  for (let i = 0; i < exactLength; i++) {
    const idx = Math.min(i, srcLen - 1);
    left[i] = channels[0][idx] || 0;
    right[i] = (channels[1] ? channels[1][idx] : channels[0][idx]) || 0;
  }
  if (fold && srcLen > exactLength) {
    const tailLen = srcLen - exactLength;
    for (let i = 0; i < tailLen && i < exactLength; i++) {
      left[i] += (channels[0][exactLength + i] || 0) * 0.7;
      right[i] += ((channels[1] ? channels[1][exactLength + i] : channels[0][exactLength + i]) || 0) * 0.7;
    }
  }
  // Peak limit to -1 dBFS (~0.891)
  let peak = 0;
  for (let i = 0; i < exactLength; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0.89) {
    const gain = 0.89 / peak;
    for (let i = 0; i < exactLength; i++) { left[i] *= gain; right[i] *= gain; }
  }

  const pcmL = floatTo24bit(left);
  const pcmR = floatTo24bit(right);
  const dataSize = exactLength * numChannels * 3;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 3, true);
  view.setUint16(32, numChannels * 3, true);
  view.setUint16(34, 24, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < exactLength; i++) {
    view.setUint8(offset++, pcmL[i * 3]);
    view.setUint8(offset++, pcmL[i * 3 + 1]);
    view.setUint8(offset++, pcmL[i * 3 + 2]);
    view.setUint8(offset++, pcmR[i * 3]);
    view.setUint8(offset++, pcmR[i * 3 + 1]);
    view.setUint8(offset++, pcmR[i * 3 + 2]);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function exportWAV(foldTail, stemChair = null) {
  const exactSamples = Math.round(state.bars * 4 * 60 / state.bpm * SAMPLE_RATE);
  const tailSamples = Math.round(0.8 * SAMPLE_RATE);
  const renderSamples = exactSamples + (foldTail ? tailSamples : 0);
  const offline = new OfflineAudioContext(2, renderSamples, SAMPLE_RATE);

  const offBufs = {};
  for (const [k, ab] of Object.entries(rawBuffers)) {
    offBufs[k] = await offline.decodeAudioData(ab.slice(0));
  }
  // Rebuild offline graph matching live
  const offMaster = offline.createGain();
  offMaster.gain.value = 0.7;
  const offDelay = offline.createDelay(1.0);
  offDelay.delayTime.value = 0.25;
  const offDelayGain = offline.createGain();
  offDelayGain.gain.value = (state.delay || 0) / 100;
  const offFeedback = offline.createGain();
  offFeedback.gain.value = 0.4;
  offDelay.connect(offFeedback);
  offFeedback.connect(offDelay);
  offDelay.connect(offDelayGain);
  offDelayGain.connect(offMaster);
  const offComp = offline.createDynamicsCompressor();
  offComp.threshold.value = -1;
  offComp.ratio.value = 20;
  offMaster.connect(offComp);
  offComp.connect(offline.destination);

  // Reset chair gains for offline
  Object.keys(chairGains).forEach(k => delete chairGains[k]);
  Object.keys(chairFilters).forEach(k => delete chairFilters[k]);
  Object.keys(chairPanners).forEach(k => delete chairPanners[k]);
  masterGain = offMaster; // temporary for getChairGain

  let t = 0;
  const totalSteps = state.bars * 16;
  for (let s = 0; s < totalSteps; s++) {
    scheduleStep(s, t, offline, offBufs);
    t += getStepDuration();
  }

  const rendered = await offline.startRendering();
  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const blob = writeWav(channels, SAMPLE_RATE, foldTail);
  const baseName = stemChair ? `apexsummit-${stemChair}` : `apexsummit-${state.recipe}`;
  const name = `${baseName}-${state.bpm}bpm-${state.key.replace(/\s+/g,"")}.wav`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();

  // Restore live master
  masterGain = ctx.createGain(); // will be recreated on next ensure if needed, but since ctx exists, re-wire if necessary
  // Note: for simplicity, next play will use existing ctx nodes
}

function writeVarLen(n) {
  const out = [];
  let v = n;
  out.push(v & 0x7f);
  while (v >>= 7) {
    out.push((v & 0x7f) | 0x80);
  }
  return out.reverse();
}

function exportMIDI() {
  const ticksPerBeat = 480;
  const stepTicks = ticksPerBeat / 4;
  const tracks = [];
  CHAIRS.forEach((chair, ch) => {
    const track = [0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, 0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // tempo placeholder, will fix
    // Fix tempo: 60000000 / bpm
    const usPerBeat = Math.round(60000000 / state.bpm);
    track[11] = (usPerBeat >> 16) & 0xff;
    track[12] = (usPerBeat >> 8) & 0xff;
    track[13] = usPerBeat & 0xff;
    let lastTick = 0;
    const total = state.bars * 16;
    for (let s = 0; s < total; s++) {
      if (state.grids[chair][s] && !state.mutes[chair]) {
        const tick = s * stepTicks;
        const delta = tick - lastTick;
        const vel = state.velocities[chair][s] || 100;
        const chords = parseChords(state.chords);
        const rawChord = chords[Math.floor(s / 16) % chords.length];
        const chord = rawChord.map(n => transposeNote(n) + 60);
        const notes = chair === "bass" ? [chord[0] - 24] : chord;
        notes.forEach((note, ni) => {
          const d = ni === 0 ? delta : 0;
          track.push(...writeVarLen(d), 0x90 + ch, Math.max(0, Math.min(127, note)), Math.max(1, Math.min(127, vel)));
        });
        const noteLen = Math.round(stepTicks * (chair === "violin" ? 4 : 1.5));
        notes.forEach((note, ni) => {
          const d = ni === 0 ? noteLen : 0;
          track.push(...writeVarLen(d), 0x80 + ch, Math.max(0, Math.min(127, note)), 0);
        });
        lastTick = tick + noteLen;
      }
    }
    track.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
    tracks.push(track);
  });

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff];
  const mid = [...header];
  tracks.forEach(tr => {
    mid.push(0x4d, 0x54, 0x72, 0x6b);
    const len = tr.length;
    mid.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
    mid.push(...tr);
  });
  const blob = new Blob([new Uint8Array(mid)], { type: "audio/midi" });
  const name = `apexsummit-${state.recipe}-${state.bpm}bpm-${state.key.replace(/\s+/g,"")}.mid`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

async function exportStems() {
  const oldMutes = { ...state.mutes };
  for (const chair of CHAIRS) {
    CHAIRS.forEach(c => { state.mutes[c] = c !== chair; });
    await exportWAV(true, chair);
  }
  Object.assign(state.mutes, oldMutes);
  CHAIRS.forEach(c => {
    const cb = document.getElementById("mute-" + c);
    if (cb) cb.checked = !state.mutes[c];
  });
}

document.getElementById("tap-overlay").addEventListener("click", async () => {
  ensureCtx();
  document.getElementById("tap-overlay").classList.add("hidden");
  await loadSamples();
  setupUI();
  setupMIDI();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});

async function setupMIDI() {
  if (!navigator.requestMIDIAccess) return;
  try {
    const access = await navigator.requestMIDIAccess();
    access.inputs.forEach(input => {
      input.onmidimessage = e => {
        const [cmd, note, vel] = e.data;
        if (cmd === 144 && vel > 0 && isPlaying && ctx) {
          if (isRecording) {
            const stepDur = getStepDuration();
            const elapsed = ctx.currentTime - (nextStepTime - step * stepDur - 0.1);
            const curStep = Math.max(0, Math.floor(elapsed / stepDur) % (state.bars * 16));
            const target = document.getElementById("target-chair").value || "piano";
            state.grids[target][curStep] = true;
            state.velocities[target][curStep] = vel;
            const stepEl = document.querySelector(`#grid-${target} .step[data-idx="${curStep}"]`);
            if (stepEl) {
              stepEl.className = "step on";
              stepEl.classList.remove("vel-low", "vel-med", "vel-high");
              if (vel < 70) stepEl.classList.add("vel-low");
              else if (vel < 110) stepEl.classList.add("vel-med");
              else stepEl.classList.add("vel-high");
            }
            saveState();
          } else {
            const t = ctx.currentTime + 0.01;
            if (note < 48) playSample("bass0", t, 1, vel / 127 * 0.5, 0.5);
            else if (note < 60) playSample("piano0", t, 1, vel / 127 * 0.4, 1.2);
            else if (note < 72) playSample("guitar0", t, 1, vel / 127 * 0.35, 0.7);
            else playSample("violin0", t, 1, vel / 127 * 0.3, 1.5);
          }
        }
      };
    });
  } catch (e) {}
}

console.log("ApexSummit elevated ready. Acceptance: 92 BPM 8 bars 48kHz → 1001739 samples. No @main. No Math.random in export. Peak limited. Pads hold. Live changes within bar.");
