'use strict';

// Microphone chord detection.
//
// Each frame: find peaks in the spectrum, then walk them from low to high. A peak that sits on a
// harmonic (2x, 3x, ...) of a note already found is treated as an overtone; anything else is
// a new note. Strummed chords double notes in several octaves; those fold into one note, which is
// all a chord check needs. A note must show up in several recent frames before it counts, which
// filters out flickers. There is also a single-note pitch detector for the tuner.

const MicInput = (() => {
  const FFT_SIZE = 16384;      // ~0.34s window at 48kHz: fine enough to split semitones near middle C
  const FRAME_MS = 40;
  const MIN_HZ = 65;           // lowest fundamental (C2; drop D and open tunings go down to D2)
  const MAX_FUNDAMENTAL_HZ = 2200;
  const MAX_HZ = 6000;         // look this high for overtones
  const NOTE_TOLERANCE = 45;   // cents a peak may be off a semitone (musette reeds are detuned)
  const HARMONIC_TOLERANCE = 35;
  const HISTORY = 5;           // frames remembered per note
  const NEEDED = 3;            // ...of which this many must contain the note for it to sound
  const MAX_NOTES = 6;
  const MAX_HARMONIC = 32;      // low reeds have audible overtones far up the spectrum

  const settings = { gateDb: -70, rangeDb: 30 };

  let ctx = null, stream = null, analyser = null, timer = null;
  let spectrumDb = null, timeData = null;
  let history = [];
  let onChange = () => {}, onFrame = () => {}, onState = () => {};
  let lastNotes = '';

  const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  // mag: linear magnitudes per FFT bin. Returns detected MIDI notes (lowest first) and the peaks found.
  function detectNotes(mag, sampleRate, fftSize, opts = settings) {
    const binHz = sampleRate / fftSize;
    const lo = Math.max(2, Math.floor(MIN_HZ / binHz));
    const hi = Math.min(mag.length - 2, Math.ceil(MAX_HZ / binHz));

    let max = 0;
    for (let k = lo; k <= hi; k++) if (mag[k] > max) max = mag[k];
    const maxDb = 20 * Math.log10(max || 1e-12);
    if (maxDb < opts.gateDb) return { notes: [], peaks: [], maxDb };

    // A peak must be within rangeDb of the loudest one and also above the noise gate, so steady
    // background noise (hum, fans) stays out even while you're playing.
    const floor = Math.max(max * Math.pow(10, -opts.rangeDb / 20), Math.pow(10, opts.gateDb / 20));
    const db = k => 20 * Math.log10(mag[k] || 1e-12);

    // Local maxima above the floor, with parabolic interpolation for a precise frequency.
    const peaks = [];
    for (let k = lo; k <= hi; k++) {
      const m = mag[k];
      if (m < floor || m <= mag[k - 1] || m < mag[k + 1]) continue;
      const a = db(k - 1), b = db(k), c = db(k + 1);
      const denom = a - 2 * b + c;
      const p = denom ? 0.5 * (a - c) / denom : 0;
      peaks.push({ freq: (k + p) * binHz, amp: Math.pow(10, (b - 0.25 * (a - c) * p) / 20) });
    }

    const near = (f, target, cents) => Math.abs(1200 * Math.log2(f / target)) < cents;
    const hasPeakNear = (f, cents) => peaks.some(p => near(p.freq, f, cents));

    const found = [];
    for (const peak of peaks) {
      if (peak.freq > MAX_FUNDAMENTAL_HZ) break;
      const midiF = freqToMidi(peak.freq);
      const midi = Math.round(midiF);
      if (Math.abs(midiF - midi) * 100 > NOTE_TOLERANCE) continue;

      // Check against both the measured pitch and the in-tune pitch of each note found so far:
      // detuned musette reeds can blur the measured pitch enough to miss its upper overtones.
      const isOvertone = found.some(n => [n.freq, midiToFreq(n.midi)].some(f0 => {
        const h = Math.round(peak.freq / f0);
        return h >= 2 && h <= MAX_HARMONIC && near(peak.freq, f0 * h, HARMONIC_TOLERANCE);
      }));
      if (isOvertone) continue;

      // A real reed note has overtones; a lone peak is more likely noise. (Very high notes may
      // have their overtones above the range we look at, so they get a pass.)
      const supported = peak.freq * 2 > MAX_HZ ||
        hasPeakNear(peak.freq * 2, HARMONIC_TOLERANCE) || hasPeakNear(peak.freq * 3, HARMONIC_TOLERANCE);
      if (!supported) continue;

      const existing = found.find(n => n.midi === midi);
      if (!existing) found.push({ midi, freq: peak.freq, amp: peak.amp });
      else if (peak.amp > existing.amp) Object.assign(existing, { freq: peak.freq, amp: peak.amp });
    }

    const notes = found
      .sort((x, y) => y.amp - x.amp)
      .slice(0, MAX_NOTES)
      .map(n => n.midi)
      .sort((x, y) => x - y);
    return { notes, peaks, maxDb };
  }

  function tick() {
    analyser.getFloatFrequencyData(spectrumDb);
    const mag = new Float32Array(spectrumDb.length);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.pow(10, spectrumDb[i] / 20);
    const result = detectNotes(mag, ctx.sampleRate, FFT_SIZE);

    history.push(new Set(result.notes));
    if (history.length > HISTORY) history.shift();
    const counts = new Map();
    for (const frame of history) for (const n of frame) counts.set(n, (counts.get(n) || 0) + 1);
    const sounding = [...counts].filter(([, c]) => c >= NEEDED).map(([n]) => n).sort((a, b) => a - b);

    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (const v of timeData) sum += v * v;
    const levelDb = 10 * Math.log10(sum / timeData.length || 1e-12);

    const key = sounding.join(',');
    if (key !== lastNotes) {
      lastNotes = key;
      onChange(sounding);
    }
    onFrame({ spectrumDb, binHz: ctx.sampleRate / FFT_SIZE, peaks: result.peaks, raw: result.notes, sounding, levelDb, maxDb: result.maxDb,
      timeData, sampleRate: ctx.sampleRate });
  }

  async function start(handlers) {
    stop();
    onChange = handlers.onChange || onChange;
    onFrame = handlers.onFrame || onFrame;
    onState = handlers.onState || onState;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    ctx = new AudioContext();
    ctx.onstatechange = () => onState();
    // Browsers may hold audio until the user interacts with the page; resume on the first input.
    ctx.resume();
    if (ctx.state !== 'running') {
      const resume = () => { if (ctx) ctx.resume(); };
      document.addEventListener('pointerdown', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    }
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    spectrumDb = new Float32Array(analyser.frequencyBinCount);
    timeData = new Float32Array(FFT_SIZE);
    history = [];
    lastNotes = '';
    timer = setInterval(tick, FRAME_MS);
    onState();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ctx) ctx.close();
    stream = ctx = analyser = null;
    onState();
    if (lastNotes) onChange([]);
    lastNotes = '';
  }

  // Single-note pitch for the tuner (the YIN method): finds the period at which the signal best
  // repeats. Much more precise than reading the spectrum. Returns Hz, or null if unclear.
  function pitch(samples, sampleRate) {
    const size = Math.min(samples.length, 4096);
    const buf = samples.subarray(samples.length - size);
    let rms = 0;
    for (const v of buf) rms += v * v;
    if (Math.sqrt(rms / size) < 0.005) return null;

    const minLag = Math.floor(sampleRate / 1400), maxLag = Math.floor(sampleRate / 60);
    const half = size - maxLag;
    const d = new Float32Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < half; i++) {
        const diff = buf[i] - buf[i + lag];
        sum += diff * diff;
      }
      d[lag] = sum;
    }
    // Cumulative mean normalised difference (YIN).
    let running = 0;
    const cmnd = new Float32Array(maxLag + 2);
    cmnd[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      running += d[lag];
      cmnd[lag] = running ? d[lag] * lag / running : 1;
    }
    cmnd[maxLag + 1] = cmnd[maxLag];

    // The true period usually falls between two sample positions, so estimate each dip's value and
    // position by fitting a parabola through its three samples. Without this, a high note matches
    // a little worse at its own period than at double it, and reads an octave low.
    const refine = (arr, l) => {
      const a = arr[l - 1], b = arr[l], c = arr[l + 1];
      const den = a - 2 * b + c;
      if (!(den > 0)) return { lag: l, value: b };
      const shift = Math.max(-1, Math.min(1, 0.5 * (a - c) / den));
      return { lag: l + shift, value: b - 0.25 * (a - c) * shift };
    };
    const dips = [];
    for (let l = Math.max(minLag, 2); l < maxLag; l++) {
      if (cmnd[l] < cmnd[l - 1] && cmnd[l] <= cmnd[l + 1]) dips.push({ l, ...refine(cmnd, l) });
    }
    if (!dips.length) return null;
    const deepest = Math.min(...dips.map(x => x.value));
    if (deepest > 0.35) return null; // no clear pitch
    // The shortest period that matches nearly as well as the best one (longer ones are repeats of it).
    let best = dips.find(x => x.value <= Math.max(0.15, deepest + 0.08));

    // Octave check: a low string heard through a small mic can repeat *almost* every half period
    // (strong octave overtone, weak fundamental), so the first good dip is half the real period.
    // Then twice that delay matches far better; for a genuine note it matches no better.
    for (;;) {
      const target = 2 * best.lag;
      const near = dips.filter(x => Math.abs(x.l - target) <= 3);
      if (!near.length) break;
      const twice = near.reduce((a, b) => (b.value < a.value ? b : a));
      if (!(refine(d, twice.l).value < refine(d, best.l).value * 0.35)) break;
      best = twice;
    }
    return sampleRate / best.lag;
  }

  const isRunning = () => !!timer && ctx.state === 'running';
  const isWaitingForClick = () => !!timer && ctx.state === 'suspended';

  return { start, stop, detectNotes, pitch, settings, isRunning, isWaitingForClick, MIN_HZ, MAX_HZ };
})();

if (typeof module !== 'undefined') module.exports = MicInput;
