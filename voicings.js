'use strict';

// Finds playable shapes (voicings) for a chord on a fretted instrument and ranks them.
//
// For each 4-fret window up the neck, every string may be muted, open, or fretted within the
// window, but only on notes that belong to the chord. A combination is a valid shape when it
// contains every required chord tone, puts the right note in the bass (guitar), and can be held
// with four fingers (a barre counts as one). Shapes are then scored for how easy they are:
// low on the neck, open strings, few fingers, no awkward muted strings in the middle.

const Voicings = (() => {
  const WINDOW = 4;          // frets the hand covers without stretching
  const MAX_START = 12;      // highest window start searched
  const MAX_FINGERS = 4;

  // strings: open-string MIDI notes in physical order. inst: { bassMatters }.
  function generate(chord, strings, inst, limit = 8) {
    const want = new Set(chord.pcs);
    const required = chord.required;
    const bassPc = chord.bass ?? chord.root.pc;
    // Guitar chords use at least four strings (power chords two); ukulele chords use them all.
    const minStrings = !inst.bassMatters ? strings.length : chord.type.id === 'pow' ? 2 : 4;
    const seen = new Set();
    const shapes = [];

    for (let start = 1; start <= MAX_START; start++) {
      // Options per string: muted (-1), open (0) if it's a chord tone, or a chord tone in the window.
      const options = strings.map(open => {
        const opts = [-1];
        if (want.has(open % 12)) opts.push(0);
        for (let f = start; f < start + WINDOW; f++) if (want.has((open + f) % 12)) opts.push(f);
        return opts;
      });

      const frets = new Array(strings.length);
      const walk = i => {
        if (i === strings.length) {
          const key = frets.join(',');
          if (seen.has(key)) return;
          seen.add(key);
          const shape = evaluate([...frets], strings, inst, required, bassPc, minStrings, chord);
          if (shape) shapes.push(shape);
          return;
        }
        for (const f of options[i]) { frets[i] = f; walk(i + 1); }
      };
      walk(0);
    }

    shapes.sort((a, b) => a.score - b.score);
    return shapes.slice(0, limit);
  }

  function evaluate(frets, strings, inst, required, bassPc, minStrings, chord) {
    const played = frets.map((f, i) => (f >= 0 ? strings[i] + f : null));
    const sounding = played.filter(n => n !== null);
    if (sounding.length < minStrings) return null;

    const pcs = new Set(sounding.map(n => n % 12));
    if (!required.every(pc => pcs.has(pc))) return null;

    const lowest = Math.min(...sounding);
    if (inst.bassMatters && lowest % 12 !== bassPc) return null;

    const fretted = frets.map((f, i) => ({ f, i })).filter(x => x.f > 0);
    const minFret = fretted.length ? Math.min(...fretted.map(x => x.f)) : 0;
    const maxFret = fretted.length ? Math.max(...fretted.map(x => x.f)) : 0;
    if (maxFret - minFret >= WINDOW) return null;

    const fingering = assignFingers(frets, fretted, minFret);
    if (!fingering) return null;

    // Muted strings: between played strings is awkward; on the treble side less usual than the bass side.
    const first = frets.findIndex(f => f >= 0);
    const last = frets.length - 1 - [...frets].reverse().findIndex(f => f >= 0);
    let interiorMutes = 0;
    for (let i = first; i <= last; i++) if (frets[i] < 0) interiorMutes++;
    const trebleMutes = frets.length - 1 - last;
    const bassMutes = first;
    const opens = frets.filter(f => f === 0).length;
    const missingOptional = chord.optional.filter(pc => !pcs.has(pc)).length;

    // An open string with fretted strings on both sides is awkward when the hand reaches over it
    // to fret 3 or higher (fine in C = x32010, awkward in Bm = x20402).
    let awkwardOpens = 0;
    for (let i = first + 1; i < last; i++) {
      const lo = frets[i - 1], hi = frets[i + 1];
      if (frets[i] === 0 && lo > 0 && hi > 0 && Math.max(lo, hi) >= 3) awkwardOpens++;
    }

    let score = 0;
    score += minFret * 0.9;                        // lower on the neck is easier
    score -= opens * (maxFret <= 3 ? 0.5 : 0);     // open strings help in open position
    if (inst.bassMatters) score += awkwardOpens * 2; // guitar only: ukulele shapes like E = 1402 use this freely
    score += fingering.count * 0.6 + (fingering.count === MAX_FINGERS ? 1.2 : 0); // all four fingers is hard
    score += fingering.barre ? (fingering.barre.full ? 1.2 : 0.8) : 0;
    score += (maxFret - minFret) * 0.5;            // stretch
    score += interiorMutes * 7;                    // muting a middle string is hard for learners
    if (chord.type.id === 'pow') {
      score += Math.max(0, sounding.length - 3) * 1.5; // power chords are two or three strings
    } else if (inst.bassMatters) {
      score += trebleMutes * 1.5;
      score -= sounding.length * 0.4;              // fuller guitar chords sound better
    } else {
      score += (interiorMutes + trebleMutes + bassMutes) * 3; // ukulele chords use every string
    }
    score += missingOptional * 0.5;

    return {
      frets,
      fingers: fingering.fingers,
      barre: fingering.barre,
      minFret,
      maxFret,
      notes: played,
      score: Math.round(score * 100) / 100,
    };
  }

  // Finger numbers 1-4 for each fretted string, using a barre with finger 1 when it helps.
  // base: the fret under the index finger. By default fret 1 in open position, otherwise the
  // lowest fret; passing another base gives an alternative fingering of the same shape.
  function assignFingers(frets, fretted, minFret, baseOverride) {
    const fingers = frets.map(() => 0);
    if (!fretted.length) return { fingers, count: 0, barre: null };

    let barre = null;
    const atMin = fretted.filter(x => x.f === minFret).map(x => x.i);
    if (atMin.length >= 2) {
      const from = Math.min(...atMin), to = Math.max(...atMin);
      const range = frets.slice(from, to + 1);
      // A barre can only cover strings that are fretted at or above it. Use one when four
      // fingers aren't enough, or as a small barre across neighbouring treble strings at the
      // same fret (like the F chord xx3211).
      const covers = range.every(f => f >= minFret);
      const flatTreble = to === frets.length - 1 && range.every(f => f === minFret);
      if (covers && (fretted.length > MAX_FINGERS || flatTreble)) barre = { fret: minFret, from, to, full: to - from >= 4 };
    }

    const rest = fretted.filter(x => !(barre && x.f === barre.fret && x.i >= barre.from && x.i <= barre.to));
    let last = 0;
    if (barre) {
      for (let i = barre.from; i <= barre.to; i++) if (frets[i] === barre.fret) fingers[i] = 1;
      last = 1;
    }
    if (rest.length + last > MAX_FINGERS) return null;

    // One finger per fret, as teachers show it: in open position fret 1 = index, fret 3 = ring;
    // higher up, the lowest fret is the index. Notes on the same fret share the nearest fingers.
    const base = baseOverride ?? (Math.max(...fretted.map(x => x.f)) <= MAX_FINGERS ? 1 : minFret);
    rest.sort((a, b) => a.f - b.f || a.i - b.i);
    for (let k = 0; k < rest.length;) {
      const group = rest.filter(x => x.f === rest[k].f);
      const want = Math.min(MAX_FINGERS, rest[k].f - base + 1);
      let finger = Math.max(last + 1, want - group.length + 1);
      // Leave enough fingers for the notes still to come.
      finger = Math.min(finger, MAX_FINGERS - (rest.length - k) + 1);
      for (const x of group) fingers[x.i] = finger++;
      last = finger - 1;
      k += group.length;
    }
    return { fingers, count: rest.length + (barre ? 1 : 0), barre };
  }

  // A short list of genuinely different ways to play a chord: the easiest shape, then the best
  // shape in each other area of the neck. Near-copies (the same shape with a string muted or one
  // note moved) are left out, since they'd only clutter the choice for a learner.
  // A muted string between played strings (hard for learners to keep quiet).
  function hasMiddleMute(s) {
    const first = s.frets.findIndex(f => f >= 0);
    const last = s.frets.length - 1 - [...s.frets].reverse().findIndex(f => f >= 0);
    return s.frets.slice(first, last + 1).some(f => f < 0);
  }

  // prefer: frets ("0,4,3,2") of the shape charts teach for this chord, to show first.
  function positions(chord, strings, inst, max = 5, prefer = null) {
    const area = s => (s.maxFret <= 4 ? 0 : s.minFret);          // open position counts as 0
    // Up the neck, learners use closed shapes (no open strings) that can slide to any key, and
    // barre chords are the normal way to play them there, so a barre isn't counted against them
    // and fuller (more strings) versions are preferred.
    const ranked = generate(chord, strings, inst, 400);
    if (prefer && !ranked.some(s => s.frets.join() === prefer)) prefer = null;
    if (!ranked.length) return [];
    const all = ranked
      .filter(s => area(s) === 0 || (!s.frets.includes(0) && !hasMiddleMute(s)))
      .map(s => ({ s, rank: s.score - (area(s) > 0 ? (s.barre ? (s.barre.full ? 1.2 : 0.8) : 0) + 0.5 * s.notes.filter(n => n !== null).length : 0) }))
      .sort((a, b) => a.rank - b.rank)
      .map(x => x.s);
    const differs = (a, b) => a.frets.filter((f, i) => f !== b.frets[i]).length;
    // The shape on chord charts comes first: the standard one if given, otherwise the easiest.
    const picked = [ranked.find(s => s.frets.join() === prefer) ?? ranked[0]];
    for (const s of all) {
      if (picked.some(p => differs(p, s) <= 2 || Math.abs(area(p) - area(s)) < 3)) continue;
      picked.push(s);
      if (picked.length === max) break;
    }
    return picked.sort((a, b) => area(a) - area(b));
  }

  // ---- Choosing shapes for a progression ----
  //
  // Guitar teachers smooth chord changes in three ways, all of which keep the chord itself:
  //  - anchor fingers: a finger that stays on the same string and fret for both chords;
  //  - a different fingering of the same shape (G = 320003 as 3-2-4 before C, 2-1-3 before D);
  //  - a different voicing of the same chord (G = 320033 keeps the ring finger where D needs it).
  // Inversions (G/B, D/F#) are a choice about the bass line, written into the song, so they're
  // only used when the progression asks for them.

  // Alternative fingerings of a shape: the default, and the hand one fret higher if that works
  // (index on the lowest fret rather than fret 1).
  function fingerings(shape) {
    const fretted = shape.frets.map((f, i) => ({ f, i })).filter(x => x.f > 0);
    if (!fretted.length) return [{ fingers: shape.fingers, base: 1 }];
    const out = [{ fingers: shape.fingers, base: shape.maxFret <= MAX_FINGERS ? 1 : shape.minFret }];
    if (shape.maxFret <= MAX_FINGERS && shape.minFret > 1) {
      const alt = assignFingers(shape.frets, fretted, shape.minFret, shape.minFret);
      if (alt && alt.fingers.join() !== shape.fingers.join() && !alt.fingers.some(f => f > MAX_FINGERS)) {
        out.push({ fingers: alt.fingers, base: shape.minFret });
      }
    }
    return out;
  }

  // Shapes worth considering for a chord in a progression: the usual positions, plus other
  // open-position voicings that are nearly as easy as the standard one.
  function candidates(chord, strings, inst, prefer = null) {
    const pos = positions(chord, strings, inst, 5, prefer);
    if (!pos.length) return [];
    const easiest = pos[0].score; // the standard shape when one is given
    // Never thinner than the standard shape: saving a finger by muting strings isn't what teachers do.
    const sounding = s => s.frets.filter(f => f >= 0).length;
    const full = sounding(pos[0]);
    const near = generate(chord, strings, inst, 40)
      .filter(s => s.maxFret <= MAX_FINGERS && s.score <= easiest + 2.5 && sounding(s) >= full);
    const seen = new Set();
    const out = [];
    for (const shape of [...pos, ...near]) {
      const key = shape.frets.join();
      if (seen.has(key)) continue;
      seen.add(key);
      // How much harder than the chart shape. Shapes that score "easier" than a standard one aren't
      // free: a different shape from the one on the chart has to earn its place by saving moves.
      const isStandard = shape === pos[0];
      const extra = Math.max(0, shape.score - easiest) + (prefer && !isStandard ? 1 : 0);
      for (const f of fingerings(shape)) out.push({ shape, fingers: f.fingers, base: f.base, extra });
    }
    return out;
  }

  // What changes from one held chord to the next: fingers that stay put (anchors), fingers that
  // slide along their string, and how many fingers must be lifted and placed again.
  function transition(a, b) {
    const anchors = [], slides = [];
    let moves = 0;
    b.shape.frets.forEach((fret, i) => {
      if (fret <= 0) return;
      const finger = b.fingers[i];
      if (finger && a.shape.frets[i] === fret && a.fingers[i] === finger) anchors.push({ string: i, fret, finger });
      else if (finger && a.fingers[i] === finger && a.shape.frets[i] > 0 && Math.abs(a.shape.frets[i] - fret) <= 2) {
        slides.push({ string: i, from: a.shape.frets[i], to: fret, finger });
      } else moves++;
    });
    // A barre counts once, not once per string.
    const barreStrings = b.shape.barre ? b.shape.frets.filter((f, i) => f === b.shape.barre.fret && b.fingers[i] === 1).length : 0;
    if (barreStrings > 1) moves -= barreStrings - 1;
    const cost = Math.max(0, moves) + slides.length * 0.4 + Math.abs(a.base - b.base) * 0.3;
    return { cost, anchors, slides };
  }

  // Pick a shape and fingering for each chord so the changes are as easy as possible while staying
  // close to the standard shapes. chords: in playing order (repeats already merged); loop: the last
  // chord leads back to the first; fixed: chord key -> frets the player chose, kept as-is;
  // standard: chord symbol -> frets of the shape charts teach (treated as the easiest).
  function plan(chords, strings, inst, loop = false, fixed = {}, standard = {}) {
    const DIFFICULTY = 0.4; // a shape this much harder than the easiest must save this many finger moves
    const opts = chords.map(c => {
      const all = candidates(c, strings, inst, standard[c.symbol]);
      const list = fixed[c.key] ? all.filter(x => x.shape.frets.join() === fixed[c.key]) : all;
      return list.length ? list : all;
    });
    if (opts.some(o => !o.length)) return chords.map((c, i) => opts[i][0] ? { ...opts[i][0], chord: c } : null);
    const n = chords.length;
    let best = null;
    // With a loop the first choice matters at the end too, so try each first-chord option in turn.
    const starts = loop && n > 1 ? opts[0].map((_, k) => k) : [null];
    for (const start of starts) {
      let cost = opts[0].map((o, k) => (start === null || k === start ? o.extra * DIFFICULTY : Infinity));
      const back = [];
      for (let i = 1; i < n; i++) {
        const prev = cost, from = [];
        cost = opts[i].map(o => {
          let min = Infinity, arg = 0;
          opts[i - 1].forEach((p, k) => {
            const c = prev[k] + transition(p, o).cost;
            if (c < min) { min = c; arg = k; }
          });
          from.push(arg);
          return min + o.extra * DIFFICULTY;
        });
        back.push(from);
      }
      let end = 0, total = Infinity;
      cost.forEach((c, k) => {
        const t = c + (start !== null ? transition(opts[n - 1][k], opts[0][start]).cost : 0);
        if (t < total) { total = t; end = k; }
      });
      if (!best || total < best.total) {
        const pick = [end];
        for (let i = n - 2; i >= 0; i--) pick.unshift(back[i][pick[0]]);
        best = { total, pick };
      }
    }
    return best.pick.map((k, i) => ({ ...opts[i][k], chord: chords[i] }));
  }

  return { generate, positions, fingerings, candidates, transition, plan };
})();

if (typeof module !== 'undefined') module.exports = Voicings;
