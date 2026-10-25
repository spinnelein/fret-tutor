'use strict';

// Instruments and tunings. Strings are listed in physical order, from the string nearest your
// face when playing (low E on guitar, the G string on ukulele) to the one nearest the floor.
// Each string is the MIDI note of the open string.

const INSTRUMENTS = [
  {
    id: 'guitar',
    name: 'Guitar',
    frets: 15,
    bassMatters: true,    // chords are voiced with the root (or slash note) as the lowest note
    staffTranspose: 12,   // guitar music is written an octave above how it sounds
    tunings: [
      { id: 'standard', name: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] },
      { id: 'dropD', name: 'Drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64] },
      { id: 'halfDown', name: 'Half-step down (E♭ A♭ D♭ G♭ B♭ E♭)', strings: [39, 44, 49, 54, 58, 63] },
      { id: 'dadgad', name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] },
      { id: 'openG', name: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62] },
      { id: 'openD', name: 'Open D (D A D F♯ A D)', strings: [38, 45, 50, 54, 57, 62] },
    ],
  },
  {
    id: 'ukulele',
    name: 'Ukulele',
    frets: 12,
    bassMatters: false,   // re-entrant tuning: the "lowest" string is often not the lowest note
    staffTranspose: 0,
    tunings: [
      // standard: shapes every chart teaches, shown first even where another scores as "easier".
      { id: 'gceaHigh', name: 'Standard, high G (G C E A)', strings: [67, 60, 64, 69], standard: { Em: '0,4,3,2', D7: '2,2,2,3' } },
      { id: 'gceaLow', name: 'Low G (G C E A)', strings: [55, 60, 64, 69], standard: { Em: '0,4,3,2', D7: '2,2,2,3' } },
      { id: 'baritone', name: 'Baritone (D G B E)', strings: [50, 55, 59, 64] },
    ],
  },
];

// Ready-made sets of chords to drill, as chord symbols, by instrument.
const CHORD_SETS = {
  guitar: [
    { name: 'First open chords', chords: ['E', 'A', 'D', 'Em', 'Am', 'G', 'C', 'Dm'] },
    { name: 'Open 7th chords', chords: ['A7', 'B7', 'C7', 'D7', 'E7', 'G7'] },
    { name: 'More open chords', chords: ['Cmaj7', 'Fmaj7', 'Am7', 'Em7', 'Dm7', 'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4'] },
    { name: 'Barre chords', chords: ['F', 'Bm', 'B♭', 'F♯m', 'Cm', 'G♯m', 'B', 'C♯m'] },
    { name: 'Power chords', chords: ['E5', 'F5', 'G5', 'A5', 'B♭5', 'C5', 'D5'] },
  ],
  ukulele: [
    // Each step adds only new chords; the steps combine. Follows how ukulele is usually taught:
    // C, Am, F, G first, then the rest of the key of C, then the other common keys (C-A-G-F-D),
    // leaving the first barre chord (B♭) and the hard E for later.
    { name: '1. First four: C, Am, F, G', chords: ['C', 'Am', 'F', 'G'] },
    { name: '2. Add C7, G7, Dm', chords: ['C7', 'G7', 'Dm'] },
    { name: '3. Key of G: D, Em, D7', chords: ['D', 'Em', 'D7'] },
    { name: '4. Keys of D and A', chords: ['A', 'A7', 'E7', 'Bm', 'F♯m'] },
    { name: '5. Key of F: B♭ (first barre), Gm', chords: ['B♭', 'Gm'] },
    { name: '6. Easy colour chords', chords: ['Am7', 'Cmaj7', 'Fmaj7', 'Dm7', 'Em7'] },
    { name: '7. The tricky ones', chords: ['E', 'B', 'E♭', 'Fm'] },
  ],
};

// Keys for the "chords in a key" sets: the keys most songs on each instrument are played in.
const PRACTICE_KEYS = {
  guitar: ['G', 'C', 'D', 'A', 'E', 'Am', 'Em'],
  ukulele: ['C', 'G', 'F', 'D', 'A', 'Am'],
};

if (typeof module !== 'undefined') module.exports = { INSTRUMENTS, CHORD_SETS, PRACTICE_KEYS };
