'use strict';

const $ = id => document.getElementById(id);
const { CHORD_TYPES, ROOTS } = Theory;

// ---------- Settings & state ----------

const NOT_QUITE_DELAY_MS = 250;  // the same wrong notes must sound this long before "Not quite" shows
const FEEDBACK_HOLD_MS = 2500;   // how long a "Not quite" message stays after the notes stop
const MIDI_MISS_MS = 150;        // a wrong chord must last this long to count as a miss...
const MIC_MISS_MS = 500;         // ...longer on the mic, so stray noise doesn't count
const CELEBRATE_MS = 600;

const settings = {
  instrument: 'guitar',
  tunings: { guitar: 'standard', ukulele: 'gceaHigh' },
  customTunings: { guitar: [], ukulele: [] },
  input: 'mic',
  mode: 'drill',
  selection: {},             // instrument id -> chord keys to drill
  shapes: {},                // tuning key -> { chord key: frets of the chosen shape, e.g. "3,5,5,4,3,3" }
  showDiagram: true,
  showTab: false,
  compareTunings: false,     // show the current chord in every tuning
  showPositions: false,      // show other ways to play the current chord
  gridAll: false,            // show every chord type in the chord grid, not just the common ones
  order: 'smart',
  goal: 3,
  lenient: true,
  leftHanded: false,
  prog: 'preset:blues12',
  progKeys: {},              // progression id -> key
  progTranspose: {},         // progression id -> semitones
  customProgs: [],           // { id, name, text }
  playMode: 'wait',
  tempo: 70,
  beats: 4,
  click: true,
  loop: true,
  oneMinuteBest: {},         // "a>b" -> best count
  micGate: -70,
  micRange: 30,
  micCalibrated: false,      // the noise filter has been set from a measurement of the room
};

const state = {
  mic: [], midi: new Set(), clicked: new Map(),   // notes from each input; clicked: string -> fret
  progress: null,
  // drill
  chord: null, shape: null, recent: [], shownAt: 0, hintShown: false, celebrating: false, prev: null,
  wrongSince: null, wrongMs: -1, judgedKey: null,
  // play along
  play: null,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('fretTutorSettings'));
    if (saved) {
      // Shape choices were once saved as positions in a list that has since changed; drop those.
      for (const map of Object.values(saved.shapes ?? {})) {
        for (const [k, v] of Object.entries(map)) if (typeof v !== 'string') delete map[k];
      }
      Object.assign(settings, saved);
    }
  } catch { /* storage unavailable: defaults */ }
}

function saveSettings() {
  try { localStorage.setItem('fretTutorSettings', JSON.stringify(settings)); } catch { }
}

// ---------- Instrument & shapes ----------

const instrument = () => INSTRUMENTS.find(i => i.id === settings.instrument);
const allTunings = () => [...instrument().tunings, ...(settings.customTunings[settings.instrument] || [])];
const tuning = () => allTunings().find(t => t.id === settings.tunings[settings.instrument]) || instrument().tunings[0];
const tuningKey = () => `${settings.instrument}:${tuning().strings.join('-')}`;

const shapeCache = new Map();
function shapesForTuning(chord, t) {
  const key = `${settings.instrument}:${t.strings.join('-')}|${chord.key}`;
  if (!shapeCache.has(key)) shapeCache.set(key, Voicings.positions(chord, t.strings, instrument(), 5, t.standard?.[chord.symbol]));
  return shapeCache.get(key);
}
const shapesFor = chord => shapesForTuning(chord, tuning());

// The shape the player chose for this chord in this tuning, if any.
const chosenFrets = (chord, key = tuningKey()) => settings.shapes[key]?.[chord.key];

function shapeFor(chord) {
  const list = shapesFor(chord);
  const chosen = chosenFrets(chord);
  return list.find(s => s.frets.join() === chosen) ?? list[0] ?? null;
}

function noteNames(shape, chord) {
  return shape.notes.map(n => (n === null ? '' : Theory.pcName(n % 12, chord)));
}

function useProgress() {
  state.progress = Progress.create('fretTutorProgress:' + tuningKey());
}

// ---------- Input: microphone, MIDI and the clickable fretboard ----------

function heldNotes() {
  const strings = tuning().strings;
  const notes = new Set([...state.mic, ...state.midi]);
  for (const [s, f] of state.clicked) notes.add(strings[s] + f);
  return [...notes].sort((a, b) => a - b);
}

function inputChanged() {
  renderHeard();
  if (settings.mode === 'drill') evaluateDrill();
  else if (settings.mode === 'play') evaluatePlay();
  renderBoard();
}

let midiAccess = null, midiRequest = null, midiError = '', micError = '', activeInput = null;
const inputChoice = () => $('input-select').value;

function onMidiMessage(e) {
  const [status, d1, d2] = e.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0) state.midi.add(d1);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) state.midi.delete(d1);
  else if (cmd === 0xb0 && (d1 === 123 || d1 === 120)) state.midi.clear();
  else return;
  inputChanged();
}

function refreshInputs() {
  const select = $('input-select');
  const wanted = settings.input;
  select.innerHTML = '';
  select.append(new Option('Microphone', 'mic'));
  select.append(new Option(midiAccess ? 'MIDI: all inputs' : 'MIDI', 'midi:all'));
  if (midiAccess) for (const input of midiAccess.inputs.values()) select.append(new Option('MIDI: ' + input.name, 'midi:' + input.id));
  select.value = [...select.options].some(o => o.value === wanted) ? wanted : wanted.startsWith('midi:') ? 'midi:all' : 'mic';
  if (select.value !== activeInput) selectInput();
  else attachMidi();
  renderInputStatus();
}

function attachMidi() {
  if (!midiAccess) return;
  const chosen = inputChoice();
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = chosen === 'midi:all' || chosen === 'midi:' + input.id ? onMidiMessage : null;
  }
}

function ensureMidi() {
  if (midiAccess || midiError) return Promise.resolve();
  if (!navigator.requestMIDIAccess) { midiError = 'MIDI: not supported (use Chrome or Edge)'; return Promise.resolve(); }
  midiRequest ??= navigator.requestMIDIAccess()
    .then(access => { midiAccess = access; midiAccess.onstatechange = refreshInputs; })
    .catch(() => { midiError = 'MIDI: permission denied'; })
    .then(refreshInputs);
  return midiRequest;
}

function renderInputStatus() {
  const el = $('input-status');
  let text, ok;
  if (inputChoice() === 'mic') {
    ok = MicInput.isRunning();
    text = ok ? 'Mic: listening' : micError || (MicInput.isWaitingForClick() ? 'Mic: click anywhere to start' : 'Mic: starting…');
  } else if (midiError) { ok = false; text = midiError; }
  else if (!midiAccess) { ok = false; text = 'MIDI: waiting for permission'; }
  else {
    const n = midiAccess.inputs.size;
    ok = n > 0;
    text = ok ? `MIDI: ${n} input${n > 1 ? 's' : ''}` : 'MIDI: no devices found';
  }
  el.textContent = text;
  el.className = 'status ' + (ok ? 'on' : 'off');
}

async function selectInput() {
  activeInput = inputChoice();
  state.mic = [];
  state.midi.clear();
  attachMidi();
  const mic = activeInput === 'mic';
  $('mic-panel').hidden = !mic;
  micError = '';
  renderInputStatus();
  if (mic) {
    try {
      await MicInput.start({ onChange: notes => { if (!calibration) { state.mic = notes; inputChanged(); } }, onFrame, onState: renderInputStatus });
      if (!settings.micCalibrated) startCalibration();
    } catch (err) {
      micError = err.name === 'NotAllowedError' ? 'Mic: permission denied' : 'Mic: not available';
    }
  } else {
    MicInput.stop();
    await ensureMidi();
  }
  renderInputStatus();
  inputChanged();
}

function onFrame(frame) {
  calibrationFrame(frame);
  $('mic-level').style.width = Math.min(100, Math.max(0, (frame.levelDb + 60) / 60 * 100)) + '%';
  if (settings.mode === 'tuner') tunerFrame(frame);
  drawSpectrum(frame);
}

// Slider positions as words; the underlying dB values mean little to most people.
const level = (v, min, max) => ['very low', 'low', 'medium', 'high', 'very high'][Math.min(4, Math.floor((v - min) / (max - min) * 5))];

