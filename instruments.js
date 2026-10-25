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
      { id: 'gceaHigh', name: 'Standard, high G (G C E A)', strings: [67, 60, 64, 69] },
      { id: 'gceaLow', name: 'Low G (G C E A)', strings: [55, 60, 64, 69] },
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
    { name: 'First chords', chords: ['C', 'Am', 'F', 'G'] },
    { name: 'Next chords', chords: ['G7', 'C7', 'Dm', 'Em', 'A', 'D', 'E7', 'A7'] },
    { name: 'More chords', chords: ['B♭', 'Gm', 'Fmaj7', 'Cmaj7', 'Am7', 'Dm7', 'E', 'Bm'] },
  ],
};

// Keys for the "chords in a key" sets: the keys most songs on each instrument are played in.
const PRACTICE_KEYS = {
  guitar: ['G', 'C', 'D', 'A', 'E', 'Am', 'Em'],
  ukulele: ['C', 'G', 'F', 'D', 'A', 'Am'],
};

if (typeof module !== 'undefined') module.exports = { INSTRUMENTS, CHORD_SETS, PRACTICE_KEYS };
