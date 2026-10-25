'use strict';

// SVG drawings: the chord box (the vertical chart from songbooks) and the horizontal fretboard.
// Colors come from CSS classes so the page theme controls them.

const Diagram = (() => {
  const svg = (w, h, body, cls) =>
    `<svg class="${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${body}</svg>`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // shape: from Voicings.generate. strings: open MIDI notes. heard: Set of pitch classes being heard.
  // opts: { leftHanded, names: note name per string, scale }
  function chordBox(shape, strings, opts = {}) {
    const n = strings.length;
    const scale = opts.scale ?? 1;
    const gap = 26 * scale, fretH = 30 * scale, top = 46 * scale, left = 22 * scale;
    const rows = Math.max(4, shape.maxFret - Math.max(1, shape.minFret) + 1);
    const startFret = shape.maxFret <= 5 ? 1 : shape.minFret;
    const w = left * 2 + gap * (n - 1) + (startFret > 1 ? 24 : 8) * scale; // room for the "5fr" label
    const h = top + fretH * rows + 26 * scale;
    const x = i => left + gap * (opts.leftHanded ? n - 1 - i : i);
    const y = f => top + fretH * (f - startFret) + fretH / 2;
    const heard = opts.heard ?? new Set();
    let out = '';

    // Frets and strings.
    for (let r = 0; r <= rows; r++) {
      const yy = top + fretH * r;
      const nut = r === 0 && startFret === 1;
      out += `<line class="${nut ? 'nut' : 'fret'}" x1="${x(0)}" x2="${x(n - 1)}" y1="${yy}" y2="${yy}" stroke-width="${nut ? 5 * scale : 1.5}"/>`;
    }
    for (let i = 0; i < n; i++) out += `<line class="string" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${top + fretH * rows}"/>`;
    if (startFret > 1) {
      out += `<text class="pos" x="${Math.max(x(0), x(n - 1)) + 10 * scale}" y="${top + fretH / 2 + 5 * scale}" font-size="${13 * scale}">${startFret}fr</text>`;
    }

    // Open / muted markers above the nut.
    shape.frets.forEach((f, i) => {
      if (f === 0) {
        const cls = heard.has(strings[i] % 12) ? 'open heard' : 'open';
        out += `<circle class="${cls}" cx="${x(i)}" cy="${top - 14 * scale}" r="${7 * scale}" fill="none" stroke-width="2"/>`;
      } else if (f < 0) {
        const s = 6 * scale, cy = top - 14 * scale;
        out += `<path class="muted" d="M${x(i) - s},${cy - s}L${x(i) + s},${cy + s}M${x(i) + s},${cy - s}L${x(i) - s},${cy + s}" stroke-width="2"/>`;
      }
    });

    // Barre.
    if (shape.barre) {
      const b = shape.barre;
      const x1 = Math.min(x(b.from), x(b.to)), x2 = Math.max(x(b.from), x(b.to));
      out += `<rect class="dot" x="${x1 - 10 * scale}" y="${y(b.fret) - 10 * scale}" width="${x2 - x1 + 20 * scale}" height="${20 * scale}" rx="${10 * scale}"/>`;
    }

    // Finger dots.
    shape.frets.forEach((f, i) => {
      if (f <= 0) return;
      const onBarre = shape.barre && f === shape.barre.fret && i >= shape.barre.from && i <= shape.barre.to;
      const cls = heard.has((strings[i] + f) % 12) ? 'dot heard' : 'dot';
      if (!onBarre || i === shape.barre.from || i === shape.barre.to) {
        out += `<circle class="${cls}" cx="${x(i)}" cy="${y(f)}" r="${10 * scale}"/>`;
      }
      if (shape.fingers[i] && (!onBarre || i === shape.barre.from)) {
        out += `<text class="finger" x="${x(i)}" y="${y(f) + 4.5 * scale}" font-size="${13 * scale}" text-anchor="middle">${shape.fingers[i]}</text>`;
      }
    });

    // Note names under the strings.
    if (opts.names) {
      opts.names.forEach((name, i) => {
        if (!name) return;
        out += `<text class="note-name" x="${x(i)}" y="${h - 8 * scale}" font-size="${11 * scale}" text-anchor="middle">${esc(name)}</text>`;
      });
    }
    return svg(Math.round(w), Math.round(h), out, 'chord-box');
  }

  // Horizontal neck. The highest string is drawn at the top, as in tab.
  // opts: { frets, shape, heard (pitch classes), leftHanded, chordPcs }
  function fretboard(strings, opts) {
    const n = strings.length, frets = opts.frets;
    const W = 1100, nutX = 62, padR = 14, stringGap = 24, top = 18;
    const openX = nutX - 20; // open-string markers sit just before the nut, clear of the string names
    const H = top * 2 + stringGap * (n - 1) + 16;
    // Frets get narrower up the neck, like a real guitar (but less extreme so high frets stay usable).
    const pos = [0];
    let wsum = 0;
    const widths = [];
    for (let f = 1; f <= frets; f++) { const w = Math.pow(0.97, f); widths.push(w); wsum += w; }
    for (let f = 1; f <= frets; f++) pos.push(pos[f - 1] + widths[f - 1] / wsum * (W - nutX - padR));
    const fx = f => {
      const x = nutX + pos[f];
      return opts.leftHanded ? W - x : x;
    };
    const mid = f => (f === 0 ? (opts.leftHanded ? W - openX : openX) : (fx(f - 1) + fx(f)) / 2);
    const sy = i => top + stringGap * (n - 1 - i);
    const heard = opts.heard ?? new Set();
    let out = `<rect class="neck" x="${Math.min(fx(0), fx(frets))}" y="${top - 10}" width="${Math.abs(fx(frets) - fx(0))}" height="${stringGap * (n - 1) + 20}" rx="3"/>`;

    // Inlay dots.
    for (const f of [3, 5, 7, 9, 12, 15]) {
      if (f > frets) continue;
      const cy = top + stringGap * (n - 1) / 2;
      if (f === 12) {
        out += `<circle class="inlay" cx="${mid(f)}" cy="${cy - stringGap}" r="5"/><circle class="inlay" cx="${mid(f)}" cy="${cy + stringGap}" r="5"/>`;
      } else out += `<circle class="inlay" cx="${mid(f)}" cy="${cy}" r="5"/>`;
    }
    for (let f = 0; f <= frets; f++) {
      out += `<line class="${f === 0 ? 'nut' : 'fret'}" x1="${fx(f)}" x2="${fx(f)}" y1="${top - 10}" y2="${top + stringGap * (n - 1) + 10}" stroke-width="${f === 0 ? 6 : 2}"/>`;
      if ([3, 5, 7, 9, 12, 15].includes(f)) out += `<text class="fret-num" x="${mid(f)}" y="${H - 2}" text-anchor="middle" font-size="11">${f}</text>`;
    }
    for (let i = 0; i < n; i++) {
      out += `<line class="string" x1="${fx(0)}" x2="${fx(frets)}" y1="${sy(i)}" y2="${sy(i)}" stroke-width="${1 + (n - 1 - i) * 0.0 + (strings[i] < 50 ? 1.2 : strings[i] < 57 ? 0.7 : 0.3)}"/>`;
      out += `<text class="string-name" x="${opts.leftHanded ? W - 12 : 12}" y="${sy(i) + 4}" font-size="12" text-anchor="middle">${esc(Theory.PC_NAMES[strings[i] % 12])}</text>`;
    }

    // Clickable cells (for playing without an instrument).
    for (let i = 0; i < n; i++) {
      for (let f = 0; f <= frets; f++) {
        const x1 = f === 0 ? (opts.leftHanded ? W - nutX : 26) : Math.min(fx(f - 1), fx(f));
        const w = f === 0 ? nutX - 26 : Math.abs(fx(f) - fx(f - 1));
        out += `<rect class="hit" data-string="${i}" data-fret="${f}" x="${x1}" y="${sy(i) - stringGap / 2}" width="${w}" height="${stringGap}"/>`;
      }
    }

    // The target shape, and notes clicked or heard.
    if (opts.shape) {
      opts.shape.frets.forEach((f, i) => {
        if (f < 0) {
          out += `<text class="muted-mark" x="${mid(0)}" y="${sy(i) + 5}" font-size="14" text-anchor="middle">✕</text>`;
          return;
        }
        const pc = (strings[i] + f) % 12;
        const cls = 'target' + (heard.has(pc) ? ' heard' : '');
        out += `<circle class="${cls}" cx="${mid(f)}" cy="${sy(i)}" r="9"/>`;
        if (opts.shape.fingers[i]) out += `<text class="finger" x="${mid(f)}" y="${sy(i) + 4}" font-size="11" text-anchor="middle">${opts.shape.fingers[i]}</text>`;
      });
    }
    for (const { string, fret } of opts.clicked ?? []) {
      out += `<circle class="clicked" cx="${mid(fret)}" cy="${sy(string)}" r="6"/>`;
    }
    return svg(W, H, out, 'fretboard');
  }

  return { chordBox, fretboard };
})();