function buildMicPanel() {
  for (const [id, key, micKey] of [['mic-gate', 'micGate', 'gateDb'], ['mic-range', 'micRange', 'rangeDb']]) {
    const input = $(id);
    const show = () => { $(id + '-val').textContent = level(Number(input.value), Number(input.min), Number(input.max)); };
    input.value = settings[key];
    MicInput.settings[micKey] = Number(input.value);
    show();
    input.addEventListener('input', () => {
      settings[key] = MicInput.settings[micKey] = Number(input.value);
      show();
      saveSettings();
    });
  }
  $('mic-show').addEventListener('change', e => { $('mic-canvas').hidden = !e.target.checked; });
  $('mic-calibrate').addEventListener('click', e => { if (MicInput.isRunning()) startCalibration(); e.currentTarget.blur(); });
}

function drawSpectrum(frame) {
  const canvas = $('mic-canvas');
  if (canvas.hidden) return;
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const LO = MicInput.MIN_HZ, HI = MicInput.MAX_HZ, TOP = -10, BOTTOM = -110;
  const x = f => Math.log(f / LO) / Math.log(HI / LO) * W;
  const y = db => (TOP - db) / (TOP - BOTTOM) * H;
  g.fillStyle = '#101216';
  g.fillRect(0, 0, W, H);
  g.font = '11px system-ui';
  for (let m = 36; m <= 108; m += 12) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    if (f < LO || f > HI) continue;
    g.fillStyle = '#2d313b';
    g.fillRect(x(f), 0, 1, H);
    g.fillStyle = '#8b909c';
    g.fillText(Theory.midiName(m), x(f) + 3, H - 4);
  }
  g.fillStyle = 'rgba(255, 93, 93, .5)';
  g.fillRect(0, y(MicInput.settings.gateDb), W, 1);
  g.strokeStyle = '#6aa8ff';
  g.beginPath();
  const { spectrumDb, binHz } = frame;
  const k0 = Math.floor(LO / binHz);
  for (let k = k0; k * binHz <= HI; k++) {
    k === k0 ? g.moveTo(x(k * binHz), y(spectrumDb[k])) : g.lineTo(x(k * binHz), y(spectrumDb[k]));
  }
  g.stroke();
  g.fillStyle = '#3ccf7a';
  for (const n of frame.sounding) {
    const px = x(440 * Math.pow(2, (n - 69) / 12));
    g.fillRect(px - 1, 0, 2, H);
    g.fillText(Theory.midiName(n), px + 4, 14);
  }
}

// ---------- Measuring room noise ----------
//
// The first time the mic starts, listen for 2 seconds of quiet and set the background noise filter
// just above the loudest room noise heard (90th percentile of each moment's loudest peak, plus a
// 6 dB margin). Notes are ignored while measuring. "Measure room noise" runs it again.

const CALIBRATE_MS = 2000;
let calibration = null;

function startCalibration() {
  calibration = { samples: [], until: performance.now() + CALIBRATE_MS };
  MicInput.settings.gateDb = 0; // hear nothing as notes while measuring
  state.mic = [];
  inputChanged();
  $('mic-calibrate').disabled = true;
  $('mic-calib-status').textContent = 'Measuring background noise — please stay quiet for 2 seconds…';
}

function calibrationFrame(frame) {
  if (!calibration) return;
  if (Number.isFinite(frame.maxDb)) calibration.samples.push(frame.maxDb);
  if (performance.now() < calibration.until) return;
  const samples = calibration.samples.sort((a, b) => a - b);
  calibration = null;
  $('mic-calibrate').disabled = false;
  if (samples.length < 10) {
    MicInput.settings.gateDb = settings.micGate;
    $('mic-calib-status').textContent = "Couldn't measure the room — set the filter by hand or try again.";
    return;
  }
  const noise = samples[Math.floor(samples.length * 0.9)];
  const gate = Math.round(Math.min(-40, Math.max(-95, noise + 6)));
  const slider = $('mic-gate');
  slider.value = gate;
  slider.dispatchEvent(new Event('input')); // updates the label, the mic and the saved setting
  settings.micCalibrated = true;
  saveSettings();
  $('mic-calib-status').textContent = gate >= -40
    ? 'Set automatically, but the room was loud. If your playing is missed, measure again in a quieter moment.'
    : `Set automatically to ${$('mic-gate-val').textContent} for this room.`;
}

// ---------- Matching ----------

// Does what's heard count as this chord? Every required tone must sound (the 5th may be left out of
// bigger chords), nothing else may sound (one stray note is forgiven if that option is on), and a
// slash chord on guitar needs its bass note lowest.
function matches(chord, notes) {
  if (!chord || !notes.length) return false;
  const pcs = new Set(notes.map(n => n % 12));
  if (!chord.required.every(pc => pcs.has(pc))) return false;
  const extras = [...pcs].filter(pc => !chord.pcs.includes(pc)).length;
  if (extras > (settings.lenient ? 1 : 0)) return false;
  if (chord.bass !== null && instrument().bassMatters && notes[0] % 12 !== chord.bass) return false;
  return true;
}

// The last chord is still ringing: guitar strings sustain after you've moved on, so notes that all
// belong to the previous chord aren't judged as a wrong answer to the new one.
const stillRinging = (notes, prev) => prev && notes.length && notes.every(n => prev.pcs.includes(n % 12));

function wrongMessage(chord, notes) {
  const pcs = new Set(notes.map(n => n % 12));
  const other = Theory.identify(pcs, notes[0] % 12);
  // Right notes but the wrong bass for a slash chord: say what's needed rather than "that's D".
  const sameChord = other && other.root.pc === chord.root.pc && other.type.id === chord.type.id;
  if (sameChord && chord.bass !== null) return `Right notes — now put ${Theory.pcName(chord.bass, chord)} at the bottom for ${chord.symbol}`;
  if (other && other.key !== chord.key) return `Not quite — that's ${other.symbol}`;
  const missing = chord.required.filter(pc => !pcs.has(pc)).map(pc => Theory.pcName(pc, chord));
  const extra = [...pcs].filter(pc => !chord.pcs.includes(pc)).map(pc => Theory.pcName(pc, chord));
  const parts = [];
  if (missing.length) parts.push('missing ' + missing.join(', '));
  if (extra.length) parts.push('extra ' + extra.join(', '));
  if (!parts.length && chord.bass !== null) parts.push(`${Theory.pcName(chord.bass, chord)} must be the lowest note`);
  return 'Not quite — ' + parts.join('; ');
}

// Feedback for the active mode, with a short delay so stray sounds don't flash a wrong answer.
let feedbackTimer = null, notQuiteTimer = null;
const feedbackEl = () => $(settings.mode === 'play' ? 'play-feedback' : 'drill-feedback');

function setFeedback(text, kind) {
  clearTimeout(feedbackTimer);
  feedbackTimer = null;
  const el = feedbackEl();
  el.textContent = text;
  el.className = 'feedback' + (kind ? ' ' + kind : '');
}

function fadeFeedback() {
  if (!feedbackEl().classList.contains('bad')) return setFeedback('');
  if (!feedbackTimer) feedbackTimer = setTimeout(() => setFeedback(''), FEEDBACK_HOLD_MS);
}

function notQuite(key, text) {
  if (state.judgedKey === key) return setFeedback(text, 'bad');
  clearTimeout(notQuiteTimer);
  notQuiteTimer = setTimeout(() => {
    if (heldNotes().join(',') !== key || state.celebrating) return;
    state.judgedKey = key;
    setFeedback(text, 'bad');
  }, NOT_QUITE_DELAY_MS);
}

function cancelNotQuite() {
  clearTimeout(notQuiteTimer);
  notQuiteTimer = null;
}

// ---------- Chord drill ----------

function selection() {
  const keys = settings.selection[settings.instrument] ??= defaultSelection();
  return keys.map(k => Theory.chordFromKey(k)).filter(c => shapesFor(c).length);
}

function defaultSelection() {
  return CHORD_SETS[settings.instrument][0].chords.map(s => Theory.parseChord(s).key);
}

function nextChord() {
  const chords = selection();
  cancelNotQuite();
  state.clicked.clear();
  state.celebrating = false;
  state.judgedKey = null;
  resetAttempt();
  if (!chords.length) {
    state.chord = null;
    $('drill-name').textContent = '—';
    $('drill-long').textContent = 'Pick some chords to practise below';
    $('drill-badge').hidden = true;
    renderDrill();
    return;
  }
  const chord = state.progress.pick(chords, state.recent, settings.goal, settings.order === 'smart');
  state.recent = [...state.recent, chord.key].slice(-3);
  state.chord = chord;
  state.hintShown = settings.showDiagram;
  state.shownAt = performance.now();
  $('drill-badge').hidden = !(settings.order === 'smart' && state.progress.statsFor(chord.key, settings.goal).tries === 0);
  setFeedback('');
  renderDrill();
}

