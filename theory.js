'use strict';

// Notes, chords, chord symbols and roman numerals.

const Theory = (() => {
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const ACCIDENTAL = { '-2': '♭♭', '-1': '♭', '0': '', '1': '♯', '2': '♯♯' };
  const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  // Root spellings guitarists usually see (C♯m and F♯ rather than D♭m and G♭).
  const ROOTS = [
    [0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
  ].map(([letter, acc]) => {
    const pc = (LETTER_PC[letter] + acc + 12) % 12;
    return { letter, acc, pc, name: LETTERS[letter] + ACCIDENTAL[acc] };
  });

  // Intervals as [semitones, letter steps] so notes spell correctly.
  const R = [0, 0], M2 = [2, 1], m3 = [3, 2], M3 = [4, 2], P4 = [5, 3], d5 = [6, 4], P5 = [7, 4],
    A5 = [8, 4], M6 = [9, 5], d7 = [9, 6], m7 = [10, 6], M7 = [11, 6], M9 = [14, 8];

  // `optional`: tones a guitarist may leave out (the 5th, once a chord has 4 or more notes).
  const CHORD_TYPES = [
    { id: 'maj',  sym: '',      name: 'major',            tones: [R, M3, P5] },
    { id: 'min',  sym: 'm',     name: 'minor',            tones: [R, m3, P5] },
    { id: 'dom7', sym: '7',     name: 'dominant 7th',     tones: [R, M3, P5, m7], optional: [P5] },
    { id: 'maj7', sym: 'maj7',  name: 'major 7th',        tones: [R, M3, P5, M7], optional: [P5] },
    { id: 'min7', sym: 'm7',    name: 'minor 7th',        tones: [R, m3, P5, m7], optional: [P5] },
    { id: 'sus2', sym: 'sus2',  name: 'suspended 2nd',    tones: [R, M2, P5] },
    { id: 'sus4', sym: 'sus4',  name: 'suspended 4th',    tones: [R, P4, P5] },
    { id: '7sus4', sym: '7sus4', name: '7th suspended 4th', tones: [R, P4, P5, m7], optional: [P5] },
    { id: 'pow',  sym: '5',     name: 'power chord',      tones: [R, P5] },
    { id: 'six',  sym: '6',     name: 'major 6th',        tones: [R, M3, P5, M6], optional: [P5] },
    { id: 'min6', sym: 'm6',    name: 'minor 6th',        tones: [R, m3, P5, M6], optional: [P5] },
    { id: 'add9', sym: 'add9',  name: 'add 9',            tones: [R, M3, P5, M9], optional: [P5] },
    { id: 'nine', sym: '9',     name: 'dominant 9th',     tones: [R, M3, P5, m7, M9], optional: [P5] },
    { id: 'dim',  sym: 'dim',   name: 'diminished',       tones: [R, m3, d5] },
    { id: 'dim7', sym: 'dim7',  name: 'diminished 7th',   tones: [R, m3, d5, d7] },
    { id: 'hdim', sym: 'm7♭5',  name: 'half-diminished',  tones: [R, m3, d5, m7] },
    { id: 'aug',  sym: 'aug',   name: 'augmented',        tones: [R, M3, A5] },
  ];
  const TYPE = Object.fromEntries(CHORD_TYPES.map(t => [t.id, t]));

  function spell(root, [semis, steps]) {
    const letter = (root.letter + steps) % 7;
    let acc = ((root.pc + semis - LETTER_PC[letter]) % 12 + 12) % 12;
    if (acc > 6) acc -= 12;
    return { letter, acc, pc: (root.pc + semis) % 12, name: LETTERS[letter] + ACCIDENTAL[acc] };
  }

  const rootByPc = pc => ROOTS[((pc % 12) + 12) % 12];

  // bass: a root object for slash chords (D/F♯), or null.
  function buildChord(root, type, bass = null) {
    const tones = type.tones.map(t => spell(root, t));
    const optional = new Set((type.optional || []).map(([s]) => (root.pc + s) % 12));
    const pcs = tones.map(t => t.pc);
    let bassName = null;
    if (bass) {
      // Spell the bass as a chord tone when it is one, otherwise with the usual root spelling.
      const tone = tones.find(t => t.pc === bass.pc);
      bassName = tone ? tone.name : bass.name;
    }
    return {
      root,
      type,
      bass: bass ? bass.pc : null,
      key: `${root.pc}:${type.id}` + (bass ? `/${bass.pc}` : ''),
      symbol: root.name + type.sym + (bassName ? '/' + bassName : ''),
      longName: `${root.name} ${type.name}` + (bassName ? ` over ${bassName}` : ''),
      pcs,
      required: pcs.filter(pc => !optional.has(pc)),
      optional: [...optional],
      names: tones.map(t => t.name),
      tones,
    };
  }

  const chordFromKey = key => {
    const [main, bass] = key.split('/');
    const [pc, typeId] = main.split(':');
    return buildChord(rootByPc(Number(pc)), TYPE[typeId], bass === undefined ? null : rootByPc(Number(bass)));
  };

  // Name for a pitch class, spelled as a chord tone if it is one.
  function pcName(pc, chord) {
    const i = chord ? chord.pcs.indexOf(pc) : -1;
    return i >= 0 ? chord.names[i] : PC_NAMES[pc];
  }

  // ---- Parsing chord symbols ----

  // Longest suffixes first so "maj7" wins over "maj" and "m7♭5" over "m7".
  const SUFFIXES = [
    ['m7b5', 'hdim'], ['m7♭5', 'hdim'], ['min7b5', 'hdim'], ['ø7', 'hdim'], ['ø', 'hdim'],
    ['7sus4', '7sus4'], ['7sus', '7sus4'],
    ['maj7', 'maj7'], ['Maj7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'],
    ['min7', 'min7'], ['m7', 'min7'], ['-7', 'min7'],
    ['dim7', 'dim7'], ['°7', 'dim7'], ['o7', 'dim7'],
    ['add9', 'add9'], ['add2', 'add9'],
    ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
    ['min6', 'min6'], ['m6', 'min6'],
    ['maj', 'maj'], ['min', 'min'], ['dim', 'dim'], ['aug', 'aug'],
    ['m', 'min'], ['-', 'min'], ['°', 'dim'], ['o', 'dim'], ['+', 'aug'],
    ['7', 'dom7'], ['9', 'nine'], ['6', 'six'], ['5', 'pow'], ['M', 'maj'], ['', 'maj'],
  ];

  function parseSuffix(text) {
    for (const [s, id] of SUFFIXES) if (text === s) return TYPE[id];
    return null;
  }

  function parseNote(text) {
    const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(text);
    if (!m) return null;
    const letter = LETTERS.indexOf(m[1].toUpperCase());
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    const pc = (LETTER_PC[letter] + acc + 12) % 12;
    return { letter, acc, pc, name: LETTERS[letter] + ACCIDENTAL[acc] };
  }

  // "F#m7", "Bb", "D/F#" -> chord, or null.
  function parseChord(text) {
    const m = /^([A-G][#♯b♭]?)([^/]*)(?:\/([A-G][#♯b♭]?))?$/.exec(text.trim());
    if (!m) return null;
    const root = parseNote(m[1]);
    const type = parseSuffix(m[2]);
    const bass = m[3] ? parseNote(m[3]) : null;
    if (!root || !type || (m[3] && !bass)) return null;
    return buildChord(root, type, bass && bass.pc !== root.pc ? bass : null);
  }

  // ---- Roman numerals ----

  const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  // A scale degree like "VII", "bVI" or "iii" in a key: { degree (0-6), pc, upper (case) }.
  function parseDegree(text, key) {
    const m = /^([b♭#♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)$/.exec(text);
    if (!m) return null;
    const degree = NUMERALS.indexOf(m[2].toUpperCase());
    const shift = m[1] === 'b' || m[1] === '♭' ? -1 : m[1] ? 1 : 0;
    return { degree, pc: (key.root.pc + MAJOR_STEPS[degree] + shift + 12) % 12 };
  }

  // key: { root (root object), minor (bool) }. "IV7", "vi", "bVII", "ii7", and slash chords whose
  // bass is a scale degree: "V/VII" in C is G/B. (Secondary dominants like "V/V" aren't supported.)
  // Numerals count from the major scale even in minor keys, as usually written: in A minor,
  // i–bVII–bVI–V is Am–G–F–E.
  function parseRoman(text, key) {
    text = text.trim();
    const slash = text.lastIndexOf('/');
    if (slash > 0) {
      const chord = parseRoman(text.slice(0, slash), key);
      const bass = parseDegree(text.slice(slash + 1).toUpperCase().replace(/^B(?=[IV])/, 'b'), key);
      if (!chord || !bass) return null;
      return bass.pc === chord.root.pc ? chord : buildChord(chord.root, chord.type, spellInKey(bass.pc, bass.degree, key));
    }
    const m = /^([b♭#♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(text);
    if (!m) return null;
    const degree = NUMERALS.indexOf(m[2].toUpperCase());
    const upper = m[2] === m[2].toUpperCase();
    const shift = m[1] === 'b' || m[1] === '♭' ? -1 : m[1] ? 1 : 0;
    const pc = (key.root.pc + MAJOR_STEPS[degree] + shift + 12) % 12;

    // Case gives the quality when the suffix doesn't: IV = major, iv = minor, iv7 = minor 7th.
    let suffix = m[3];
    let type;
    if (suffix === '' ) type = TYPE[upper ? 'maj' : 'min'];
    else if (suffix === '7') type = TYPE[upper ? 'dom7' : 'min7'];
    else if (suffix === '°' || suffix === 'o') type = TYPE.dim;
    else if (suffix === '°7' || suffix === 'o7') type = TYPE.dim7;
    else if (suffix === 'ø' || suffix === 'ø7') type = TYPE.hdim;
    else type = parseSuffix(suffix);
    if (!type) return null;
    return buildChord(spellInKey(pc, degree, key), type);
  }

  // Spell a scale degree's root using the key's letters (B♭ in F, not A♯).
  function spellInKey(pc, degree, key) {
    const letter = (key.root.letter + degree) % 7;
    let acc = ((pc - LETTER_PC[letter]) % 12 + 12) % 12;
    if (acc > 6) acc -= 12;
    if (Math.abs(acc) > 1) return rootByPc(pc);
    return { letter, acc, pc, name: LETTERS[letter] + ACCIDENTAL[acc] };
  }

  // ---- Identifying what was played ----

  // Name the chord formed by these pitch classes, or null. Prefers the reading whose root is the bass.
  function identify(pcSet, bassPc) {
    let best = null;
    for (const root of ROOTS) {
      for (const type of CHORD_TYPES) {
        const c = buildChord(root, type);
        const full = c.pcs.length === pcSet.size && c.pcs.every(pc => pcSet.has(pc));
        const no5 = c.required.length === pcSet.size && c.required.every(pc => pcSet.has(pc));
        if (!full && !no5) continue;
        const score = (root.pc === bassPc ? 2 : 0) + (full ? 1 : 0);
        if (!best || score > best.score) best = { chord: c, score };
      }
    }
    return best && best.chord;
  }

  // "E2" -> MIDI 40.
  function parseNoteWithOctave(text) {
    const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(text.trim());
    if (!m) return null;
    const note = parseNote(m[1] + m[2]);
    return note.pc + 12 * (Number(m[3]) + 1) - (note.acc === -1 && note.pc === 11 ? 12 : 0) + (note.acc === 1 && note.pc === 0 ? 12 : 0);
  }

  const midiName = n => PC_NAMES[n % 12] + (Math.floor(n / 12) - 1);

  return {
    LETTERS, LETTER_PC, ACCIDENTAL, PC_NAMES, ROOTS, CHORD_TYPES, TYPE,
    spell, rootByPc, buildChord, chordFromKey, pcName, parseNote, parseChord, parseRoman,
    identify, parseNoteWithOctave, midiName,
  };
})();

if (typeof module !== 'undefined') module.exports = Theory;
