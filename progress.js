'use strict';

// Practice history: per chord (for the chord drill) and per chord change (for play-along), and
// the "smart" choice of which chord to drill next.
//
// A chord's level comes from its last 10 attempts: how often it was right and the median time of
// the correct ones. "Mastered" needs at least three of those played without the diagram showing,
// so it means you know the shape from memory. The picker weights each chord by how much it needs
// practice: wrong answers and slow times raise the weight, mastered chords drop low, chords not
// seen for a while come back, and new chords are introduced a few at a time.

const Progress = (() => {
  const KEEP = 20;          // attempts stored per chord or change
  const WINDOW = 10;        // attempts used to judge a chord
  const MAX_TIME = 30;      // seconds; longer times (walked away?) are capped
  const WORKING_SET = 5;    // chords being learned before new ones are held back
  const LEVELS = ['New', 'Learning', 'Getting there', 'Good', 'Mastered'];

  const median = xs => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  function summarize(results, goal) {
    const recent = results.slice(-WINDOW);
    const tries = recent.length;
    const correct = recent.filter(r => r.ok).length;
    const acc = tries ? correct / tries : 0;
    const clean = recent.filter(r => r.ok && !r.hint).map(r => r.t);
    const time = median(clean.length >= 3 ? clean : recent.filter(r => r.ok).map(r => r.t));
    let level = 0;
    if (tries) {
      if (tries >= 5 && acc >= 0.9 && time !== null && time <= goal && clean.length >= 3) level = 4;
      else if (tries >= 3 && acc >= 0.8 && time !== null && time <= goal * 1.5) level = 3;
      else if (acc >= 0.6) level = 2;
      else level = 1;
    }
    const lastAt = results.length ? results[results.length - 1].at : null;
    return { tries, correct, acc, time, level, lastAt, clean: clean.length };
  }

  // One store per instrument + tuning, since the same chord is a different shape in another tuning.
  function create(storageKey) {
    let data = { chords: {}, changes: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && saved.chords) data = { changes: {}, ...saved };
    } catch { /* storage unavailable: progress lasts for this session only */ }

    const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch { } };

    function push(map, key, result) {
      const entry = map[key] ??= { results: [] };
      entry.results.push({
        ok: !!result.ok,
        t: result.ok ? Math.round(Math.min(result.time, MAX_TIME) * 100) / 100 : null,
        hint: !!result.hint,
        at: Date.now(),
      });
      if (entry.results.length > KEEP) entry.results.splice(0, entry.results.length - KEEP);
      save();
    }

    // result: { ok, time (seconds, when ok), hint (diagram was showing) }
    const record = (chord, result) => push(data.chords, chord.key, result);
    // A change from one chord to the next during play-along: "from>to" with chord keys.
    const recordChange = (from, to, result) => push(data.changes, `${from.key}>${to.key}`, result);

    const statsFor = (key, goal) => summarize(data.chords[key]?.results ?? [], goal);

    function weight(s, goal, now) {
      const staleDays = s.lastAt ? (now - s.lastAt) / 86400000 : 0;
      const review = Math.min(1.5, staleDays * 0.5);
      if (s.level === 4) return 0.3 + review;
      const slow = s.time === null ? 1 : Math.min(2, Math.max(0, (s.time - goal) / goal));
      return 1 + 4 * (1 - s.acc) + 1.5 * slow + review;
    }

    // chords: candidate chord objects; recent: keys of the last few chords asked, newest last.
    function pick(chords, recent, goal, smart) {
      if (!smart) {
        const pool = chords.length > 1 ? chords.filter(c => c.key !== recent[recent.length - 1]) : chords;
        return pool[Math.floor(Math.random() * pool.length)];
      }
      const now = Date.now();
      const stats = chords.map(c => statsFor(c.key, goal));
      const learning = stats.filter(s => s.tries && s.level < 3).length;
      const newWeight = learning >= WORKING_SET ? 0.3 : 3;
      const weights = chords.map((c, i) => {
        let w = stats[i].tries ? weight(stats[i], goal, now) : newWeight;
        if (chords.length > 1 && c.key === recent[recent.length - 1]) w = 0;
        else if (recent.includes(c.key)) w *= 0.2;
        return w;
      });
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < chords.length; i++) {
        r -= weights[i];
        if (r < 0) return chords[i];
      }
      return chords[chords.length - 1];
    }

    // Chord changes, slowest first: [{ from, to, tries, correct, time }]
    function changes() {
      return Object.entries(data.changes).map(([key, e]) => {
        const [from, to] = key.split('>');
        const recent = e.results.slice(-WINDOW);
        return {
          from, to,
          tries: recent.length,
          correct: recent.filter(r => r.ok).length,
          time: median(recent.filter(r => r.ok).map(r => r.t)),
          lastAt: e.results[e.results.length - 1].at,
        };
      }).sort((a, b) => (b.time ?? 99) - (a.time ?? 99));
    }

    function reset() {
      data = { chords: {}, changes: {} };
      save();
    }

    return { record, recordChange, statsFor, pick, changes, reset };
  }

  return { create, LEVELS };
})();

if (typeof module !== 'undefined') module.exports = Progress;