function evaluateDrill() {
  const chord = state.chord;
  if (!chord || state.celebrating) return;
  const notes = heldNotes();
  const key = notes.join(',');
  if (key !== state.judgedKey) state.judgedKey = null;

  if (!notes.length) {
    cancelNotQuite();
    trackWrong(false);
    if (state.wrongMs >= (inputChoice() === 'mic' ? MIC_MISS_MS : MIDI_MISS_MS)) {
      state.progress.record(chord, { ok: false });
      renderGrid();
    }
    resetAttempt();
    fadeFeedback();
    return;
  }
  if (matches(chord, notes)) {
    cancelNotQuite();
    return drillSuccess();
  }
  if (stillRinging(notes, state.prev)) {
    cancelNotQuite();
    trackWrong(false);
    return;
  }
  const wrong = new Set(notes.map(n => n % 12)).size >= chord.required.length;
  trackWrong(wrong);
  if (wrong) notQuite(key, wrongMessage(chord, notes));
  else { cancelNotQuite(); fadeFeedback(); }
}

function trackWrong(isWrong) {
  const now = performance.now();
  if (isWrong && state.wrongSince === null) state.wrongSince = now;
  if (!isWrong && state.wrongSince !== null) {
    state.wrongMs = Math.max(state.wrongMs, now - state.wrongSince);
    state.wrongSince = null;
  }
}

function resetAttempt() {
  state.wrongSince = null;
  state.wrongMs = -1;
}

function drillSuccess() {
  const secs = (performance.now() - state.shownAt) / 1000;
  state.progress.record(state.chord, { ok: true, time: secs, hint: state.hintShown });
  setFeedback(`Correct! ${secs.toFixed(1)}s` + (state.hintShown ? ' (with diagram)' : ''), 'good');
  state.celebrating = true;
  state.prev = state.chord;
  $('drill-name').classList.add('good');
  renderGrid();
  setTimeout(() => {
    $('drill-name').classList.remove('good');
    if (settings.mode === 'drill') nextChord();
  }, CELEBRATE_MS);
}

function skip() {
  if (!state.chord || state.celebrating) return;
  state.progress.record(state.chord, { ok: false });
  renderGrid();
  nextChord();
}

function renderDrill() {
  const c = state.chord;
  const btnD = $('btn-diagram');
  btnD.textContent = `Diagram: ${settings.showDiagram ? 'on' : 'off'} (Enter)`;
  btnD.setAttribute('aria-pressed', settings.showDiagram);
  const btnT = $('btn-tab');
  btnT.textContent = `Tab: ${settings.showTab ? 'on' : 'off'}`;
  btnT.setAttribute('aria-pressed', settings.showTab);
  const btnC = $('btn-compare');
  btnC.textContent = `Compare tunings: ${settings.compareTunings ? 'on' : 'off'}`;
  btnC.setAttribute('aria-pressed', settings.compareTunings);
  renderCompare();

  state.shape = c ? shapeFor(c) : null;
  if (!c) {
    $('drill-diagram').innerHTML = '';
    $('positions-toggle').hidden = true;
    $('positions').hidden = true;
    $('drill-tab').hidden = true;
    renderBoard();
    return;
  }
  $('drill-name').textContent = c.symbol;
  $('drill-long').textContent = c.longName;
  const showShape = settings.showDiagram && state.shape;
  $('drill-diagram').innerHTML = showShape
    ? Diagram.chordBox(state.shape, tuning().strings, { leftHanded: settings.leftHanded, names: noteNames(state.shape, c), heard: heardPcs(), scale: 1.25 })
    : `<div class="diagram-hidden">Diagram hidden<br><span>press Enter to show</span></div>`;
  const count = shapesFor(c).length;
  const toggle = $('positions-toggle');
  toggle.hidden = !showShape || count < 2;
  toggle.textContent = settings.showPositions ? 'Hide other ways to play it' : `Other ways to play it (${count - 1})`;
  renderPositions(c);
  $('drill-tab').hidden = !settings.showTab;
  if (settings.showTab) renderTab($('drill-tab'), state.shape, c);
  renderBoard();
}

const positionName = s => (s.maxFret <= 4 ? 'Open position' : `Fret ${s.minFret}`);

// Other places on the neck to play the current chord. Any of them counts when you play it; the one
// you click becomes the shape shown for this chord from now on.
function renderPositions(c) {
  const box = $('positions');
  const list = shapesFor(c);
  box.hidden = !settings.showPositions || !settings.showDiagram || list.length < 2;
  if (box.hidden) return;
  box.innerHTML = '';
  box.append(el('p', 'note positions-note', 'Any of these counts — the app listens for the notes, not where you play them. ' +
    'Click one to make it the shape shown for ' + c.symbol + '.'));
  list.forEach((shape, i) => {
    const current = shape === state.shape;
    const card = el('button', 'compare-card' + (current ? ' current' : ''));
    card.title = current ? 'Shown above' : 'Show this shape for ' + c.symbol;
    card.innerHTML = Diagram.chordBox(shape, tuning().strings, { leftHanded: settings.leftHanded, names: noteNames(shape, c), scale: 0.72 });
    card.append(el('span', 'compare-name', positionName(shape) + (i === 0 ? ' (easiest)' : '')));
    card.addEventListener('click', () => {
      const map = settings.shapes[tuningKey()] ??= {};
      if (i === 0) delete map[c.key]; else map[c.key] = shape.frets.join();
      saveSettings();
      renderDrill();
    });
    box.append(card);
  });
}

// The current chord's shape in every tuning for this instrument, side by side. Click one to switch.
function renderCompare() {
  const box = $('compare');
  const c = state.chord;
  box.hidden = !settings.compareTunings || !c;
  if (box.hidden) return;
  box.innerHTML = '';
  if (!settings.showDiagram) {
    box.append(el('p', 'note', 'Turn the diagram on to compare shapes across tunings.'));
    return;
  }
  for (const t of allTunings()) {
    const list = shapesForTuning(c, t);
    const chosen = chosenFrets(c, `${settings.instrument}:${t.strings.join('-')}`);
    const shape = list.find(x => x.frets.join() === chosen) ?? list[0];
    const card = el('button', 'compare-card' + (t.id === tuning().id ? ' current' : ''));
    card.title = t.id === tuning().id ? 'Current tuning' : `Switch to ${t.name}`;
    card.innerHTML = shape
      ? Diagram.chordBox(shape, t.strings, { leftHanded: settings.leftHanded, names: noteNames(shape, c), scale: 0.72 })
      : '<div class="compare-none">No comfortable shape</div>';
    card.append(el('span', 'compare-name', t.name));
    card.addEventListener('click', () => {
      if (t.id === tuning().id) return;
      settings.tunings[settings.instrument] = t.id;
      saveSettings();
      tuningChanged();
    });
    box.append(card);
  }
}

function toggleDiagram() {
  settings.showDiagram = !settings.showDiagram;
  if (settings.showDiagram) state.hintShown = true;
  saveSettings();
  renderDrill();
}

// Standard notation (written an octave up for guitar) over tab.
function renderTab(el, shape, chord) {
  el.innerHTML = '';
  if (!window.Vex || !shape) return;
  const { Renderer, Stave, TabStave, StaveNote, TabNote, Accidental, Formatter } = Vex.Flow;
  const strings = tuning().strings;
  const inst = instrument();
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(200, 120 + strings.length * 13 + 30);
  const ctx = renderer.getContext();
  const stave = new Stave(6, 0, 186).addClef('treble', 'default', inst.staffTranspose ? '8vb' : undefined);
  stave.setContext(ctx).draw();
  const tab = new TabStave(6, 100, 186, { num_lines: strings.length }).addClef('tab');
  tab.setContext(ctx).draw();

  const sounding = [...new Set(shape.notes.filter(n => n !== null))].sort((a, b) => a - b);
  const VF_ACC = { '-2': 'bb', '-1': 'b', '1': '#', '2': '##' };
  const spelled = sounding.map(n => {
    const tone = chord.tones.find(t => t.pc === n % 12) ?? Theory.spell(Theory.rootByPc(n % 12), [0, 0]);
    const written = n + inst.staffTranspose;
    return { key: `${Theory.LETTERS[tone.letter].toLowerCase()}/${Math.floor((written - tone.acc) / 12) - 1}`, acc: tone.acc };
  });
  const note = new StaveNote({ keys: spelled.map(s => s.key), duration: 'w', align_center: true });
  spelled.forEach((s, i) => { if (s.acc) note.addModifier(new Accidental(VF_ACC[s.acc]), i); });
  Formatter.FormatAndDraw(ctx, stave, [note]);
  const positions = shape.frets.map((f, i) => (f >= 0 ? { str: strings.length - i, fret: f } : null)).filter(Boolean);
  Formatter.FormatAndDraw(ctx, tab, [new TabNote({ positions, duration: 'w' })]);
}

