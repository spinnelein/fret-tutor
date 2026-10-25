'use strict';

// Chord progressions: common presets (written in roman numerals so they work in any key) and a
// parser for progressions typed by hand.
//
// Text format: bars separated by "|", chords in a bar separated by spaces. "%" repeats the
// previous bar. Chords can be names (G, F#m7, D/F#) or roman numerals in the chosen key
// (I, IV7, vi, bVII, V/VII). Without any "|", each chord is one bar.

const Progressions = (() => {
  // keys: a comfortable default key per instrument. group: the heading in the library.
  // level: 0 beginner, 1 intermediate, 2 advanced. song: a well-known example to listen to.
  const GROUPS = ['Pop & rock', 'Blues & gospel', 'Folk & dance', 'Jazz', 'Classical & lessons'];
  const PRESETS = [
    // Blues & gospel
    { id: 'blues12', group: 'Blues & gospel', name: '12-bar blues',
      about: 'The backbone of blues and rock and roll. Three chords, twelve bars.',
      text: 'I7 | I7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7',
      level: 0, song: { title: 'Johnny B. Goode', artist: 'Chuck Berry' },
      keys: { guitar: 'E', ukulele: 'A', piano: 'C' } },
    { id: 'blues12quick', group: 'Blues & gospel', name: '12-bar blues (quick change)',
      about: 'Same as the 12-bar blues, but goes to the IV chord in bar 2.',
      text: 'I7 | IV7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7',
      level: 0, song: { title: 'Sweet Home Chicago', artist: 'Robert Johnson' },
      keys: { guitar: 'A', ukulele: 'A', piano: 'F' } },
    { id: 'blues12basic', group: 'Blues & gospel', name: '12-bar blues (no 7ths)',
      about: 'A simpler blues with plain major chords. A good first progression.',
      text: 'I | I | I | I | IV | IV | I | I | V | IV | I | V',
      level: 0, song: { title: 'Rock Around the Clock', artist: 'Bill Haley & His Comets' },
      keys: { guitar: 'A', ukulele: 'C', piano: 'C' } },
    { id: 'blues8', group: 'Blues & gospel', name: '8-bar blues',
      about: 'A shorter blues form ("Key to the Highway", "Trouble in Mind").',
      text: 'I7 | V7 | IV7 | IV7 | I7 | V7 | I7 | V7',
      level: 0, song: { title: 'Key to the Highway', artist: 'Big Bill Broonzy' },
      keys: { guitar: 'E', ukulele: 'A', piano: 'C' } },
    { id: 'minorBlues', group: 'Blues & gospel', name: 'Minor blues',
      about: 'The 12-bar blues in a minor key, with the ♭VI7–V7 move in bars 9–10 ("The Thrill Is Gone").',
      text: 'i | i | i | i | iv | iv | i | i | bVI7 | V7 | i | i',
      level: 1, song: { title: 'The Thrill Is Gone', artist: 'B.B. King' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Cm' } },
    { id: 'gospel', group: 'Blues & gospel', name: 'Hymn / gospel: I–I7–IV–I … vi–V–I',
      about: 'The shape of many hymns and gospel songs, in 3/4 time (set beats per bar to 3).',
      text: 'I | I7 | IV | I | I | I | V | V | I | I7 | IV | I | vi | V | I | I',
      level: 1, song: { title: 'Amazing Grace', artist: 'traditional hymn' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'F' } },

    // Pop & rock
    { id: 'pop', group: 'Pop & rock', name: 'Pop: I–V–vi–IV',
      about: 'The "four chords" heard in hundreds of pop songs.',
      text: 'I | V | vi | IV',
      level: 0, song: { title: 'Let It Be', artist: 'The Beatles' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'fifties', group: 'Pop & rock', name: '50s: I–vi–IV–V',
      about: 'The doo-wop progression ("Stand By Me", "Earth Angel", "Heart and Soul").',
      text: 'I | vi | IV | V',
      level: 0, song: { title: 'Stand By Me', artist: 'Ben E. King' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'sad', group: 'Pop & rock', name: 'Minor pop: vi–IV–I–V',
      about: 'The pop progression starting on the minor chord.',
      text: 'vi | IV | I | V',
      level: 0, song: { title: 'Zombie', artist: 'The Cranberries' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'oneFourOneFive', group: 'Pop & rock', name: 'I–IV–I–V',
      about: 'A bright, simple loop heard in rock, pop and folk ("Brown Eyed Girl": G–C–G–D).',
      text: 'I | IV | I | V',
      level: 0, song: { title: 'Brown Eyed Girl', artist: 'Van Morrison' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'G' } },
    { id: 'aeolianRock', group: 'Pop & rock', name: 'Minor rock: i–♭VII–♭VI–♭VII',
      about: 'A dark, driving minor loop ("All Along the Watchtower": Am–G–F–G).',
      text: 'i | bVII | bVI | bVII',
      level: 0, song: { title: 'All Along the Watchtower', artist: 'Jimi Hendrix' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Am' } },
    { id: 'descending', group: 'Pop & rock', name: 'Descending bass: I–V/7–vi–IV',
      about: 'The bass walks down step by step, using a slash chord (in C: C – G/B – Am – F).',
      text: 'I | V/VII | vi | IV',
      level: 1, song: { title: 'Examples', search: 'descending bass line chord progression slash chords songs' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'royal', group: 'Pop & rock', name: '"Royal road": IV–V–iii–vi',
      about: 'Hugely common in Japanese pop and anime music.',
      text: 'IV | V | iii | vi',
      level: 1, song: { title: 'Examples', search: 'royal road progression IV V iii vi songs' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },

    // Folk & dance
    { id: 'polka', group: 'Folk & dance', name: 'Polka / waltz: I–V7',
      about: 'Two chords that carry countless polkas, waltzes and folk dances.',
      text: 'I | I | V7 | V7 | V7 | V7 | I | I',
      level: 0, song: { title: 'Oh My Darling, Clementine', artist: 'traditional' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'folk', group: 'Folk & dance', name: 'Three-chord folk: I–IV–V',
      about: 'Countless folk, country and campfire songs use just these three chords.',
      text: 'I | I | IV | I | I | I | V | V | I | I | IV | IV | I | V | I | I',
      level: 0, song: { title: 'This Land Is Your Land', artist: 'Woody Guthrie' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'folk7', group: 'Folk & dance', name: 'Folk with V7: I–IV–V7–I',
      about: 'The three-chord pattern with the dominant 7th, as most folk and dance music plays it.',
      text: 'I | IV | V7 | I',
      level: 0, song: { title: 'You Are My Sunshine', artist: 'traditional' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'G' } },
    { id: 'minorWaltz', group: 'Folk & dance', name: 'Minor waltz: i–iv–V7–i',
      about: 'French musette, tango and Eastern European folk.',
      text: 'i | i | iv | iv | V7 | V7 | i | i',
      level: 1, song: { title: 'Dark Eyes (Ochi Chyornye)', artist: 'traditional Russian' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Dm' } },
    { id: 'mixolydian', group: 'Pop & rock', name: 'Mixolydian rock: I–♭VII–IV',
      about: 'The flattened 7th chord gives classic rock (and many Irish and Scottish tunes) their sound.',
      text: 'I | bVII | IV | I',
      level: 0, song: { title: 'Sweet Home Alabama', artist: 'Lynyrd Skynyrd' },
      keys: { guitar: 'D', ukulele: 'G', piano: 'D' } },

    { id: 'ragtime', group: 'Folk & dance', name: 'Ragtime: I–VI7–II7–V7',
      about: 'A chain of dominant 7ths around the circle of fifths: old-time, early jazz and accordion favourite.',
      text: 'I | VI7 | II7 | V7',
      level: 1, song: { title: 'Examples', search: 'ragtime progression I VI7 II7 V7 songs' },
      keys: { guitar: 'C', ukulele: 'C', piano: 'C' } },

    // Jazz
    { id: 'jazz', group: 'Jazz', name: 'Jazz: ii–V–I',
      about: 'The most common progression in jazz.',
      text: 'ii7 | V7 | Imaj7 | Imaj7',
      level: 1, song: { title: 'Autumn Leaves', artist: 'jazz standard' },
      keys: { guitar: 'C', ukulele: 'F', piano: 'C' } },
    { id: 'minor25', group: 'Jazz', name: 'Minor ii–V–i',
      about: 'The minor-key version of the ii–V–I.',
      text: 'iiø | V7 | i | i',
      level: 2, song: { title: 'Blue Bossa', artist: 'Kenny Dorham' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Dm' } },
    { id: 'turnaround', group: 'Jazz', name: 'Turnaround: I–vi–ii–V',
      about: 'The turnaround behind "Blue Moon" and countless standards.',
      text: 'I | vi | ii | V7',
      level: 1, song: { title: 'Blue Moon', artist: 'Rodgers & Hart' },
      keys: { guitar: 'C', ukulele: 'C', piano: 'C' } },
    { id: 'circle', group: 'Jazz', name: 'Circle of fifths: vi–ii–V–I',
      about: 'Each chord falls a fifth to the next, the engine of many jazz standards and ballads.',
      text: 'vi7 | ii7 | V7 | Imaj7',
      level: 2, song: { title: 'Fly Me to the Moon', artist: 'Frank Sinatra' },
      keys: { guitar: 'C', ukulele: 'F', piano: 'C' } },

    // Classical & lessons
    { id: 'cadence', group: 'Classical & lessons', name: 'Cadence drill: I–IV–I–V7–I',
      about: 'The classic piano-lesson exercise, played in every key. On piano it uses inversions so the hand barely moves: I – IV⁶₄ – I – V⁶₅ – I (in C: C-E-G, C-F-A, C-E-G, B-F-G, C-E-G).',
      text: 'I | IV | I | V7 | I',
      level: 0, song: { title: 'Examples', search: 'I IV I V7 I cadence piano lesson' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },

    { id: 'cadenceV', group: 'Classical & lessons', name: 'Cadence drill with V: I–IV–I–V–I',
      about: 'The same cadence with a plain V chord. On piano: I – IV⁶₄ – I – V⁶ – I (in C: C-E-G, C-F-A, C-E-G, B-D-G, C-E-G).',
      text: 'I | IV | I | V | I',
      level: 0, song: { title: 'Examples', search: 'I IV I V I cadence piano lesson' },
      keys: { guitar: 'G', ukulele: 'C', piano: 'C' } },
    { id: 'minorCadence', group: 'Classical & lessons', name: 'Minor cadence drill: i–iv–i–V7–i',
      about: 'The cadence in a minor key, with a major V7 from the harmonic minor (in A minor: Am, Dm, Am, E7, Am).',
      text: 'i | iv | i | V7 | i',
      level: 0, song: { title: 'Examples', search: 'minor cadence i iv V7 i piano lesson' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Am' } },
    { id: 'minorCadenceV', group: 'Classical & lessons', name: 'Minor cadence drill with V: i–iv–i–V–i',
      about: 'The minor cadence with a plain (major) V chord (in A minor: Am, Dm, Am, E, Am).',
      text: 'i | iv | i | V | i',
      level: 0, song: { title: 'Examples', search: 'minor cadence i iv V i piano lesson' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Am' } },    { id: 'canon', group: 'Classical & lessons', name: 'Canon: I–V–vi–iii–IV–I–IV–V',
      about: "Pachelbel's Canon, and many songs borrowed from it.",
      text: 'I | V | vi | iii | IV | I | IV | V',
      level: 1, song: { title: 'Canon in D', artist: 'Johann Pachelbel' },
      keys: { guitar: 'D', ukulele: 'C', piano: 'D' } },
    { id: 'andalusian', group: 'Classical & lessons', name: 'Andalusian (minor): i–♭VII–♭VI–V',
      about: 'A descending flamenco progression ("Hit the Road Jack", "Stray Cat Strut").',
      text: 'i | bVII | bVI | V',
      level: 0, song: { title: 'Hit the Road Jack', artist: 'Ray Charles' },
      keys: { guitar: 'Am', ukulele: 'Am', piano: 'Am' } },
  ];

  // "Am" -> { root, minor: true }
  function parseKey(text) {
    const minor = text.endsWith('m');
    const root = Theory.parseNote(minor ? text.slice(0, -1) : text);
    return root ? { root, minor } : null;
  }

  // Shift a chord by semitones (used to transpose progressions written with chord names).
  function transposeChord(chord, semis) {
    if (!semis) return chord;
    const shift = pc => Theory.rootByPc(pc + semis + 12);
    return Theory.buildChord(shift(chord.root.pc), chord.type, chord.bass === null ? null : shift(chord.bass));
  }

  // Returns { bars: [[chord, ...], ...], errors: [token, ...], usesNumerals, usesNames }.
  function parse(text, key, transpose = 0) {
    const bars = [];
    const errors = [];
    let usesNumerals = false, usesNames = false;
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const barTexts = cleaned.includes('|')
      ? cleaned.split('|').map(s => s.trim()).filter(Boolean)
      : cleaned.split(' ').filter(Boolean);
    for (const barText of barTexts) {
      if (barText === '%') {
        if (bars.length) bars.push([...bars[bars.length - 1]]);
        continue;
      }
      const chords = [];
      for (const token of barText.split(' ')) {
        // Chord names start with A-G; roman numerals never do, so there's no ambiguity.
        let chord = null;
        if (/^[A-G]/.test(token)) {
          chord = Theory.parseChord(token);
          if (chord) { chord = transposeChord(chord, transpose); usesNames = true; }
        } else {
          chord = Theory.parseRoman(token, key);
          if (chord) usesNumerals = true;
        }
        if (chord) chords.push(chord);
        else errors.push(token);
      }
      if (chords.length) bars.push(chords);
    }
    return { bars, errors, usesNumerals, usesNames };
  }

  // Flatten bars into timed events: { chord, bar, beat (start), beats (length), first (new chord) }.
  function events(bars, beatsPerBar) {
    const out = [];
    bars.forEach((bar, b) => {
      const each = beatsPerBar / bar.length;
      bar.forEach((chord, i) => {
        const prev = out[out.length - 1];
        out.push({ chord, bar: b, beat: b * beatsPerBar + i * each, beats: each, change: !prev || prev.chord.key !== chord.key });
      });
    });
    return out;
  }

  return { GROUPS, PRESETS, parseKey, parse, events, transposeChord };
})();

if (typeof module !== 'undefined') module.exports = Progressions;
