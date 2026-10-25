# Fret Tutor

A chord trainer for guitar and ukulele that runs in the browser. It shows a chord, you strum it,
and it listens through your microphone (or a MIDI guitar or keyboard). It works out comfortable
chord shapes for your instrument and tuning, tracks which chords and chord changes you're slow
on, and walks you through progressions like the 12-bar blues.

**Use it online:** https://spinnelein.github.io/fret-tutor/ — or open `index.html` in **Chrome or Edge**.
Allow microphone access; the first time, stay quiet for 2 seconds while it measures your room's noise.

Your progress is saved in your own browser; nothing is sent anywhere.

Licensed under the [MIT License](LICENSE). Sister project for piano and accordion:
[Chord Tutor](https://spinnelein.github.io/chord-tutor/).

## Modes

- **Chords:** one chord at a time, with a chord diagram (finger numbers, open and muted strings),
  alternative shapes, optional tab and notation, and a fretboard. Pick chords from the grid or
  use a ready-made set ("First open chords", "Barre chords", ...). Weak and slow chords come up
  more often. A chord counts as *mastered* only once you've played it quickly from memory, with
  the diagram hidden.
- **Play along:** choose a progression (12-bar blues, pop I–V–vi–IV, 50s, canon, ii–V–I, and
  more) in any key, or type your own (`| G | C D | Em | % |` or `I IV V7`) and save it.
  - *Wait for me* moves on when you play each chord and times every change.
  - *Keep the beat* changes chords in time with an optional click and count-in, and marks each
    change on time, late or missed.
- **Chord changes:** see your slowest changes and run the classic *one-minute changes* drill:
  switch between two chords as many times as you can in a minute and try to beat your best.
- **Tuner:** a precise tuner for the current tuning, with automatic string detection.

## Instruments and tunings

Guitar: standard, drop D, half-step down, DADGAD, open G, open D. Ukulele: GCEA (high or low G)
and baritone. Custom tunings with any number of strings from 3 to 8 can be added from the tuning
menu. Chord shapes are generated for the chosen tuning, so the available chords change with it.

## Files

| File | What it does |
|---|---|
| `theory.js` | Chords, spelling, chord-symbol and roman-numeral parsing |
| `instruments.js` | Instruments, tunings and starter chord sets |
| `voicings.js` | Finds and ranks playable chord shapes and fingerings |
| `diagram.js` | Chord box and fretboard drawings (SVG) |
| `progressions.js` | Preset progressions and the progression parser |
| `progress.js` | Practice history for chords and chord changes, and the smart chord order |
| `audio.js` | Microphone chord detection and the tuner's pitch detection |
| `app.js` | The page: modes, input, play-along engine |
| `lib/vexflow.js` | [VexFlow](https://www.vexflow.com) 4.2.2 for notation and tab (MIT license) |