// ---------- Chord grid (choose chords + progress) ----------

const LEVEL_TEXT = Progress.LEVELS;
const fmtTime = t => (t === null ? '' : t.toFixed(1) + 's');

function renderGrid() {
  const grid = $('chord-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `minmax(118px, auto) repeat(${ROOTS.length}, minmax(40px, 1fr))`;
  grid.append(document.createElement('div'));
  for (const r of ROOTS) grid.append(el('div', 'col-head', r.name));
  const selected = new Set(selectedKeys());
  const usedTypes = new Set([...selected].map(k => Theory.chordFromKey(k).type.id));
  for (const type of CHORD_TYPES) {
    if (!settings.gridAll && !commonTypes().includes(type.id) && !usedTypes.has(type.id)) continue;
    grid.append(el('div', 'row-head', type.name));
    for (const root of ROOTS) {
      const chord = Theory.buildChord(root, type);
      const playable = shapesFor(chord).length > 0;
      const s = state.progress.statsFor(chord.key, settings.goal);
      const cell = el('button', `cell lvl-${s.level}` + (selected.has(chord.key) ? ' selected' : '') + (playable ? '' : ' unplayable'));
      cell.append(el('span', 'cell-name', chord.symbol), el('span', 'cell-time', s.tries ? fmtTime(s.time) : ''));
      cell.disabled = !playable;
      cell.dataset.key = chord.key;
      cell.dataset.tip = gridTip(chord, s, playable, selected.has(chord.key));
      grid.append(cell);
    }
  }
}

function gridTip(chord, s, playable, selected) {
  if (!playable) return `${chord.symbol}\nNo comfortable shape in this tuning`;
  const lines = [`${chord.symbol} (${chord.longName}) — ${LEVEL_TEXT[s.level]}`];
  if (s.tries) {
    lines.push(`Last ${s.tries} tries: ${s.correct} correct`);
    if (s.time !== null) lines.push(`Median time: ${fmtTime(s.time)} (goal ${settings.goal}s)`);
    lines.push(`${s.clean} played without the diagram`);
  }
  lines.push(selected ? 'In your practice set — click to remove' : 'Click to add to your practice set');
  return lines.join('\n');
}

function initGrid() {
  const grid = $('chord-grid');
  const tip = $('grid-tip');
  grid.addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (!cell || cell.disabled) return;
    const list = selectedKeys();
    const i = list.indexOf(cell.dataset.key);
    if (i >= 0) list.splice(i, 1); else list.push(cell.dataset.key);
    cell.blur();
    selectionChanged();
  });
  grid.addEventListener('mousemove', e => {
    const cell = e.target.closest('.cell');
    if (!cell) { tip.hidden = true; return; }
    tip.textContent = cell.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + h + 20 > window.innerHeight ? e.clientY - h - 10 : e.clientY + 16) + 'px';
  });
  grid.addEventListener('mouseleave', () => { tip.hidden = true; });
}

// ---------- Your chords: sets you can combine ----------

// The common chord types shown in the grid unless "Show all chord types" is on (or one is selected).
// Power chords are a guitar technique; ukulele players rarely use them.
const commonTypes = () => ['maj', 'min', 'dom7', 'maj7', 'min7', 'sus2', 'sus4', ...(settings.instrument === 'guitar' ? ['pow'] : [])];

const selectedKeys = () => settings.selection[settings.instrument] ??= defaultSelection();

const playableKeys = symbols => symbols.map(Theory.parseChord).filter(c => c && shapesFor(c).length).map(c => c.key);

// The main chords of a key plus its V7: in G, G Am Bm C D Em D7; in A minor, Am C Dm Em F G E7.
function keyChordSymbols(keyName) {
  const key = Progressions.parseKey(keyName);
  const numerals = key.minor ? ['i', 'bIII', 'iv', 'v', 'bVI', 'bVII', 'V7'] : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'V7'];
  return numerals.map(n => Theory.parseRoman(n, key).symbol);
}

function chordSets() {
  const path = CHORD_SETS[settings.instrument].map(s => ({ name: s.name, keys: playableKeys(s.chords) }));
  const keys = PRACTICE_KEYS[settings.instrument].map(k => ({
    name: k.endsWith('m') ? `${k.slice(0, -1)} minor` : `${k} major`,
    keys: playableKeys(keyChordSymbols(k)),
  }));
  return { path, keys };
}

function setState(set, selected) {
  const n = set.keys.filter(k => selected.has(k)).length;
  return n === 0 ? 'off' : n === set.keys.length ? 'on' : 'partial';
}

// Clicking a set adds all its chords, or, if they're all in already, takes them out again
// (keeping any that also belong to another set that's fully on).
function toggleSet(set) {
  const list = selectedKeys();
  const selected = new Set(list);
  if (setState(set, selected) === 'on') {
    const { path, keys } = chordSets();
    const keep = new Set([...path, ...keys].filter(o => o !== set && o.name !== set.name && setState(o, selected) === 'on').flatMap(o => o.keys));
    settings.selection[settings.instrument] = list.filter(k => !set.keys.includes(k) || keep.has(k));
  } else {
    for (const k of set.keys) if (!selected.has(k)) list.push(k);
  }
  selectionChanged();
}

function selectionChanged() {
  saveSettings();
  renderChordSets();
  renderGrid();
  const list = selectedKeys();
  if (!state.chord || !list.includes(state.chord.key)) nextChord();
}

function renderChordSets() {
  const selected = new Set(selectedKeys());
  const { path, keys } = chordSets();
  for (const [boxId, sets] of [['sets-path', path], ['sets-keys', keys]]) {
    const box = $(boxId);
    box.innerHTML = '';
    for (const set of sets) {
      const st = setState(set, selected);
      const chip = el('button', `chip ${st}`);
      chip.setAttribute('aria-pressed', st === 'on');
      chip.title = (st === 'on' ? 'Click to remove: ' : 'Click to add: ') + set.keys.map(k => Theory.chordFromKey(k).symbol).join(' ');
      chip.append(el('span', 'chip-mark', st === 'on' ? '✓' : st === 'partial' ? '◐' : '+'), el('span', '', set.name),
        el('span', 'chip-count', String(set.keys.length)));
      chip.addEventListener('click', () => { toggleSet(set); chip.blur(); });
      box.append(chip);
    }
  }

  // Summary of what's being practised, grouped the way the grid is ordered.
  const chords = [...selected].map(Theory.chordFromKey)
    .sort((a, b) => CHORD_TYPES.indexOf(a.type) - CHORD_TYPES.indexOf(b.type) || a.root.pc - b.root.pc);
  $('sel-summary').textContent = chords.length
    ? `Practising ${chords.length} chord${chords.length === 1 ? '' : 's'}: ${chords.map(c => c.symbol).join(', ')}`
    : 'No chords selected yet — add a set below or click chords in the grid.';
  $('sel-clear').disabled = !chords.length;

  // Progression picker (same list as Play along).
  const sel = $('sel-prog');
  const prev = sel.value;
  fillProgressionMenu(sel, progressionList());
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// The chords of a progression, in the key (and transposition) last used for it in Play along.
function progressionChords(id) {
  const p = progressionList().find(x => x.id === id);
  if (!p) return [];
  const text = settings.progText?.[p.id] ?? p.text;
  const key = Progressions.parseKey(settings.progKeys[p.id] ?? p.key);
  const parsed = Progressions.parse(text, key, settings.progTranspose[p.id] ?? 0);
  return [...new Map(parsed.bars.flat().map(c => [c.key, c])).values()];
}

function addProgressionChords() {
  const chords = progressionChords($('sel-prog').value);
  const playable = chords.filter(c => shapesFor(c).length);
  const list = selectedKeys();
  const added = playable.filter(c => !list.includes(c.key));
  for (const c of added) list.push(c.key);
  const skipped = chords.length - playable.length;
  $('sel-prog-note').textContent = (added.length
    ? `Added ${added.map(c => c.symbol).join(', ')}.`
    : `Already practising all of its chords (${playable.map(c => c.symbol).join(', ')}).`) +
    (skipped ? ` ${skipped} chord${skipped === 1 ? ' has' : 's have'} no comfortable shape in this tuning.` : '');
  selectionChanged();
}

// ---------- Play along ----------

function progressionList() {
  return [
    ...Progressions.PRESETS.map(p => ({ id: 'preset:' + p.id, group: p.group, name: p.name, text: p.text, about: p.about, level: p.level, song: p.song, key: p.keys[settings.instrument] })),
    ...settings.customProgs.map(p => ({ id: 'custom:' + p.id, name: p.name, text: p.text, about: 'Your progression.', key: 'C', custom: true })),
  ];
}

const currentProg = () => progressionList().find(p => p.id === settings.prog) ?? progressionList()[0];

// The line under the progression menu: difficulty, description, and a link to hear a famous song
// that uses it (a YouTube search, so the link can't go stale).
const LEVEL_NAMES = ['Beginner', 'Intermediate', 'Advanced'];
function describeProgression(p, aboutEl, linkEl) {
  aboutEl.textContent = (p.level !== undefined ? LEVEL_NAMES[p.level] + ' · ' : '') + p.about;
  linkEl.hidden = !p.song;
  if (!p.song) return;
  const query = p.song.search ?? `${p.song.title} ${p.song.artist}`;
  linkEl.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
  linkEl.textContent = p.song.search ? `▶ Find songs that use it on YouTube` : `▶ Hear it: "${p.song.title}" — ${p.song.artist}`;
  if (p.id === 'preset:cadence') linkEl.textContent = '▶ Watch a lesson on YouTube';
}

// The progression menu, with presets under their style headings and saved ones last.
function fillProgressionMenu(sel, items) {
  sel.innerHTML = '';
  for (const group of [...Progressions.GROUPS, 'Your progressions']) {
    const inGroup = items.filter(p => (p.custom ? 'Your progressions' : p.group) === group);
    if (!inGroup.length) continue;
    const og = document.createElement('optgroup');
    og.label = group;
    for (const p of inGroup) og.append(new Option(p.name, p.id));
    sel.append(og);
  }
}

function renderProgSelect() {
  const sel = $('prog-select');
  fillProgressionMenu(sel, progressionList());
  sel.value = currentProg().id;
  const keySel = $('prog-key');
  keySel.innerHTML = '';
  for (const r of ROOTS) {
    keySel.append(new Option(r.name + ' major', r.name));
    keySel.append(new Option(r.name + ' minor', r.name + 'm'));
  }
  loadProgIntoEditor();
}

function loadProgIntoEditor() {
  const p = currentProg();
  $('prog-text').value = settings.progText?.[p.id] ?? p.text;
  describeProgression(p, $('prog-about'), $('prog-song'));
  $('prog-key').value = settings.progKeys[p.id] ?? p.key;
  $('prog-delete').hidden = !p.custom;
  parseEditor();
}

function parseEditor() {
  const p = currentProg();
  const key = Progressions.parseKey($('prog-key').value);
  const transpose = settings.progTranspose[p.id] ?? 0;
  const result = Progressions.parse($('prog-text').value, key, transpose);
  $('key-wrap').hidden = !result.usesNumerals;
  $('transpose-wrap').hidden = !result.usesNames;
  $('tr-val').textContent = transpose > 0 ? '+' + transpose : transpose;
  const unplayable = [...new Set(result.bars.flat().filter(c => !shapesFor(c).length).map(c => c.symbol))];
  const msgs = [];
  if (result.errors.length) msgs.push(`Didn't understand: ${result.errors.join(', ')}`);
  if (unplayable.length) msgs.push(`No comfortable shape for: ${unplayable.join(', ')}`);
  $('prog-errors').textContent = msgs.join(' · ');
  state.parsed = result;
  if (!state.play) renderBars();
  return result;
}

function renderBars(results = []) {
  const box = $('bars');
  box.innerHTML = '';
  const bars = state.parsed?.bars ?? [];
  let ei = 0;
  bars.forEach((bar, b) => {
    const cell = el('div', 'bar');
    cell.dataset.bar = b;
    for (const chord of bar) {
      const span = el('span', 'bar-chord', chord.symbol);
      span.dataset.event = ei;
      if (results[ei]) span.classList.add(results[ei]);
      cell.append(span);
      ei++;
    }
    box.append(cell);
  });
}

function startPlay(oneMinute = null) {
  stopPlay(false);
  const parsed = oneMinute ? null : parseEditor();
  let events;
  if (oneMinute) {
    events = [oneMinute.a, oneMinute.b].map((chord, i) => ({ chord, bar: i, beat: i, beats: 1, change: true }));
    state.parsed = { bars: [[oneMinute.a], [oneMinute.b]] };
  } else {
    if (!parsed.bars.length) { setFeedback('Enter some chords first', 'bad'); return; }
    events = Progressions.events(parsed.bars, settings.beats);
  }
  const mode = oneMinute ? 'wait' : settings.playMode;
  state.play = {
    mode, events, oneMinute,
    index: 0,            // wait mode: current step; beat mode: current event
    results: [],         // per event: 'hit', 'late', 'missed'
    changeTimes: [],     // { from, to, time } this run
    prev: null,          // last chord played correctly
    lastAt: performance.now(),
    loops: 0,
    count: 0,            // one-minute changes
    endsAt: oneMinute ? performance.now() + 60000 : null,
  };
  if (mode === 'wait') {
    // Steps skip repeated bars of the same chord; you just keep playing it.
    state.play.steps = events.filter(e => e.change);
    if (settings.loop && state.play.steps.length > 1 && state.play.steps[0].chord.key === state.play.steps.at(-1).chord.key) state.play.steps.pop();
  } else {
    state.play.beatMs = 60000 / settings.tempo;
    state.play.totalBeats = events.at(-1).beat + events.at(-1).beats;
    state.play.t0 = performance.now() + settings.beats * state.play.beatMs; // one bar count-in
    state.play.lastBeat = -Infinity;
    state.play.target = -1;
  }
  $('play-start').textContent = 'Stop';
  $('play-summary').hidden = true;
  setFeedback('');
  renderBars();
  renderPlay();
  if (mode === 'beat' || oneMinute) state.play.raf = requestAnimationFrame(playTick);
  evaluatePlay();
}

function stopPlay(showSummary = true) {
  const p = state.play;
  if (!p) return;
  cancelAnimationFrame(p.raf);
  state.play = null;
  $('play-start').textContent = 'Start';
  if (p.oneMinute) finishOneMinute(p);
  else if (showSummary) renderSummary(p);
  renderPlay();
  renderChanges();
}

// The chord being asked for right now.
function playTarget() {
  const p = state.play;
  if (!p) return null;
  if (p.mode === 'wait') return p.steps[p.index].chord;
  return p.target >= 0 ? p.events[p.target].chord : null;
}

function nextPlayChord() {
  const p = state.play;
  if (!p) return null;
  if (p.mode === 'wait') {
    const i = p.index + 1;
    if (i < p.steps.length) return p.steps[i].chord;
    return settings.loop || p.oneMinute ? p.steps[0].chord : null;
  }
  for (let i = Math.max(0, p.target) + 1; i < p.events.length; i++) {
    if (p.events[i].chord.key !== playTarget()?.key) return p.events[i].chord;
  }
  return settings.loop ? p.events[0].chord : null;
}

function evaluatePlay() {
  const p = state.play;
  if (!p) return;
  const chord = playTarget();
  if (!chord) return;
  const notes = heldNotes();
  const key = notes.join(',');
  if (key !== state.judgedKey) state.judgedKey = null;
  if (!notes.length) { cancelNotQuite(); fadeFeedback(); return; }

  if (matches(chord, notes)) {
    cancelNotQuite();
    if (p.mode === 'wait') return waitStepDone();
    return beatHit();
  }
  if (stillRinging(notes, p.prev)) { cancelNotQuite(); return; }
  if (new Set(notes.map(n => n % 12)).size >= chord.required.length) notQuite(key, wrongMessage(chord, notes));
  else { cancelNotQuite(); fadeFeedback(); }
}

function waitStepDone() {
  const p = state.play;
  const now = performance.now();
  const step = p.steps[p.index];
  if (p.prev && p.prev.key !== step.chord.key) {
    const time = (now - p.lastAt) / 1000;
    state.progress.recordChange(p.prev, step.chord, { ok: true, time });
    p.changeTimes.push({ from: p.prev, to: step.chord, time });
    if (p.oneMinute) p.count++;
  }
  p.results[p.events.indexOf(step)] = 'hit';
  p.prev = step.chord;
  p.lastAt = now;
  state.clicked.clear();
  if (!p.oneMinute) setFeedback('');
  p.index++;
  if (p.index >= p.steps.length) {
    if (settings.loop || p.oneMinute) { p.index = 0; p.loops++; p.results = []; }
    else { stopPlay(); return; }
  }
  renderBars(p.results);
  renderPlay();
}

function beatHit() {
  const p = state.play;
  const ev = p.events[p.target];
  if (p.results[p.target]) return; // already judged
  const now = performance.now();
  const late = (now - (p.t0 + ev.beat * p.beatMs)) / p.beatMs; // in beats; negative = early
  p.results[p.target] = late <= 1 ? 'hit' : 'late';
  const from = p.prev;
  if (from && from.key !== ev.chord.key) {
    const time = Math.max(0, late * p.beatMs / 1000);
    state.progress.recordChange(from, ev.chord, { ok: true, time });
    p.changeTimes.push({ from, to: ev.chord, time, late });
  }
  p.prev = ev.chord;
  state.clicked.clear();
  renderBars(p.results);
  renderPlay();
}

function playTick() {
  const p = state.play;
  if (!p) return;
  const now = performance.now();

  if (p.oneMinute) {
    const left = Math.max(0, Math.ceil((p.endsAt - now) / 1000));
    $('play-feedback').textContent = `${p.count} change${p.count === 1 ? '' : 's'} · ${left}s left`;
    $('play-feedback').className = 'feedback big';
    if (now >= p.endsAt) { stopPlay(); return; }
    p.raf = requestAnimationFrame(playTick);
    return;
  }

  let beat = (now - p.t0) / p.beatMs;
  if (beat >= p.totalBeats) {
    // Judge anything left, then loop or finish.
    markMissed(p.events.length);
    if (!settings.loop) { stopPlay(); return; }
    p.t0 += p.totalBeats * p.beatMs;
    p.loops++;
    p.results = [];
    p.lastBeat -= p.totalBeats;
    beat -= p.totalBeats;
  }

  // Metronome and beat display.
  const whole = Math.floor(beat);
  if (whole !== p.lastBeat) {
    p.lastBeat = whole;
    if (settings.click) click(((whole % settings.beats) + settings.beats) % settings.beats === 0);
    renderBeatDots(whole);
  }

  // The target is the event playing now, or the next change once it's half a beat away.
  let target = -1;
  for (let i = 0; i < p.events.length; i++) if (p.events[i].beat <= beat + 0.5) target = i;
  if (target !== p.target) {
    markMissed(target);
    p.target = target;
    // Continuing the same chord into the next bar needs no new strum.
    const ev = p.events[target];
    if (ev && !ev.change && p.results[target - 1] && p.results[target - 1] !== 'missed') p.results[target] = p.results[target - 1];
    renderBars(p.results);
    renderPlay();
    evaluatePlay();
  }
  p.raf = requestAnimationFrame(playTick);
}

// Events before `upTo` that were never played count as missed.
function markMissed(upTo) {
  const p = state.play;
  for (let i = 0; i < upTo; i++) {
    if (p.results[i]) continue;
    p.results[i] = 'missed';
    const ev = p.events[i];
    if (ev.change && p.prev && p.prev.key !== ev.chord.key) state.progress.recordChange(p.prev, ev.chord, { ok: false });
  }
}

let clickCtx = null;
function click(accent) {
  try {
    clickCtx ??= new AudioContext();
    const t = clickCtx.currentTime;
    const osc = clickCtx.createOscillator(), gain = clickCtx.createGain();
    osc.frequency.value = accent ? 1600 : 1100;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(clickCtx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch { /* no audio output */ }
}

function renderBeatDots(beat) {
  const box = $('beat-dots');
  const p = state.play;
  box.innerHTML = '';
  if (!p || p.mode !== 'beat') return;
  const inBar = ((beat % settings.beats) + settings.beats) % settings.beats;
  for (let i = 0; i < settings.beats; i++) box.append(el('span', 'beat-dot' + (i === inBar ? ' on' : '') + (i === 0 ? ' one' : '')));
  if (beat < 0) box.append(el('span', 'count-in', `Count-in: ${settings.beats + beat + 1}`));
}

function renderPlay() {
  const p = state.play;
  const plan = currentPlan();
  const strings = tuning().strings;
  let nowChoice = null, nextChoice = null;
  if (plan) {
    const s = currentStep(plan);
    nowChoice = plan.choices[s];
    nextChoice = plan.choices[s + 1] ?? (plan.loop && plan.choices.length > 1 ? plan.choices[0] : null);
    if (p && !p.oneMinute && !settings.loop && s === plan.choices.length - 1) nextChoice = null;
  }
  const now = nowChoice?.chord ?? null, next = nextChoice?.chord ?? null;
  const box = (choice, scale, heard) => {
    const shape = choiceShape(choice);
    return shape ? Diagram.chordBox(shape, strings, { leftHanded: settings.leftHanded, names: noteNames(shape, choice.chord), heard, scale }) : '';
  };
  $('now-name').textContent = now ? now.symbol : '—';
  $('now-diagram').innerHTML = box(nowChoice, 1.15, heardPcs());
  $('next-name').textContent = next ? next.symbol : '—';
  $('next-diagram').innerHTML = box(nextChoice, 0.8, null);
  $('change-tip').textContent = changeTip(nowChoice, nextChoice);
  document.querySelectorAll('.bar').forEach(b => b.classList.remove('current'));
  if (p) {
    const ev = p.mode === 'wait' ? p.steps[p.index] : p.events[p.target];
    if (ev) document.querySelector(`.bar[data-bar="${ev.bar}"]`)?.classList.add('current');
  }
  if (!p) renderBeatDots(0);
  renderBoard();
}

// ---------- Shapes chosen for the whole progression ----------
//
// In play-along each chord's shape and fingering is chosen with its neighbours in mind (see
// Voicings.plan): fingers that can stay down between chords do. A shape the player picked under
// "Other ways to play it" is always kept.

let planCache = { key: null };

function currentPlan() {
  const p = state.play;
  const events = p ? p.events : (state.parsed?.bars.length ? Progressions.events(state.parsed.bars, settings.beats) : []);
  if (!events.length) return null;
  const loop = settings.loop || !!p?.oneMinute;
  const steps = [];
  let stepOf = events.map(e => { if (e.change) steps.push(e.chord); return steps.length - 1; });
  if (loop && steps.length > 1 && steps[0].key === steps.at(-1).key) {
    const last = steps.length - 1;
    steps.pop();
    stepOf = stepOf.map(s => (s === last ? 0 : s));
  }
  const fixed = {};
  for (const [key, frets] of Object.entries(settings.shapes[tuningKey()] ?? {})) fixed[key] = frets;
  const cacheKey = [tuningKey(), steps.map(c => c.key).join(','), loop, JSON.stringify(fixed)].join('|');
  if (planCache.key !== cacheKey) planCache = { key: cacheKey, choices: Voicings.plan(steps, tuning().strings, instrument(), loop, fixed, tuning().standard ?? {}) };
  return { steps, stepOf, loop, choices: planCache.choices };
}

function currentStep(plan) {
  const p = state.play;
  if (!p) return 0;
  if (p.mode === 'wait') return plan.stepOf[p.events.indexOf(p.steps[p.index])] ?? 0;
  return p.target >= 0 ? plan.stepOf[p.target] : 0;
}

const choiceShape = c => c && { ...c.shape, fingers: c.fingers };

function stringName(i) {
  const strings = tuning().strings;
  const pc = strings[i] % 12;
  const same = strings.filter(s => s % 12 === pc);
  const prefix = same.length > 1 ? (strings[i] === Math.max(...same) ? 'high ' : 'low ') : '';
  return `${prefix}${Theory.PC_NAMES[pc]} string`;
}

// "Keep finger 3 on the B string" — the fingers that don't need to move for the next chord.
function changeTip(a, b) {
  if (!a || !b) return '';
  const t = Voicings.transition(a, b);
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10]);
  const parts = [
    ...t.anchors.map(x => `keep finger ${x.finger} on the ${stringName(x.string)} (${ordinal(x.fret)} fret)`),
    ...t.slides.map(x => `slide finger ${x.finger} along the ${stringName(x.string)} from the ${ordinal(x.from)} to the ${ordinal(x.to)} fret`),
  ];
  if (!parts.length) return '';
  const text = parts.join(', and ');
  return `To change to ${b.chord.symbol}: ${text[0].toLowerCase()}${text.slice(1)}.`;
}

function renderSummary(p) {
  const box = $('play-summary');
  box.innerHTML = '';
  box.append(el('h3', '', 'How it went'));
  if (p.mode === 'beat') {
    const judged = p.results.filter(Boolean);
    const hits = judged.filter(r => r === 'hit').length, late = judged.filter(r => r === 'late').length;
    box.append(el('p', '', `${hits} on time, ${late} late, ${judged.length - hits - late} missed (this pass).`));
  }
  const byChange = new Map();
  for (const c of p.changeTimes) {
    const k = `${c.from.symbol} → ${c.to.symbol}`;
    byChange.set(k, [...(byChange.get(k) ?? []), c.time]);
  }
  if (byChange.size) {
    const rows = [...byChange].map(([k, ts]) => [k, ts.reduce((a, b) => a + b, 0) / ts.length, ts.length]).sort((a, b) => b[1] - a[1]);
    const ul = el('ul', 'summary-list');
    for (const [k, avg, n] of rows) ul.append(el('li', '', `${k}: ${avg.toFixed(1)}s${n > 1 ? ` average over ${n}` : ''}`));
    box.append(el('p', 'note', p.mode === 'wait' ? 'Time to change to each chord, slowest first:' : 'How long after the beat each change landed, slowest first:'), ul);
  } else {
    box.append(el('p', 'note', 'No chord changes were played.'));
  }
  box.hidden = false;
}

function renderChanges() {
  const list = $('changes-list');
  list.innerHTML = '';
  const changes = state.progress.changes().filter(c => c.time !== null).slice(0, 6);
  if (!changes.length) return;
  list.append(el('p', 'note', 'Your slowest changes so far:'));
  for (const c of changes) {
    const a = Theory.chordFromKey(c.from), b = Theory.chordFromKey(c.to);
    const row = el('div', 'change-row');
    row.append(el('span', 'change-name', `${a.symbol} → ${b.symbol}`), el('span', 'change-time', `${c.time.toFixed(1)}s`));
    const best = settings.oneMinuteBest[`${a.key}>${b.key}`] ?? settings.oneMinuteBest[`${b.key}>${a.key}`];
    if (best) row.append(el('span', 'note', `best: ${best} in a minute`));
    const btn = el('button', 'mini', 'Practise for 1 minute');
    btn.addEventListener('click', () => startOneMinute(a, b));
    row.append(btn);
    list.append(row);
  }
}

function startOneMinute(a, b) {
  if (!shapesFor(a).length || !shapesFor(b).length) { setFeedback('No comfortable shape for one of those chords', 'bad'); return; }
  $('omc-a').value = a.symbol;
  $('omc-b').value = b.symbol;
  startPlay({ a, b });
}

function finishOneMinute(p) {
  const key = `${p.oneMinute.a.key}>${p.oneMinute.b.key}`;
  const best = settings.oneMinuteBest[key] ?? 0;
  if (p.count > best) settings.oneMinuteBest[key] = p.count;
  saveSettings();
  const box = $('play-summary');
  box.innerHTML = '';
  box.append(el('h3', '', `${p.oneMinute.a.symbol} ↔ ${p.oneMinute.b.symbol}: ${p.count} changes in a minute`));
  box.append(el('p', '', p.count > best ? (best ? `New best! (was ${best})` : 'Your first score — try to beat it next time.') : `Your best is ${best}.`));
  box.hidden = false;
  setFeedback('');
  loadProgIntoEditor();
}

// ---------- Tuner ----------

const tuner = { history: [], frame: 0, pinned: null };

function renderTunerStrings() {
  const box = $('tuner-strings');
  box.innerHTML = '';
  const auto = el('button', 'mini' + (tuner.pinned === null ? ' active' : ''), 'Auto');
  auto.addEventListener('click', () => { tuner.pinned = null; renderTunerStrings(); });
  box.append(auto);
  tuning().strings.forEach((n, i) => {
    const b = el('button', 'mini string-btn' + (tuner.pinned === i ? ' active' : ''), Theory.midiName(n));
    b.dataset.string = i;
    b.addEventListener('click', () => { tuner.pinned = i; renderTunerStrings(); });
    box.append(b);
  });
}

// Phone and laptop mics barely pick up a low string's fundamental, so the pitch detector sometimes
// locks onto an overtone an octave (or a twelfth) up: the A string reads as A3. If half or a third
// of the reading is much closer to a string in this tuning (or the pinned string), use that.
function fixOctave(hz) {
  const strings = tuner.pinned === null ? tuning().strings : [tuning().strings[tuner.pinned]];
  const distance = d => {
    const midi = 69 + 12 * Math.log2(hz / d / 440);
    return Math.min(...strings.map(s => Math.abs(midi - s))) + (d - 1) * 0.3; // prefer the reading as-is
  };
  return hz / [1, 2, 3].reduce((best, d) => (distance(d) < distance(best) ? d : best));
}

function tunerFrame(frame) {
  if (++tuner.frame % 2) return; // about 12 readings a second is plenty
  const raw = MicInput.pitch(frame.timeData, frame.sampleRate);
  let f = raw && fixOctave(raw);
  // As a low string fades, its fundamental can drop out and the reading jumps up an octave. If
  // this reading is the octave of what was heard a moment ago, it's the same string.
  const now = performance.now();
  if (f && tuner.recent && now - tuner.recent.at < 1500 && Math.abs(1200 * Math.log2(f / 2 / tuner.recent.hz)) < 50) f /= 2;
  if (f) tuner.recent = { hz: f, at: now };
  if (!f) {
    tuner.history = [];
    $('tuner-needle').classList.add('idle');
    return;
  }
  tuner.history = [...tuner.history, f].slice(-5);
  const hz = [...tuner.history].sort((a, b) => a - b)[tuner.history.length >> 1];
  const strings = tuning().strings;
  const midi = 69 + 12 * Math.log2(hz / 440);
  let i = tuner.pinned;
  if (i === null) {
    i = 0;
    strings.forEach((n, k) => { if (Math.abs(n - midi) < Math.abs(strings[i] - midi)) i = k; });
  }
  const target = strings[i];
  const cents = (midi - target) * 100;
  const far = Math.abs(cents) > 300;  // nowhere near a string: show the nearest note instead
  const shownCents = far ? (midi - Math.round(midi)) * 100 : cents;
  $('tuner-string').textContent = far ? 'Not near a string in this tuning' : `String ${strings.length - i}: ${Theory.midiName(target)}`;
  $('tuner-note').textContent = Theory.midiName(Math.round(midi));
  const clamped = Math.max(-50, Math.min(50, shownCents));
  const needle = $('tuner-needle');
  needle.classList.remove('idle');
  needle.style.left = `${50 + clamped}%`;
  const inTune = Math.abs(shownCents) < 5;
  needle.classList.toggle('in-tune', inTune);
  $('tuner-note').classList.toggle('in-tune', inTune && !far);
  $('tuner-cents').textContent = inTune ? 'In tune' : `${shownCents > 0 ? '+' : ''}${shownCents.toFixed(0)} cents — ${shownCents < 0 ? 'flat: tighten' : 'sharp: loosen'}`;
  document.querySelectorAll('.string-btn').forEach(b => b.classList.toggle('near', Number(b.dataset.string) === i && !far));
}

// ---------- Fretboard & heard notes ----------

const heardPcs = () => new Set(heldNotes().map(n => n % 12));

function renderHeard() {
  const notes = heldNotes();
  const chord = settings.mode === 'play' ? playTarget() : state.chord;
  $('heard').textContent = 'Heard: ' + (notes.length ? notes.map(n => Theory.pcName(n % 12, chord) + (Math.floor(n / 12) - 1)).join('  ') : '—');
}

function renderBoard() {
  const show = settings.mode !== 'tuner';
  $('fretboard').hidden = !show;
  $('heard').hidden = !show;
  if (!show) return;
  let shape = settings.showDiagram ? state.shape : null;
  if (settings.mode === 'play') {
    const plan = currentPlan();
    shape = plan ? choiceShape(plan.choices[currentStep(plan)]) : null;
  }
  $('fretboard').innerHTML = Diagram.fretboard(tuning().strings, {
    frets: instrument().frets,
    shape,
    heard: heardPcs(),
    leftHanded: settings.leftHanded,
    clicked: [...state.clicked].map(([string, fret]) => ({ string, fret })),
  });
}

function initFretboardClicks() {
  $('fretboard').addEventListener('mousedown', e => {
    const hit = e.target.closest('.hit');
    if (!hit) return;
    e.preventDefault();
    const s = Number(hit.dataset.string), f = Number(hit.dataset.fret);
    if (state.clicked.get(s) === f) state.clicked.delete(s);
    else state.clicked.set(s, f);
    inputChanged();
  });
}

// ---------- Modes, instrument, tuning ----------

function setMode(mode) {
  if (state.play && mode !== 'play') stopPlay(false);
  settings.mode = mode;
  saveSettings();
  for (const m of ['drill', 'play', 'tuner']) $('mode-' + m).hidden = m !== mode;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === mode));
  $('drill-settings').hidden = mode !== 'drill';
  document.querySelector('.options').hidden = mode === 'tuner';
  cancelNotQuite();
  state.judgedKey = null;
  if (mode === 'drill') renderDrill();
  if (mode === 'play') { renderPlay(); renderChanges(); }
  if (mode === 'tuner') renderTunerStrings();
  renderHeard();
  renderBoard();
}

function renderInstrumentControls() {
  const inst = $('instrument');
  inst.innerHTML = '';
  for (const i of INSTRUMENTS) inst.append(new Option(i.name, i.id));
  inst.value = settings.instrument;
  const tun = $('tuning');
  tun.innerHTML = '';
  for (const t of allTunings()) tun.append(new Option(t.name, t.id));
  tun.append(new Option('Custom tuning…', '__custom'));
  tun.value = tuning().id;
}

function instrumentChanged() {
  state.recent = [];
  tuningChanged(false);
}

// A new tuning keeps the current chord (redrawn with this tuning's shape) when it's still
// playable; a new instrument starts a fresh chord from that instrument's practice set.
function tuningChanged(keepChord = true) {
  state.clicked.clear();
  state.prev = null;
  useProgress();
  renderInstrumentControls();
  renderChordSets();
  renderGrid();
  renderProgSelect();
  renderTunerStrings();
  const chord = state.chord;
  if (keepChord && chord && shapesFor(chord).length && selection().some(c => c.key === chord.key)) {
    state.shownAt = performance.now(); // the shape changed, so time from now
    resetAttempt();
    renderDrill();
  } else {
    nextChord();
  }
  setMode(settings.mode);
}

function addCustomTuning() {
  const n = tuning().strings.length;
  const example = tuning().strings.map(Theory.midiName).join(' ').replace(/♯/g, '#').replace(/♭/g, 'b');
  const text = prompt(`Enter the open-string notes from the ${settings.instrument === 'guitar' ? 'lowest (thickest)' : 'top'} string, with octave numbers.\nCurrent tuning: ${example}`, example);
  if (!text) return renderInstrumentControls();
  const strings = text.trim().split(/[\s,]+/).map(Theory.parseNoteWithOctave);
  if (strings.length < 3 || strings.length > 8 || strings.some(s => s === null)) {
    alert('Please enter 3 to 8 notes like E2 A2 D3 G3 B3 E4.');
    return renderInstrumentControls();
  }
  const name = strings.map(s => Theory.PC_NAMES[s % 12]).join(' ') + ' (custom)';
  const id = 'custom-' + strings.join('-');
  const list = settings.customTunings[settings.instrument] ??= [];
  if (!list.some(t => t.id === id)) list.push({ id, name, strings });
  settings.tunings[settings.instrument] = id;
  saveSettings();
  tuningChanged();
  if (n !== strings.length) setFeedback(`Using ${strings.length} strings`, 'good');
}

// ---------- Small helpers ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- Wiring ----------

function wire() {
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('instrument').addEventListener('change', e => { settings.instrument = e.target.value; saveSettings(); instrumentChanged(); });
  $('tuning').addEventListener('change', e => {
    if (e.target.value === '__custom') return addCustomTuning();
    settings.tunings[settings.instrument] = e.target.value;
    saveSettings();
    tuningChanged();
  });
  $('input-select').addEventListener('change', () => { settings.input = inputChoice(); saveSettings(); selectInput(); });

  $('sel-clear').addEventListener('click', e => {
    settings.selection[settings.instrument] = [];
    selectionChanged();
    e.currentTarget.blur();
  });
  $('sel-prog-add').addEventListener('click', e => { addProgressionChords(); e.currentTarget.blur(); });
  $('sel-prog').addEventListener('change', () => { $('sel-prog-note').textContent = ''; });
  $('grid-all').checked = settings.gridAll;
  $('grid-all').addEventListener('change', e => { settings.gridAll = e.target.checked; saveSettings(); renderGrid(); });
  $('btn-diagram').addEventListener('click', e => { toggleDiagram(); e.currentTarget.blur(); });
  $('btn-skip').addEventListener('click', e => { skip(); e.currentTarget.blur(); });
  $('btn-tab').addEventListener('click', e => { settings.showTab = !settings.showTab; saveSettings(); renderDrill(); e.currentTarget.blur(); });
  $('btn-compare').addEventListener('click', e => { settings.compareTunings = !settings.compareTunings; saveSettings(); renderDrill(); e.currentTarget.blur(); });
  $('positions-toggle').addEventListener('click', e => { settings.showPositions = !settings.showPositions; saveSettings(); renderDrill(); e.currentTarget.blur(); });

  // Play along controls.
  $('prog-select').addEventListener('change', e => { stopPlay(false); settings.prog = e.target.value; saveSettings(); loadProgIntoEditor(); renderPlay(); });
  $('prog-key').addEventListener('change', e => { settings.progKeys[currentProg().id] = e.target.value; saveSettings(); parseEditor(); renderPlay(); });
  $('prog-text').addEventListener('input', () => {
    (settings.progText ??= {})[currentProg().id] = $('prog-text').value;
    saveSettings();
    parseEditor();
    renderPlay();
  });
  for (const [id, d] of [['tr-down', -1], ['tr-up', 1]]) {
    $(id).addEventListener('click', () => {
      const p = currentProg();
      settings.progTranspose[p.id] = Math.max(-11, Math.min(11, (settings.progTranspose[p.id] ?? 0) + d));
      saveSettings();
      parseEditor();
      renderPlay();
    });
  }
  $('prog-save').addEventListener('click', () => {
    const name = prompt('Name for this progression:', currentProg().custom ? currentProg().name : 'My progression');
    if (!name) return;
    // Save with chord names in the current key, so it plays the same wherever it's opened.
    const text = state.parsed.bars.map(b => b.map(c => c.symbol.replace(/♯/g, '#').replace(/♭/g, 'b')).join(' ')).join(' | ');
    const id = Date.now().toString(36);
    settings.customProgs.push({ id, name, text });
    settings.prog = 'custom:' + id;
    saveSettings();
    renderProgSelect();
  });
  $('prog-delete').addEventListener('click', () => {
    const p = currentProg();
    if (!p.custom || !confirm(`Delete "${p.name}"?`)) return;
    settings.customProgs = settings.customProgs.filter(c => 'custom:' + c.id !== p.id);
    settings.prog = 'preset:blues12';
    saveSettings();
    renderProgSelect();
  });

  const playMode = $('play-mode');
  const syncBeatOnly = () => document.querySelectorAll('.beat-only').forEach(n => { n.hidden = settings.playMode !== 'beat'; });
  playMode.value = settings.playMode;
  syncBeatOnly();
  playMode.addEventListener('change', () => { settings.playMode = playMode.value; saveSettings(); syncBeatOnly(); });
  const tempo = $('tempo');
  tempo.value = settings.tempo;
  $('tempo-val').textContent = settings.tempo;
  tempo.addEventListener('input', () => { settings.tempo = Number(tempo.value); $('tempo-val').textContent = tempo.value; saveSettings(); });
  $('beats').value = settings.beats;
  $('beats').addEventListener('change', e => { settings.beats = Number(e.target.value); saveSettings(); });
  for (const id of ['click', 'loop']) {
    $(id).checked = settings[id];
    $(id).addEventListener('change', e => { settings[id] = e.target.checked; saveSettings(); });
  }
  $('play-start').addEventListener('click', e => { state.play ? stopPlay() : startPlay(); e.currentTarget.blur(); });
  $('omc-start').addEventListener('click', () => {
    const a = Theory.parseChord($('omc-a').value), b = Theory.parseChord($('omc-b').value);
    if (!a || !b || a.key === b.key) { setFeedback('Enter two different chord names, like G and C', 'bad'); return; }
    startOneMinute(a, b);
  });

  // Options.
  $('opt-order').value = settings.order;
  $('opt-order').addEventListener('change', e => { settings.order = e.target.value; saveSettings(); });
  $('opt-goal').value = settings.goal;
  $('opt-goal').addEventListener('change', e => {
    const v = Number(e.target.value);
    if (v >= 0.5 && v <= 30) settings.goal = v;
    e.target.value = settings.goal;
    saveSettings();
    renderGrid();
  });
  $('opt-lenient').checked = settings.lenient;
  $('opt-lenient').addEventListener('change', e => { settings.lenient = e.target.checked; saveSettings(); });
  $('opt-lefty').checked = settings.leftHanded;
  $('opt-lefty').addEventListener('change', e => {
    settings.leftHanded = e.target.checked;
    saveSettings();
    renderDrill();
    renderPlay();
  });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm(`Clear all practice history for ${instrument().name}, ${tuning().name}?`)) return;
    state.progress.reset();
    renderGrid();
    renderChanges();
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (settings.mode !== 'drill') return;
    if (e.key === ' ') { e.preventDefault(); skip(); }
    if (e.key === 'Enter') { e.preventDefault(); toggleDiagram(); }
  });
}

// ---------- Boot ----------

loadSettings();
useProgress();
wire();
buildMicPanel();
initGrid();
initFretboardClicks();
renderInstrumentControls();
renderChordSets();
renderGrid();
renderProgSelect();
nextChord();
setMode(settings.mode);
refreshInputs();
