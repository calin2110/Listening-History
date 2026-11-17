"use strict";
// Lyrics Arena: a roguelike draft for "Guess the lyrics". Full rules: the 📜 Rules button in the game,
// or docs/lyrics-arena.md. Each drafter builds a deck of songs for the other person, one pick per themed
// pack, floor by floor (Easy → Medium → Hard → Impossible), with refreshes, events and power-ups. With
// every pick the drafter also chooses the lyric lines the guesser gets. At the end each deck becomes a
// lyric sheet to write on paper; playing on screen (the presenter shows the lines, the guesser names the
// song, every extra line costs a star) is optional. The song pool (English lyrics only) comes from /api/arena.
// Uses helpers from app.js, fun.js and more.js (esc, enc, cover, pname, getJSON, toast, audibleStart …).

const AR_KEY = "music-stats-arena-v1", AR_HOF = "music-stats-arena-hof";
const AR_TIERS = [
  {id: "easy", name: "Easy", emoji: "🌱", points: 1, start: 2},
  {id: "medium", name: "Medium", emoji: "🔥", points: 2, start: 2},
  {id: "hard", name: "Hard", emoji: "💀", points: 3, start: 1},
  {id: "impossible", name: "Impossible", emoji: "👹", points: 4, start: 1},
];
const AR_RARITY = [
  {id: "common", name: "Common", bonus: 0},
  {id: "rare", name: "Rare", bonus: 1},
  {id: "epic", name: "Epic", bonus: 2},
  {id: "legendary", name: "Legendary", bonus: 3},
];
const AR_PACK_SIZE = [3, 3, 4, 4];                 // songs in a pack, by the pack's rarity (Wildcard: 5)
const AR_FAMILY_WEIGHT = [1, 0.85, 0.6, 0.35];     // how often a pack of each rarity comes up
const AR_MAX_PENALTY = 6;                          // hints + wrong guesses before a song is lost
const AR_EVENT_CHANCE = {chest: 0.03, mystery: 0.03, trader: 0.02};   // per pick, at most one between two treasures
const AR_TREASURES = 4;                            // treasure after each fifth of the draft (the last fifth has none)
const AR_ARTIST_CAP = 3;                           // songs per artist in one deck
// Every song is one you both played 3+ times (the server sees to that). On the easier floors the drafter, who
// presents it and sings along, should know it well too: how likely a song is by the drafter's plays
// (3–9, 10–29, 30+), per floor.
const AR_DRAFTER_KNOWS = [[0.4, 0.8, 1], [0.6, 0.9, 1], [0.8, 1, 1], [1, 1, 1]];
const arDrafterKnows = s => AR_DRAFTER_KNOWS[s.tier][s.p[0] >= 30 ? 2 : s.p[0] >= 10 ? 1 : 0];
const AR_YEARLY = new Set(["year_g", "year_d", "release", "decade"]);

// Power-ups go into your hand and are used when you click them. Draft ones act on the pack in front of you;
// guessing ones are for the game, on paper or on screen (in a duel the drafter keeps them for their own turns
// as guesser, with one deck they're for the guesser).
const AR_POWERUPS = {
  // for the draft
  refresh2: {emoji: "🔄", name: "Second wind", when: "draft", text: "+2 refreshes."},
  wide: {emoji: "🃏", name: "Wide pack", when: "draft", text: "Two more songs in this pack (up to 5)."},
  cherry: {emoji: "🍒", name: "Cherry-pick", when: "draft", text: "Swap this pack for a theme you choose, from three."},
  timemachine: {emoji: "⏳", name: "Time machine", when: "draft", text: "Swap this pack for a release year you choose."},
  twofer: {emoji: "👯", name: "Two for one", when: "draft", text: "Take two songs from this pack."},
  lucky: {emoji: "🍀", name: "Lucky charm", when: "draft", text: "Epic and legendary packs come up twice as often for the rest of the draft."},
  mulligan: {emoji: "♻️", name: "Mulligan", when: "draft", text: "Throw one song out of your deck and draft a new one for its floor."},
  scout: {emoji: "🔭", name: "Spyglass", when: "draft", text: "See which floor this pack is for."},
  compass: {emoji: "🧭", name: "Compass", when: "draft", text: "Choose the floor of this pick: the pack is swapped for one from that floor."},
  gem: {emoji: "💎", name: "Polished gem", when: "draft", text: "Swap this pack for an Epic or Legendary one."},
  // for guessing
  artist: {emoji: "🎤", name: "Who sings?", when: "play", text: "Reveal the artist."},
  year: {emoji: "📅", name: "Calendar", when: "play", text: "Reveal the release year."},
  album: {emoji: "💿", name: "Liner notes", when: "play", text: "Reveal the album."},
  initials: {emoji: "🔤", name: "Initials", when: "play", text: "Reveal the first letter of every word in the title."},
  chorus: {emoji: "🎶", name: "Chorus", when: "play", text: "Hear the chorus line, for free."},
  hum: {emoji: "🎵", name: "Hum it", when: "play", text: "3 seconds of the song (on paper: the presenter hums it)."},
  fifty: {emoji: "⚖️", name: "Fifty-fifty", when: "play", text: "Two titles, one of them right. Picking the wrong one is a wrong guess."},
  shield: {emoji: "🛡️", name: "Shield", when: "play", text: "The next wrong guess costs nothing."},
  rewind: {emoji: "🩹", name: "Second chance", when: "play", text: "Take back one hint or wrong guess."},
  double: {emoji: "✖️", name: "Double down", when: "play", text: "Before the first hint: double the floor points if you get it with at most one hint or wrong guess, none at all if not."},
  veto: {emoji: "🙅", name: "Veto", when: "play", text: "Send a song back: the presenter has to play another one of the same floor instead."},
};
const AR_DRAFT_ITEMS = Object.keys(AR_POWERUPS).filter(k => AR_POWERUPS[k].when === "draft");
const AR_PLAY_ITEMS = Object.keys(AR_POWERUPS).filter(k => AR_POWERUPS[k].when === "play");

// a blessing to start with, like Neow's in Slay the Spire: three to choose from, one with a price
const AR_BLESSINGS = {
  trove: {emoji: "🎁", name: "Treasure trove", text: "Choose a draft power-up and a guessing power-up, from three each."},
  spare: {emoji: "🔄", name: "Spare refreshes", text: "+3 refreshes."},
  legend: {emoji: "✨", name: "Legendary opener", text: "Your first pack is the rarest one there is."},
  tricks: {emoji: "🧰", name: "Bag of tricks", text: "Two random draft power-ups."},
  helpers: {emoji: "🤝", name: "Helping hand", text: "Two random guessing power-ups."},
  sight: {emoji: "🔮", name: "Second sight", text: "Your first 10 packs show which floor they’re for."},
  gamble: {emoji: "🎰", name: "Gambler’s bargain", cost: "Lose 2 refreshes", text: "Two random draft power-ups and two random guessing power-ups."},
  born: {emoji: "🍀", name: "Born lucky", cost: "Lose 1 refresh", text: "Epic and legendary packs come up twice as often, all draft long."},
  hoard: {emoji: "👑", name: "Dragon’s hoard", cost: "No refreshes at all", text: "Three treasure picks right now: a draft and a guessing power-up each time."},
};

let ar = null;                                     // the run (saved in the browser)
const arPools = {};                                // "drafter-guesser-english" -> pool from /api/arena
const arLyrics = {};                               // track key -> {text, lang, lines}
const arSound = {audio: null, ctx: null, src: null};
let arRulesOpen = false;
let arMulliganMode = false;                        // the Mulligan was clicked: the deck shows ♻️ buttons

// ------------------------------------------------------------- helpers --
const arRand = arr => arr[Math.floor(Math.random() * arr.length)];
function arWeighted(items, weightOf) {
  const w = items.map(x => Math.max(0, weightOf(x)) || 0), total = w.reduce((a, b) => a + b, 0);
  if (!total) return items.length ? arRand(items) : undefined;
  let at = Math.random() * total;
  for (let i = 0; i < items.length; i++) { at -= w[i]; if (at <= 0) return items[i]; }
  return items[items.length - 1];
}
const arName = pid => esc(pname(pid));
const arTier = t => AR_TIERS[t];
const arRar = r => AR_RARITY[r] || AR_RARITY[0];
const arStars = n => "★".repeat(n) + "☆".repeat(3 - n);
const arPU = id => AR_POWERUPS[id];
function arSave() { try { localStorage.setItem(AR_KEY, JSON.stringify(ar)); } catch { /* no storage: the run lives in memory */ } }
function arLoad() { try { return arMigrate(JSON.parse(localStorage.getItem(AR_KEY) || "null")); } catch { return null; } }
// runs saved before the floors were shuffled and power-ups went into the hand
function arMigrate(r) {
  (r?.drafts || []).forEach(d => {
    if (!d.order) {
      d.order = [];
      for (let t = 0; t < 4; t++) {
        const n = r.setup.perTier - d.picks.filter(p => p.tier === t).length - d.pending.filter(x => x === t).length;
        for (let i = 0; i < n; i++) d.order.push(t);
      }
    }
    d.hand ??= [...(d.keep || [])];
    d.items ??= [];
    d.treasures ??= (d.floorTreasure || []).filter(Boolean).length;
    d.segEvent ??= -1;
    if (d.event?.type === "treasure" && !d.event.draft) d.event = arTreasureEvent();
  });
  return r;
}
function arHof() { try { return JSON.parse(localStorage.getItem(AR_HOF) || "[]"); } catch { return []; } }
const arBody = () => $("arena-body");
const arDraft = () => ar?.drafts?.[ar.cur];

function arPeople() {
  const ids = state.people.length >= 2 ? state.people : META.people.map((_, i) => i);
  return ids;
}

// --------------------------------------------------------------- pools --
const arPoolsLoading = {};                         // same keys: requests on their way
const arPoolKey = (d, g, english) => `${d}-${g}-${english ? 1 : 0}`;
function arFetchPool(d, g, english) {
  const key = arPoolKey(d, g, english);
  if (arPools[key]) return Promise.resolve(arPools[key]);
  return arPoolsLoading[key] ??= getJSON(`/api/arena?drafter=${d}&guesser=${g}&english=${english ? 1 : 0}`).then(p => {
    p.byKey = new Map(p.songs.map((s, i) => [s.k, i]));
    p.categories.forEach(c => {
      c.storyOf = c.stories ? new Map(c.songs.map((i, j) => [i, c.stories[j]])) : null;
    });
    const fams = new Map();
    p.categories.forEach(c => {
      if (!fams.has(c.family)) fams.set(c.family, {family: c.family, rar: c.rar, weight: c.weight, variants: []});
      const f = fams.get(c.family);
      f.rar = Math.max(f.rar, c.rar);
      f.variants.push(c);
    });
    p.families = [...fams.values()];
    p.cat = new Map(p.categories.map(c => [c.id, c]));
    arPools[key] = p;
    return p;
  }).finally(() => { delete arPoolsLoading[arPoolKey(d, g, english)]; });
}
const arPool = dr => arFetchPool(dr.drafter, dr.guesser, ar.setup.english);
const arPoolNow = dr => arPools[arPoolKey(dr.drafter, dr.guesser, ar.setup.english)];
// start loading both directions as soon as the Arena opens: by the time the draft begins they're here
function arPrefetch(a, b) {
  if (a === b) return;
  [[a, b], [b, a]].forEach(([d, g]) => arFetchPool(d, g, true).catch(() => { /* tried again when needed */ }));
}

// -------------------------------------------------------------- setup --
function arNewRun(f) {
  const a = +f.a, b = +f.b;
  const pairs = f.mode === "duel" ? [[a, b], [b, a]] : f.mode === "a2b" ? [[a, b]] : [[b, a]];
  ar = {
    v: 1, phase: "handoff", cur: 0, created: Date.now(),
    setup: {a, b, mode: f.mode, perTier: +f.perTier, refreshes: +f.refreshes, english: f.english, sing: f.sing},
    drafts: pairs.map(([d, g]) => ({
      drafter: d, guesser: g, picks: [], pending: [], refreshes: +f.refreshes, pack: null,
      event: {type: "neow", options: arNeowOptions()},
      order: arShuffledOrder(+f.perTier),          // the floor of every pick, shuffled and hidden
      fx: {lucky: false, legend: false, scout: 0}, hand: [], items: [], offered: {},
      recent: [], treasures: 0, segEvent: -1, treasureDue: false, done: false,
    })),
    play: null,
  };
  arSave();
}

function arSetupHTML() {
  const ids = arPeople(), saved = arLoad();
  if (ids.length < 2) return `<p class="muted">The Lyrics Arena needs two people’s listening histories.</p>`;
  const [a, b] = ids;
  const opt = (sel) => ids.map(p => `<option value="${p}" ${p === sel ? "selected" : ""}>${arName(p)}</option>`).join("");
  const resume = saved && saved.phase !== "done" ? `<div class="ar-resume">
      <p><b>A run is in progress</b> · ${arRunStatus(saved)}</p>
      <div class="g-actions"><button type="button" data-ar="resume">Continue the run</button>
        <button type="button" class="ghost" data-ar="abandon">Abandon it</button></div></div>` : "";
  const hof = arHof();
  return `${resume}
    <div class="ar-intro">
      <p><b>Guess the lyrics, drafted like an arena run.</b> Each of you builds a deck of songs for the other one:
        pick by pick you’re offered a themed pack of 3 to 5 songs and keep one. Four floors, from 🌱 Easy to 👹 Impossible,
        tuned to how well the <i>guesser</i> knows each song, come in a hidden random order. Start with a blessing,
        collect power-ups on the way. With every song you also choose the lyric line they’ll get.
        At the end you get a list to write on paper, or you play it on this screen: every extra line costs a star.</p>
      <p class="muted">Only songs with English lyrics, no instrumentals, and every year of your history is as likely as
        last month. Full rules: <button type="button" class="linkish" data-ar="rules">📜 Rules</button></p>
    </div>
    <form class="ar-setup" id="ar-setup">
      <fieldset><legend>Who plays?</legend>
        <p class="ar-players"><select name="a">${opt(a)}</select> and <select name="b">${opt(b)}</select></p>
        <label class="ar-radio"><input type="radio" name="mode" value="duel" checked> <b>Duel</b>: both draft a deck for the other</label>
        <label class="ar-radio"><input type="radio" name="mode" value="a2b"> One deck: <b data-ar-name="a">${arName(a)}</b> drafts,
          <b data-ar-name="b">${arName(b)}</b> guesses</label>
        <label class="ar-radio"><input type="radio" name="mode" value="b2a"> One deck: <b data-ar-name="b">${arName(b)}</b> drafts,
          <b data-ar-name="a">${arName(a)}</b> guesses</label>
      </fieldset>
      <fieldset><legend>Run</legend>
        <label>Songs per floor <select name="perTier"><option value="3">3 (12 songs, a quick one)</option>
          <option value="5">5 (20 songs)</option><option value="10" selected>10 (40 songs, the classic)</option></select></label>
        <label>Refreshes <select name="refreshes"><option>3</option><option selected>5</option><option>8</option></select></label>
        <label class="ar-check"><input type="checkbox" name="english" checked> English lyrics only</label>
        <label class="ar-check"><input type="checkbox" name="sing" checked> 🎤 Sing-it bonus (+1 for singing the next line, when you play on screen)</label>
      </fieldset>
      <div class="g-actions"><button type="submit">🏟️ Start the draft</button></div>
    </form>
    ${hof.length ? `<details class="ar-hof"><summary>🏆 Hall of fame (${hof.length})</summary><ol>${hof.slice(0, 15).map(h =>
      `<li><b>${esc(h.date)}</b> · ${h.scores.map(s => `${esc(s.name)} ${s.points}`).join(" – ")}${h.mvp ? ` · MVP: ${esc(h.mvp)}` : ""}</li>`).join("")}</ol></details>` : ""}
    <div id="ar-blocked"></div>`;
}

function arRunStatus(r) {
  if (r.phase === "play" && r.play) return `playing, song ${Math.min(r.play.turn + 1, r.play.queue.length)} of ${r.play.queue.length}`;
  if (r.phase === "sheets") return "the draft is over: the lyric sheets are ready";
  const d = r.drafts?.[r.cur];
  if (!d) return "";
  return `${esc(pname(d.drafter))} is drafting (${d.picks.length} of ${r.setup.perTier * 4} songs)`;
}

async function arRenderBlocked() {
  const box = $("ar-blocked");
  if (!box) return;
  try {
    const b = await getJSON("/api/arena/block");
    if (!b.songs.length && !b.artists.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<details class="ar-blocklist"><summary>🚫 Not for the lyrics game: ${plural(b.artists.length, "artist")}, ${plural(b.songs.length, "song")}</summary>
      <p class="muted">Marked from a pack because of the language, no lyrics, or anything else. Take one back:</p>
      <ul>${b.artists.map(a => `<li>${esc(a.title)} <button type="button" class="linkish" data-ar="unblock-artist" data-v="${esc(a.title)}">undo</button></li>`).join("")}
        ${b.songs.map(s => `<li>${esc(s.title)} <span class="muted">· ${esc(s.sub)}</span> <button type="button" class="linkish" data-ar="unblock-song" data-v="${esc(s.key)}">undo</button></li>`).join("")}</ul></details>`;
  } catch { box.innerHTML = ""; }
}

// --------------------------------------------------------------- draft --
function arTierCount(dr, t) { return dr.picks.filter(p => p.tier === t).length; }
// every floor still gets its share of songs, but in a random order you don't see: a pack's floor shows once
// you've picked from it (or with the Spyglass)
const arShuffledOrder = per => shuffle([0, 1, 2, 3].flatMap(t => Array(per).fill(t)));
function arCurrentTier(dr) {
  if (dr.pending.length) return dr.pending[0];
  return dr.order.length ? dr.order[0] : null;
}
const arIsBossPick = dr => !dr.pending.length && dr.order.length === 1;   // the very last pick

function arAvailable(dr, pool, tier) {
  const taken = new Set(dr.picks.map(p => p.k));
  const perArtist = new Map();
  dr.picks.forEach(p => perArtist.set(p.a, (perArtist.get(p.a) || 0) + 1));
  return i => {
    const s = pool.songs[i];
    return s && s.tier === tier && !s.blocked && !taken.has(s.k) && (dr.offered[s.k] || 0) < 2
      && (perArtist.get(s.a) || 0) < AR_ARTIST_CAP;
  };
}

// which packs can be offered for this floor right now: [{family, rar, weight, variants: [{cat, songs}]}]
function arOptions(dr, pool, tier, minSize = 3) {
  const ok = arAvailable(dr, pool, tier);
  return pool.families.map(f => {
    const variants = f.variants.map(c => ({cat: c, songs: c.songs.filter(ok)})).filter(v => v.songs.length >= minSize);
    return {...f, variants};
  }).filter(f => f.variants.length);
}

function arFamilyWeight(dr, f) {
  let w = f.weight * AR_FAMILY_WEIGHT[f.rar];
  if (dr.fx.lucky && f.rar >= 2) w *= 2;
  if (dr.recent.includes(f.family)) w *= 0.1;     // don't show the same kind of pack twice in a row
  return w;
}

// share of a pack's songs that the guesser didn't play in the last two months
function arOldShare(pool, songs) {
  return songs.length ? songs.filter(i => !pool.songs[i].recent).length / songs.length : 0;
}
// how well the drafter knows a theme's songs, on average (see AR_DRAFTER_KNOWS): themes they know less come up less
const arKnownShare = (pool, songs) => songs.length ? songs.reduce((a, i) => a + arDrafterKnows(pool.songs[i]), 0) / songs.length : 0;
const arFit = (pool, family, songs) => 0.2 + 0.8 * arKnownShare(pool, songs);

function arPickVariant(f, pool) {
  if (!AR_YEARLY.has(f.family)) {
    return arWeighted(f.variants, v => (0.2 + arOldShare(pool, v.songs)) * arFit(pool, f.family, v.songs));
  }
  // older years come up more: the whole point is to get away from what you played last month
  const newest = Math.max(...f.variants.map(v => v.cat.year || 0));
  return arWeighted(f.variants, v => (1 + Math.max(0, newest - (v.cat.year || newest)) / 2) * arFit(pool, f.family, v.songs));
}

// era-balanced: pick a year first (every year equally likely), then a song from that year. The years are
// the guesser's: the year they played the song most. On the easier floors, songs the drafter knows less count less.
function arPickSongs(pool, v, size) {
  const rank = new Map(v.cat.songs.map((i, n) => [i, n]));
  const left = v.songs.slice(), out = [], artists = new Set();
  const sameArtist = v.cat.same_artist;
  const heard = j => arDrafterKnows(pool.songs[j]);
  while (out.length < size && left.length) {
    let usable = sameArtist ? left : left.filter(i => !artists.has(pool.songs[i].a));
    if (!usable.length && out.length < 3) usable = left;   // rather two songs by one band than a two-song pack
    if (!usable.length) break;
    const eras = new Map();                         // year -> its best "heard" weight
    usable.forEach(i => eras.set(pool.songs[i].era, Math.max(eras.get(pool.songs[i].era) || 0, heard(i))));
    const era = arWeighted([...eras.keys()], y => eras.get(y));
    const inEra = usable.filter(i => pool.songs[i].era === era);
    const i = arWeighted(inEra, j => (1 / (1 + (rank.get(j) || 0) / 15)) * (pool.songs[j].recent ? 0.25 : 1)
      * (pool.songs[j].rar >= 1 ? 1.3 : 1) * heard(j));
    out.push(i);
    artists.add(pool.songs[i].a);
    left.splice(left.indexOf(i), 1);
  }
  return out;
}

function arMakePack(dr, pool, tier, f, v, opts = {}) {
  const size = f.family === "wildcard" ? 5 : AR_PACK_SIZE[f.rar];
  const songs = arPickSongs(pool, v, size);
  songs.forEach(i => { const k = pool.songs[i].k; dr.offered[k] = (dr.offered[k] || 0) + 1; });
  dr.recent = [f.family, ...dr.recent].slice(0, 3);
  let scouted = !!opts.scouted;
  if (dr.fx.scout > 0) { scouted = true; dr.fx.scout--; }   // Second sight
  return {id: Math.random().toString(36).slice(2, 10), family: f.family, cat: v.cat.id, name: v.cat.name, emoji: v.cat.emoji,
          desc: v.cat.desc, rar: f.rar, songs: songs.map(i => pool.songs[i].k), size: songs.length, take: 1, taken: 0, tier,
          boss: !!opts.boss, scouted};
}

// opts.minRar: only packs of this rarity or better (Polished gem), falling back to anything rarer than common
function arBuildPack(dr, pool, tier, opts = {}) {
  const boss = arIsBossPick(dr);
  let fams = arOptions(dr, pool, tier);
  if (boss) {
    const strong = fams.filter(f => f.rar >= 2);
    if (strong.length) fams = strong;              // the boss pack is epic or legendary when it can be
  }
  if (dr.fx.legend && fams.length) {               // Legendary opener: the rarest pack there is
    dr.fx.legend = false;
    const top = Math.max(...fams.map(f => f.rar));
    fams = fams.filter(f => f.rar === top);
  }
  if (opts.minRar) {
    const strong = fams.filter(f => f.rar >= opts.minRar), better = fams.filter(f => f.rar >= 1);
    fams = strong.length ? strong : better.length ? better : fams;
  }
  if (!fams.length) fams = arOptions(dr, pool, tier, 1);
  if (!fams.length) return null;
  // themes made mostly of songs the guesser plays lately, or that the drafter knows less, come up less
  const f = arWeighted(fams, x => {
    const songs = x.variants.flatMap(v => v.songs);
    return arFamilyWeight(dr, x) * (0.3 + 0.7 * arOldShare(pool, songs)) * arFit(pool, x.family, songs);
  });
  return arMakePack(dr, pool, tier, f, arPickVariant(f, pool), {boss, scouted: opts.scouted});
}

function arPackFrom(dr, pool, tier, family, year, scouted = false) {
  const fams = arOptions(dr, pool, tier);
  const f = fams.find(x => x.family === family) || fams[0];
  if (!f) return null;
  const v = year != null ? (f.variants.find(x => x.cat.year === year) || arPickVariant(f, pool)) : arPickVariant(f, pool);
  return arMakePack(dr, pool, tier, f, v, {boss: arIsBossPick(dr), scouted});
}

// more songs for a pack: from its theme, or anything on its floor
function arFillPack(dr, pool, pk, size) {
  const ok = arAvailable(dr, pool, pk.tier), c = pool.cat.get(pk.cat);
  const have = new Set(pk.songs), want = Math.max(0, size - pk.songs.length);
  const extra = (c ? c.songs : []).filter(j => ok(j) && !have.has(pool.songs[j].k));
  const fill = extra.length >= want ? extra : pool.songs.map((_, j) => j).filter(j => ok(j) && !have.has(pool.songs[j].k));
  shuffle(fill).slice(0, want).forEach(j => {
    pk.songs.push(pool.songs[j].k);
    dr.offered[pool.songs[j].k] = (dr.offered[pool.songs[j].k] || 0) + 1;
  });
  pk.size = pk.songs.length;
}

function arCherryEvent(dr, pool, tier, boss) {
  const left = arOptions(dr, pool, tier), choice = [];
  while (choice.length < 3 && left.length) {
    const f = arWeighted(left, x => arFamilyWeight(dr, x) + 0.05);
    choice.push(f.family);
    left.splice(left.indexOf(f), 1);
  }
  return {type: "cherry", options: choice, tier, boss};
}

function arTreasureEvent(extra = {}) {
  return {type: "treasure", draft: shuffle(AR_DRAFT_ITEMS.slice()).slice(0, 3), guess: shuffle(AR_PLAY_ITEMS.slice()).slice(0, 3),
          sel: {}, ...extra};
}
function arNeowOptions() {
  const ids = Object.keys(AR_BLESSINGS);
  const free = shuffle(ids.filter(i => !AR_BLESSINGS[i].cost)).slice(0, 2), costly = arRand(ids.filter(i => AR_BLESSINGS[i].cost));
  return shuffle([...free, costly]);
}

// what comes next in a draft: a treasure, an event, a pack, or the end
function arNext(dr) {
  const pool = arPoolNow(dr);
  if (dr.event || dr.pack || dr.lyric) return;
  const tier = arCurrentTier(dr);
  if (dr.treasureDue) {
    dr.treasureDue = false;
    dr.event = arTreasureEvent();
    return;
  }
  if (tier === null) { dr.done = true; arMulliganMode = false; return; }
  dr.pack = arBuildPack(dr, pool, tier);
  if (!dr.pack && !dr.event) {                     // nothing left for this floor: skip its remaining picks
    toast(`No more songs for the ${arTier(tier).name} floor: moving on.`);
    while (arTierCount(dr, tier) < ar.setup.perTier) dr.picks.push({k: "", skipped: true, tier, t: "(no song left)", a: "", rar: 0});
    dr.order = dr.order.filter(x => x !== tier);
    dr.pending = dr.pending.filter(x => x !== tier);
    arNext(dr);
  }
}

function arStoryFor(pool, catId, i) {
  const c = pool.cat.get(catId);
  return (c?.storyOf && c.storyOf.get(i)) || pool.songs[i].story || "";
}

function arTakeSong(dr, key, how = {}) {
  const pool = arPoolNow(dr), i = pool.byKey.get(key), s = pool.songs[i];
  const pack = dr.pack;
  const tier = how.tier ?? (pack ? pack.tier : arCurrentTier(dr));
  const p = {k: s.k, t: s.t, a: s.a, al: s.al, y: s.y, tier, rar: s.rar, p: s.p, era: s.era, lang: s.lang,
             story: pack ? arStoryFor(pool, pack.cat, i) : (s.story || ""), cat: pack ? `${pack.emoji} ${pack.name}` : how.cat || "",
             boss: !!(pack && pack.boss), first: s.first, last: s.last};
  dr.picks.push(p);
  const pended = !!dr.pending.length && dr.pending[0] === tier;
  if (pended) dr.pending.shift();
  else if (dr.order.includes(tier)) dr.order.splice(dr.order.indexOf(tier), 1);
  // next: the drafter chooses the lines the guesser gets (arLyricHTML); the draft goes on after that
  dr.lyric = {k: p.k, tier, start: null, count: arTier(tier).start, pended};
  return p;
}

// the lyrics are fetched when a song is picked: say so if they turn out not to be in English, or missing
function arCheckLyrics(p, L) {
  if (L.failed) return;                            // offline: nothing to say yet
  if (L.lang === "en" || (!ar.setup.english && L.lang && L.lang !== "instrumental")) { p.lang = L.lang; p.bad = null; return; }
  p.bad = L.lang === "instrumental" ? "it’s an instrumental" : L.lang ? `the lyrics are in ${arLangName(L.lang)}` : "no lyrics were found";
}
const arLangName = l => ({de: "German", fi: "Finnish", sv: "Swedish", no: "Norwegian", nl: "Dutch", pl: "Polish", ro: "Romanian",
  es: "Spanish", fr: "French", it: "Italian", pt: "Portuguese", cs: "Czech", hu: "Hungarian", mixed: "a mix of languages",
  other: "another language"})[l] || l;

function arAfterPick(dr, tier, pended = false) {
  const pack = dr.pack;
  if (pack) {
    pack.taken++;
    if (pack.taken < pack.take && dr.order.includes(tier)) return;   // Two for one: pick again
    dr.pack = null;
  }
  if (!pended) {                                   // a treasure after every fifth of the draft
    const all = ar.setup.perTier * 4, done = all - dr.order.length;
    if (dr.treasures < AR_TREASURES && done >= Math.round(all * (dr.treasures + 1) / 5)) {
      dr.treasures++;
      dr.treasureDue = true;
    }
  }
  if (!dr.treasureDue && !dr.pending.length && dr.order.length && dr.segEvent !== dr.treasures) {
    const r = Math.random(), c = AR_EVENT_CHANCE, next = arCurrentTier(dr);
    if (r < c.chest) {
      dr.segEvent = dr.treasures;
      dr.event = arTreasureEvent({chest: true});
    } else if (r < c.chest + c.mystery) {
      const pool = arPoolNow(dr), ok = arAvailable(dr, pool, next);
      const rare = pool.songs.map((s, i) => i).filter(i => ok(i) && pool.songs[i].rar >= 1);
      if (rare.length) {
        dr.segEvent = dr.treasures;
        dr.event = {type: "mystery", key: pool.songs[arRand(rare)].k, tier: next};
      }
    } else if (r < c.chest + c.mystery + c.trader && dr.refreshes > 0) {
      dr.segEvent = dr.treasures;
      dr.event = {type: "trader", item: arRand([...AR_DRAFT_ITEMS, ...AR_PLAY_ITEMS])};
    }
  }
  arNext(dr);
}

// a power-up goes into the hand: draft ones to use in this draft, guessing ones for the game
function arGain(dr, id) { (arPU(id).when === "play" ? dr.items : dr.hand).push(id); }

function arBless(dr, id) {
  const some = (list, n) => shuffle(list.slice()).slice(0, n);
  dr.event = null;
  if (id === "trove") dr.event = arTreasureEvent({title: "🎁 Treasure trove"});
  else if (id === "spare") dr.refreshes += 3;
  else if (id === "legend") dr.fx.legend = true;
  else if (id === "tricks") some(AR_DRAFT_ITEMS, 2).forEach(x => arGain(dr, x));
  else if (id === "helpers") some(AR_PLAY_ITEMS, 2).forEach(x => arGain(dr, x));
  else if (id === "sight") dr.fx.scout = 10;
  else if (id === "gamble") {
    dr.refreshes = Math.max(0, dr.refreshes - 2);
    some(AR_DRAFT_ITEMS, 2).forEach(x => arGain(dr, x));
    some(AR_PLAY_ITEMS, 2).forEach(x => arGain(dr, x));
  } else if (id === "born") { dr.refreshes = Math.max(0, dr.refreshes - 1); dr.fx.lucky = true; }
  else if (id === "hoard") { dr.refreshes = 0; dr.hoard = 2; dr.event = arTreasureEvent({title: "👑 Dragon’s hoard (1 of 3)"}); }
}

// can this draft power-up be used right now? (the ones that change the pack need a fresh one in front of you)
function arCanUse(dr, id) {
  if (dr.lyric || dr.event || dr.done) return false;
  const pk = dr.pack, fresh = !!pk && !pk.taken, pool = arPoolNow(dr);
  const opts = () => (pool ? arOptions(dr, pool, pk.tier) : []);
  switch (id) {
    case "refresh2": return true;
    case "lucky": return !dr.fx.lucky;
    case "mulligan": return dr.picks.some(p => !p.skipped);
    case "scout": return !!pk && !pk.scouted;
    case "wide": return fresh && pk.songs.length < 5;
    case "twofer": return fresh && pk.take === 1 && !dr.pending.length && dr.order.length > 2   // the boss pick stays a pick of its own
      && dr.order.filter(t => t === pk.tier).length >= 2;
    case "cherry": return fresh && opts().length > 1;
    case "timemachine": return fresh && opts().some(f => f.family === "release");
    case "compass": return fresh && !dr.pending.length && new Set(dr.order).size > 1;
    case "gem": return fresh && opts().some(f => f.rar >= 2);
  }
  return false;
}

function arUseDraftPU(dr, pool, n) {
  const id = dr.hand[n];
  if (!id || !arCanUse(dr, id)) return;
  if (id === "mulligan") { arMulliganMode = !arMulliganMode; return; }   // used up once a song is swapped
  const pk = dr.pack;
  dr.hand.splice(n, 1);
  if (id === "refresh2") dr.refreshes += 2;
  else if (id === "lucky") dr.fx.lucky = true;
  else if (id === "scout") pk.scouted = true;
  else if (id === "twofer") pk.take = 2;
  else if (id === "wide") arFillPack(dr, pool, pk, 5);
  else if (id === "cherry") { dr.pack = null; dr.event = arCherryEvent(dr, pool, pk.tier, pk.boss); }
  else if (id === "timemachine") {
    const rel = arOptions(dr, pool, pk.tier).find(f => f.family === "release");
    dr.pack = null;
    dr.event = {type: "time", years: rel.variants.map(v => v.cat.year).sort((a, b) => a - b), tier: pk.tier, boss: pk.boss};
  } else if (id === "compass") { dr.pack = null; dr.event = {type: "compass", tiers: [...new Set(dr.order)].sort()}; }
  else if (id === "gem") {
    const np = arBuildPack(dr, pool, pk.tier, {minRar: 2, scouted: pk.scouted});
    if (np) { np.boss = pk.boss; dr.pack = np; }
  }
  arPlay(id === "gem" ? "epic" : "pick");
}

// ----------------------------------------------------------- draft UI --
// a song card: the front shows the song, the back is what you see before it's turned over (opts.down)
function arSongCard(pool, key, pack, opts = {}) {
  const i = pool.byKey.get(key), s = pool.songs[i];
  if (!s) return "";
  const r = arRar(s.rar);
  const story = arStoryFor(pool, pack.cat, i);
  const g = arName(pool.guesser), d = arName(pool.drafter), heard = s.p[1] > 0;
  // the guesser first: the draft is about what they know
  const facts = `${g} ${s.p[1]}×${heard && s.last?.[1] ? `, last ${s.last[1]}` : ""}${heard && s.era ? ` · peak ${s.era}` : ""} · ${d} ${s.p[0]}×`;
  const tags = (s.recent ? `<i title="${g} played it in the last two months">🕒 lately</i>` : "")
    + (s.lang === "en?" ? `<i title="Its lyrics haven’t been fetched yet; they get checked when you pick it">lyrics unchecked</i>` : "");
  const main = opts.static ? `div class="ar-card-main"`
    : `button type="button" class="ar-card-main" data-ar="pick" data-k="${esc(s.k)}" ${opts.picked ? "disabled" : ""}`;
  return `<div class="ar-card rar-${r.id}${opts.picked ? " picked" : ""}${opts.down ? " is-down" : ""}" data-k="${esc(s.k)}"
      data-rar="${s.rar}" style="--i:${opts.n || 0}">
    <div class="ar-card-inner">
      <div class="ar-card-front">
        <${main}>
          <span class="ar-gem">${r.name}</span>
          ${cover(s.k)}
          <span class="ar-card-title">${esc(s.t)}</span>
          <span class="ar-card-sub">${esc(s.a)}${s.y ? ` · ${s.y}` : ""}</span>
          ${story ? `<span class="ar-card-story">${esc(story)}</span>` : ""}
          <span class="ar-card-facts">${facts}</span>
          <span class="ar-card-tags">${tags}</span>
        </${opts.static ? "div" : "button"}>
        ${opts.static ? "" : `<div class="ar-card-ban">
          <button type="button" class="linkish" data-ar="ban-menu" data-k="${esc(s.k)}" title="Doesn’t work for the lyrics game? Leave it out of every future draft">🚫</button>
          <span class="ar-ban-menu" hidden>
            <button type="button" data-ar="ban-song" data-k="${esc(s.k)}">Not this song</button>
            <button type="button" data-ar="ban-artist" data-k="${esc(s.k)}">Not ${esc(s.a)}</button>
          </span>
        </div>`}
      </div>
      ${opts.down ? `<button type="button" class="ar-card-back" data-ar="flip" aria-label="A face-down card: tap to turn it over"><span>🏟️</span></button>` : ""}
    </div>
  </div>`;
}

function arFloorsHTML(dr) {
  const per = ar.setup.perTier;
  return `<div class="ar-floors">${AR_TIERS.map((t, i) => {
    const n = arTierCount(dr, i);
    return `<div class="ar-floor${n >= per ? " done" : ""}"><span>${t.emoji} ${t.name}</span>
      <b>${n}/${per}</b><i style="width:${(n / per * 100).toFixed(0)}%"></i></div>`;
  }).join("")}</div>`;
}

function arDeckHTML(dr) {
  const per = ar.setup.perTier;
  const canSwap = arMulliganMode && dr.hand.includes("mulligan") && !dr.lyric;
  return `<aside class="ar-deck"><h3>Deck <span class="muted">${dr.picks.filter(p => !p.skipped).length}/${per * 4}</span></h3>
    ${AR_TIERS.map((t, ti) => {
      const picks = dr.picks.filter(p => p.tier === ti);
      return `<p class="ar-deck-tier">${t.emoji} ${t.name} <span class="muted">${picks.length}/${per}</span></p>
        <ol class="ar-deck-list">${picks.map(p => p.skipped ? `<li class="muted">(no song left)</li>` : `<li class="rar-${arRar(p.rar).id}${p.k === arFx.justPicked ? " ar-new" : ""}">
          <span class="ar-dot"></span><span class="ar-deck-song"><b>${esc(p.t)}</b><small>${esc(p.a)}${p.boss ? " · 👑 boss" : ""}</small>
          ${p.line?.lines?.length ? `<small class="ar-deck-line">“${esc(p.line.lines[0])}${p.line.lines.length > 1 ? " …" : ""}”</small>` : ""}
          ${p.bad ? `<small class="ar-bad">⚠️ ${esc(p.bad)} <button type="button" class="linkish" data-ar="swap-free" data-k="${esc(p.k)}">swap it (free)</button></small>` : ""}</span>
          ${canSwap && !p.bad ? `<button type="button" class="linkish" data-ar="mulligan" data-k="${esc(p.k)}" title="Use your Mulligan on this song">♻️</button>` : ""}</li>`).join("")}</ol>`;
    }).join("")}
  </aside>`;
}

function arStatusHTML(dr) {
  const fx = dr.fx, on = [], all = ar.setup.perTier * 4;
  if (fx.lucky) on.push("🍀 lucky");
  if (fx.scout) on.push(`🔮 next ${fx.scout} pack${fx.scout > 1 ? "s" : ""} show their floor`);
  if (fx.legend) on.push("✨ next pack: the rarest");
  const next = Math.round(all * (dr.treasures + 1) / 5) - (all - dr.order.length);
  return `<div class="ar-status"><span class="ar-who">${arName(dr.drafter)} drafts for ${arName(dr.guesser)}</span>
    <span class="ar-pickno" title="The floors come in a random order: you see a song's floor once it's in your deck">🎲 pick ${Math.min(all, all - dr.order.length + 1)} of ${all}</span>
    <span class="ar-refresh" title="Refreshes: swap the whole pack for a new one">🔄 ${dr.refreshes}</span>
    ${dr.treasures < AR_TREASURES && next > 0 ? `<span class="ar-fx" title="A treasure comes after every fifth of the draft">🎁 in ${plural(next, "pick")}</span>` : ""}
    ${on.map(x => `<span class="ar-fx">${esc(x)}</span>`).join("")}</div>`;
}

// your power-ups as little icons: click a draft one to use it; the guessing ones wait for the game
function arHandHTML(dr) {
  const icon = (id, attrs, cls) => `<${attrs ? "button type=\"button\"" : "span"} class="ar-icon ${cls}" ${attrs || ""}
      title="${esc(arPU(id).name)}: ${esc(arPU(id).text)}${cls.includes("guess") ? ` (for guessing)` : ""}"><span class="ar-icon-e">${arPU(id).emoji}</span>
      <small>${esc(arPU(id).name)}</small></${attrs ? "button" : "span"}>`;
  const draft = dr.hand.map((id, n) => icon(id, `data-ar="pu" data-n="${n}" ${arCanUse(dr, id) ? "" : "disabled"}`,
    `draft${id === "mulligan" && arMulliganMode ? " on" : ""}`)).join("");
  const guess = dr.items.map(id => icon(id, "", "guess")).join("");
  const who = ar.setup.mode === "duel" ? "you" : arName(dr.guesser);
  return `<div class="ar-handbar">
    ${draft ? `<div class="ar-hand-group"><span class="ar-hand-label">For the draft <small>· click to use</small></span><div class="ar-icons">${draft}</div></div>` : ""}
    ${guess ? `<div class="ar-hand-group"><span class="ar-hand-label">For guessing <small>· when ${who} guess${who === "you" ? "" : "es"}</small></span><div class="ar-icons">${guess}</div></div>` : ""}
    ${!draft && !guess ? `<span class="muted ar-hand-empty">🎒 No power-ups yet: a treasure comes after every fifth of the draft.</span>` : ""}
    ${arMulliganMode && dr.hand.includes("mulligan") ? `<span class="ar-pending">♻️ Choose a song in your deck to throw out, or click the Mulligan again to keep it.</span>` : ""}
  </div>`;
}

function arDraftHTML(dr, pool) {
  let main = "";
  const ev = dr.event;
  if (dr.lyric) {
    main = arLyricHTML(dr);
  } else if (ev?.type === "neow") {
    main = `<div class="ar-event neow"><p class="ar-big">🌅</p><p class="ar-event-title">A blessing for the road</p>
      <p class="muted">Before the first pack, choose one.</p>
      <div class="ar-loot">${ev.options.map((id, n) => {
        const b = AR_BLESSINGS[id];
        return `<button type="button" class="ar-pu${b.cost ? " costly" : ""}" data-ar="bless" data-id="${id}" style="--i:${n}">
          <span class="ar-pu-emoji">${b.emoji}</span><b>${esc(b.name)}</b>${b.cost ? `<em>${esc(b.cost)}</em>` : ""}<small>${esc(b.text)}</small></button>`;
      }).join("")}</div></div>`;
  } else if (ev?.type === "treasure") {
    const who = ar.setup.mode === "duel" ? `for your own turns as guesser` : `for ${arName(dr.guesser)}`;
    const row = (ids, kind) => `<div class="ar-loot">${ids.map((id, n) => `<button type="button" class="ar-pu${ev.sel[kind] === id ? " sel" : ""}"
        data-ar="loot" data-row="${kind}" data-id="${id}" style="--i:${n + (kind === "g" ? 3 : 0)}">
        <span class="ar-pu-emoji">${arPU(id).emoji}</span><b>${esc(arPU(id).name)}</b><small>${esc(arPU(id).text)}</small></button>`).join("")}</div>`;
    main = `<div class="ar-event treasure"><p class="ar-event-title">${esc(ev.title || (ev.chest ? "🧰 A chest on the way!" : "🎁 Treasure!"))}</p>
      <p class="muted">Take one of each. They go into your hand: click them when you need them.</p>
      <p class="ar-loot-h">🃏 For the draft</p>${row(ev.draft, "d")}
      <p class="ar-loot-h">🎯 For guessing <small class="muted">(${who}, on paper or on screen)</small></p>${row(ev.guess, "g")}
      <div class="g-actions"><button type="button" data-ar="loot-take" ${ev.sel.d && ev.sel.g ? "" : "disabled"}>Take them</button></div></div>`;
  } else if (ev?.type === "compass") {
    main = `<div class="ar-event"><p class="ar-event-title">🧭 Compass: which floor is this pick for?</p>
      <div class="ar-loot">${ev.tiers.map(t => `<button type="button" class="ar-pu" data-ar="compass" data-t="${t}">
        <span class="ar-pu-emoji">${arTier(t).emoji}</span><b>${arTier(t).name}</b>
        <small>${plural(dr.order.filter(x => x === t).length, "pick")} left</small></button>`).join("")}</div></div>`;
  } else if (ev?.type === "mystery") {
    main = `<div class="ar-event mystery"><p class="ar-event-title">🎴 A face-down card</p>
      <p>A song, <b>Rare or better</b>, but you won’t see it (or its floor) until it’s in your deck.</p>
      <div class="ar-facedown">?</div>
      <div class="g-actions"><button type="button" data-ar="mystery-take">Take it blind</button>
        <button type="button" class="ghost" data-ar="mystery-skip">No thanks: show me a normal pack</button></div></div>`;
  } else if (ev?.type === "trader") {
    const pu = arPU(ev.item);
    main = `<div class="ar-event trader"><p class="ar-event-title">🧳 A travelling trader</p>
      <p>“One of your refreshes for my ${pu.emoji} <b>${esc(pu.name)}</b>?” <span class="muted">(${esc(pu.text)})</span></p>
      <div class="g-actions"><button type="button" data-ar="trade-yes">Deal (🔄 ${dr.refreshes} → ${dr.refreshes - 1})</button>
        <button type="button" class="ghost" data-ar="trade-no">No deal</button></div></div>`;
  } else if (ev?.type === "cherry") {
    main = `<div class="ar-event"><p class="ar-event-title">🍒 Cherry-pick: choose the theme</p><div class="ar-loot">${ev.options.map(fid => {
      const f = pool.families.find(x => x.family === fid), c = f.variants[0];
      return `<button type="button" class="ar-pu rar-${arRar(f.rar).id}" data-ar="cherry" data-id="${esc(fid)}"><span class="ar-pu-emoji">${c.emoji}</span>
        <b>${esc(f.variants.length > 1 ? arFamilyLabel(fid, c) : c.name)}</b><small>${esc(f.variants.length > 1 ? arFamilyDesc(fid, c) : c.desc)}</small>
        <i>${arRar(f.rar).name}</i></button>`;
    }).join("")}</div></div>`;
  } else if (ev?.type === "time") {
    main = `<div class="ar-event"><p class="ar-event-title">⏳ Time machine: which year?</p>
      <div class="ar-years">${ev.years.map(y => `<button type="button" data-ar="time" data-y="${y}">${y}</button>`).join("")}</div></div>`;
  } else if (dr.pack) {
    const pk = dr.pack, r = arRar(pk.rar);
    const pending = dr.pending.length ? `<p class="ar-pending">♻️ Replacement pick for the ${arTier(pk.tier).name} floor</p>` : "";
    const animate = !arCalm();
    main = `${pending}<div class="ar-theme rar-${r.id}${pk.boss ? " boss" : ""}${animate && !arFx.packs.has(pk.id) ? " fx-in" : ""}">
        <span class="ar-theme-emoji">${pk.emoji}</span>
        <div><p class="ar-theme-name">${pk.boss ? "👑 Boss pack · " : ""}${esc(pk.name)}</p><p class="muted">${esc(pk.desc)}${pk.boss ? " The last pick: the song you pick here is worth double." : ""}</p></div>
        <span class="ar-theme-rar">${r.name} pack${pk.take > 1 ? ` · take ${pk.take - pk.taken}` : ""}
          ${pk.scouted ? `<i class="ar-theme-floor">${arTier(pk.tier).emoji} ${arTier(pk.tier).name} floor</i>` : `<i class="ar-theme-floor muted">🎲 floor hidden</i>`}</span>
      </div>
      <div class="ar-pack">${pk.songs.map((k, n) => {
        const picked = dr.picks.some(p => p.k === k);
        return arSongCard(pool, k, pk, {picked, n, down: animate && !picked && pk.id && !arFx.seen.has(`${pk.id}|${k}`)});
      }).join("")}</div>
      <div class="g-actions ar-pack-actions">
        <button type="button" class="ghost" data-ar="refresh" ${dr.refreshes > 0 && !pk.taken ? "" : "disabled"}>🔄 Refresh this pack (${dr.refreshes} left)</button>
      </div>`;
  }
  return `${arStatusHTML(dr)}${arFloorsHTML(dr)}${arHandHTML(dr)}<div class="ar-draft"><div class="ar-main">${main}</div>${arDeckHTML(dr)}</div>`;
}
const arFamilyDesc = (fid, c) => ({release: "Songs released in one year (picked at random, older ones more often).",
  decade: "Songs released in one decade.", year_g: "The songs someone played most in one past year.",
  year_d: "The songs someone played most in one past year.", album: "Songs from one album: guess which track.",
  artist: "Songs by one band only.", genre: "Songs of one genre.", mood: "Songs whose lyrics share one mood."})[fid] || c.desc;
const arFamilyLabel = (fid, c) => ({release: "A release year", year_g: c.name.replace(/\d{4}$/, "year…"),
  year_d: c.name.replace(/\d{4}$/, "year…"), decade: "A decade", album: "A whole album", artist: "One band only",
  genre: "A genre", mood: "A mood"})[fid] || c.name;

function arDoneHTML(dr) {
  const next = ar.drafts[ar.cur + 1];
  const counts = AR_RARITY.map((r, i) => [r, dr.picks.filter(p => p.rar === i && !p.skipped).length]);
  return `<div class="ar-event ar-done"><p class="ar-event-title">✅ ${arName(dr.drafter)}’s deck is ready</p>
    <p>${counts.filter(([, n]) => n).map(([r, n], i) => `<span class="ar-pill rar-${r.id}" style="--i:${i}">${n} ${r.name}</span>`).join(" ")}
      ${dr.items.length ? `· power-ups for guessing${ar.setup.mode === "duel" ? "" : ` (${arName(dr.guesser)}’s)`}: ${dr.items.map(id => arPU(id).emoji).join(" ")}` : ""}</p>
    <p class="muted">Your lyric sheet is below: write it on paper now if you like (it’s also on the last screen).
      ${next ? `Then ${arName(next.drafter)} drafts a deck for ${arName(next.guesser)}. ${arName(dr.drafter)}: tap the button first, then pass the device.` : ""}</p>
    <div class="g-actions"><button type="button" data-ar="${next ? "next-draft" : "sheets"}">${next ? `Hand over to ${arName(next.drafter)}` : "📝 Finish the draft"}</button></div></div>
    ${arSheetHTML(ar.cur)}`;
}

// ------------------------------------------------------- lyric choice --
// after every pick: the drafter chooses the lines the guesser gets, following the floor's rule
function arLyricHTML(dr) {
  const lp = dr.lyric, p = dr.picks.find(x => x.k === lp.k), L = arLyrics[lp.k], r = arRar(p.rar), t = arTier(p.tier);
  const lines = L?.lines || [], sel = lp.start, n = lp.count;
  const msg = !L ? `<p class="muted">Loading the lyrics…</p>`
    : L.failed ? `<p class="ar-bad">Couldn’t load the lyrics. Keep the song and write a line from memory, or pick another one.</p>`
    : !lines.length ? `<p class="ar-bad">No lyrics found for this one. Keep it and write a line from memory, or pick another song.</p>` : "";
  const warn = p.bad && lines.length ? `<p class="ar-bad">⚠️ ${esc(p.bad[0].toUpperCase() + p.bad.slice(1))}. Pick another song, or keep it anyway.</p>` : "";
  return `<div class="ar-present ar-lyric-step">
    <div class="ar-present-song rar-${r.id}">${cover(p.k)}<div><p class="ar-card-title">${esc(p.t)}</p>
      <p class="muted">${esc(p.a)}${p.y ? ` · ${p.y}` : ""}</p>
      <p><span class="ar-pill rar-${r.id}">${r.name}</span>${p.boss ? ` <span class="muted">👑 boss song</span>` : ""}</p>
      ${p.story ? `<p class="ar-card-story">${esc(p.story)}</p>` : ""}</div>
      <p class="ar-floor-reveal tier-${t.id}" title="${t.points} point${t.points > 1 ? "s" : ""} per star"><span>${t.emoji}</span>${t.name}</p></div>
    <div class="ar-present-help"><p><b>It’s ${t.id === "easy" || t.id === "impossible" ? "an" : "a"} ${t.name} song. ✍️ Choose the lyric ${arName(dr.guesser)} gets.</b> Tap the first line. ${esc(arLineRule(p.tier))}</p>
      <div class="g-actions"><button type="button" class="ghost" data-ar="lyric-random" ${lines.length ? "" : "disabled"}>🎲 Random line</button>
        <span class="ar-count">Give <button type="button" class="ghost" data-ar="lyric-count-" ${n > 1 ? "" : "disabled"}>−</button>
        <b>${n}</b> line${n > 1 ? "s" : ""} <button type="button" class="ghost" data-ar="lyric-count+" ${n < 4 ? "" : "disabled"}>+</button></span></div>
      ${warn}</div>
    ${msg || `<ol class="ar-lyric-pick">${lines.map((l, i) =>
      `<li class="${sel !== null && i >= sel && i < sel + n ? "sel" : ""}"><button type="button" data-ar="lyric-line" data-i="${i}">${esc(l)}</button></li>`).join("")}</ol>`}
    <div class="g-actions ar-sticky"><button type="button" data-ar="lyric-keep" ${!L || (lines.length && sel === null) ? "disabled" : ""}>✍️ ${lines.length ? `Keep ${n > 1 ? "these lines" : "this line"}` : "Keep the song"}</button>
      <button type="button" class="ghost" data-ar="lyric-undo">↩ Pick another song</button></div></div>`;
}

// near the end of the song, the selection moves up so that all its lines fit
function arFitLyric(lp, lines) {
  if (!lines.length) return;
  lp.count = Math.max(1, Math.min(lp.count, lines.length));
  if (lp.start !== null) lp.start = Math.max(0, Math.min(lp.start, lines.length - lp.count));
}

// the chosen lines, plus up to three more for hints: the next ones, or the ones before at the end of the song
function arKeepLyric(dr) {
  const lp = dr.lyric, p = dr.picks.find(x => x.k === lp.k), lines = arLyrics[lp.k]?.lines || [];
  if (lines.length) {
    const s = Math.min(lp.start ?? 0, lines.length - 1), n = Math.min(lp.count, lines.length - s);
    const after = lines.slice(s + n, s + n + 3);
    const before = lines.slice(Math.max(0, s - (3 - after.length)), s).reverse();
    p.line = {start: s, count: n, lines: lines.slice(s, s + n), hints: [...after, ...before]};
  } else p.line = {start: null, count: 0, lines: [], hints: []};
  dr.lyric = null;
  arFx.justPicked = p.k;
  arAfterPick(dr, lp.tier, lp.pended);
}

// changed your mind: the song goes back (into the pack, if it came from one)
function arUndoLyric(dr) {
  const lp = dr.lyric;
  dr.lyric = null;
  const n = dr.picks.findIndex(x => x.k === lp.k);
  if (n >= 0) dr.picks.splice(n, 1);
  if (lp.pended) dr.pending.unshift(lp.tier);
  else dr.order.unshift(lp.tier);
  if (!dr.pack) arNext(dr);
}

// ------------------------------------------------------- lyric sheets --
// one deck as a list to copy onto paper: the lines, the hints, and the answer with what it's worth
function arSheetHTML(di) {
  const dr = ar.drafts[di];
  const items = arGuessItems(dr.guesser);
  let n = 0;
  return `<div class="ar-sheet"><h3>📝 ${arName(dr.drafter)}’s lyrics for ${arName(dr.guesser)}</h3>
    ${AR_TIERS.map((t, ti) => {
      const picks = dr.picks.filter(p => p.tier === ti && !p.skipped);
      if (!picks.length) return "";
      return `<h4>${t.emoji} ${t.name} <span class="muted">· ${t.points} pt${t.points > 1 ? "s" : ""} per ★</span></h4>
        <ol class="ar-sheet-list" start="${n + 1}">${picks.map(p => {
          n++;
          const r = arRar(p.rar), L = p.line;
          return `<li class="rar-${r.id}">
            ${L?.lines?.length ? `<div class="ar-sheet-lyric">${L.lines.map(l => `<p>${esc(l)}</p>`).join("")}</div>`
              : `<p class="ar-sheet-lyric muted">(no lyrics: write a line from memory)</p>`}
            ${L?.hints?.length ? `<p class="ar-sheet-hints"><b>Hints</b> ${L.hints.map(esc).join(" / ")}</p>` : ""}
            <p class="ar-sheet-answer">→ <b>${esc(p.t)}</b> · ${esc(p.a)}${p.y ? ` · ${p.y}` : ""}
              <span class="ar-pill rar-${r.id}">${r.name}${r.bonus ? ` +${r.bonus}` : ""}</span>${p.boss ? ` <span class="ar-pill">👑 ×2</span>` : ""}
              ${p.bad ? `<small class="ar-bad">⚠️ ${esc(p.bad)}${ar.phase === "draft" ? ` <button type="button" class="linkish" data-ar="swap-free" data-k="${esc(p.k)}">swap it (free)</button>` : ""}</small>` : ""}</p>
          </li>`;
        }).join("")}</ol>`;
    }).join("")}
    ${items.length ? `<h4>🎯 ${arName(dr.guesser)}’s power-ups for guessing <span class="muted">· tick them off when used</span></h4>
      <ul class="ar-sheet-pu">${items.map(id => `<li><span>☐</span> ${arPU(id).emoji} <b>${esc(arPU(id).name)}</b> <span class="muted">${esc(arPU(id).text)}</span></li>`).join("")}</ul>` : ""}
    <div class="g-actions"><button type="button" class="ghost" data-ar="sheet-copy" data-di="${di}">📋 Copy as text</button>
      <button type="button" class="ghost" data-ar="sheet-print" data-di="${di}">🖨️ Print</button></div></div>`;
}

function arSheetText(di) {
  const dr = ar.drafts[di], out = [`${pname(dr.drafter)}’s lyrics for ${pname(dr.guesser)} (Lyrics Arena, ${new Date().toLocaleDateString()})`];
  let n = 0;
  AR_TIERS.forEach((t, ti) => {
    const picks = dr.picks.filter(p => p.tier === ti && !p.skipped);
    if (!picks.length) return;
    out.push("", `${t.emoji} ${t.name.toUpperCase()} (${t.points} pt${t.points > 1 ? "s" : ""} per star)`);
    picks.forEach(p => {
      const r = arRar(p.rar), L = p.line;
      out.push(`${++n}. ${L?.lines?.length ? L.lines.map(l => `“${l}”`).join(" / ") : "(write a line from memory)"}`);
      if (L?.hints?.length) out.push(`   Hints: ${L.hints.join(" / ")}`);
      out.push(`   Answer: ${p.t} – ${p.a}${p.y ? ` (${p.y})` : ""} · ${r.name}${r.bonus ? ` +${r.bonus}` : ""}${p.boss ? " · boss ×2" : ""}`);
    });
  });
  const items = arGuessItems(dr.guesser);
  if (items.length) out.push("", `${pname(dr.guesser).toUpperCase()}’S POWER-UPS FOR GUESSING`, ...items.map(id => `[ ] ${arPU(id).emoji} ${arPU(id).name}: ${arPU(id).text}`));
  return out.join("\n");
}

async function arCopySheet(di) {
  const text = arSheetText(di);
  try { await navigator.clipboard.writeText(text); toast("Copied: paste it anywhere."); return; } catch { /* not allowed here */ }
  const ta = Object.assign(document.createElement("textarea"), {value: text});
  $("arena-dlg").append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* no clipboard at all */ }
  ta.remove();
  toast(ok ? "Copied: paste it anywhere." : "Couldn’t copy here: use 🖨️ Print instead.");
}

function arPrintSheet(di) {
  const dr = ar.drafts[di], w = window.open("", "_blank");
  if (!w) { toast("The browser blocked the print window: allow pop-ups for this page."); return; }
  const title = `${pname(dr.drafter)}’s lyrics for ${pname(dr.guesser)}`;
  const body = arSheetHTML(di).replace(/<div class="g-actions">[\s\S]*?<\/div><\/div>$/, "</div>");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:15px/1.4 system-ui,sans-serif;margin:24px;color:#000;background:#fff}h3{margin:0 0 8px}h4{margin:18px 0 6px}
    ol{padding-left:28px}li{margin:0 0 12px;break-inside:avoid}.ar-sheet-lyric p{margin:0;font-weight:700;font-size:17px}
    .ar-sheet-hints,.ar-sheet-answer{margin:2px 0;font-size:13px;color:#444}.muted{color:#666}.ar-pill{border:1px solid #999;border-radius:9px;padding:0 6px;font-size:11px}
    .ar-bad{color:#a00}.ar-sheet-pu{list-style:none;padding:0}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}

// whose guessing power-ups are whose: in a duel each drafter keeps theirs for their own turns as guesser,
// with one deck the drafter collects them for the guesser
function arGuessItems(pid) {
  return ar.drafts.filter(d => (ar.setup.mode === "duel" ? d.drafter : d.guesser) === pid).flatMap(d => d.items);
}

// the end of the draft: every deck's sheet (each behind a "look away"), and the on-screen game if you want it
let arSheetOpen = null;
function arSheetsHTML() {
  const open = arSheetOpen, one = ar.drafts.length === 1;
  return `<div class="ar-event ar-done"><p class="ar-event-title">📝 ${one ? "The deck is" : "Both decks are"} ready</p>
    <p>Write the lyrics on paper and play anywhere: the drafter reads (or sings) the lines, each hint is one more line, and the
      answer is right under them. Each drafter opens their own sheet while the guesser looks away.</p>
    <div class="g-actions">${ar.drafts.map((d, di) => `<button type="button" class="${open === di ? "" : "ghost"}" data-ar="sheet-open" data-di="${di}">
      ${open === di ? "🙈 Hide" : "📝 Show"} ${arName(d.drafter)}’s sheet (for ${arName(d.guesser)})</button>`).join("")}</div></div>
    ${open !== null && ar.drafts[open] ? `<p class="ar-pending">🤫 ${arName(ar.drafts[open].guesser)}, look away.</p>${arSheetHTML(open)}` : ""}
    <div class="ar-sheets-end"><p class="muted">Or play it here instead: the screen shows your lines, counts hints and stars and keeps the score.</p>
      <div class="g-actions"><button type="button" class="ghost" data-ar="start-play">▶ Play on this screen</button>
        <button type="button" class="ghost" data-ar="end-run">🏟️ New run</button></div></div>`;
}

function arHandoffHTML() {
  const dr = arDraft();
  return `<div class="ar-handoff"><p class="ar-big">🤫</p><p class="ar-event-title">${arName(dr.drafter)}’s draft</p>
    <p>Pass the device to <b>${arName(dr.drafter)}</b>. ${arName(dr.guesser)}, no peeking: these are the songs you’ll have to guess.</p>
    <div class="g-actions"><button type="button" data-ar="begin-draft">I’m ${arName(dr.drafter)}: start drafting</button></div></div>`;
}

// ---------------------------------------------------------------- play --
function arStartPlay() {
  const queue = [];
  for (let t = 0; t < 4; t++) {
    for (let i = 0; i < ar.setup.perTier; i++) {
      ar.drafts.forEach((d, di) => {
        const p = d.picks.filter(x => x.tier === t)[i];
        if (p && !p.skipped) queue.push({di, presenter: d.drafter, guesser: d.guesser, tier: t, k: p.k});
      });
    }
  }
  const items = {};
  [ar.setup.a, ar.setup.b].forEach(p => { items[p] = arGuessItems(p).slice(); });
  const scores = {};
  [ar.setup.a, ar.setup.b].forEach(p => { scores[p] = 0; });
  ar.play = {queue, turn: 0, scores, items, results: [], cur: null};
  ar.phase = "play";
  arNewTurn();
}

function arPickOf(turn) { return ar.drafts[turn.di].picks.find(p => p.k === turn.k); }

// a turn starts with the lines the drafter chose (they can still change them before showing)
function arFreshTurn(turn) {
  const pick = arPickOf(turn);
  return {stage: "cover", start: null, count: pick?.line?.count || arTier(turn.tier).start, shown: 0, hints: 0, wrong: 0,
          shield: false, double: false, shown_info: {}, outcome: null, sing: null, used: []};
}
function arChosenStart(pick, lines) {
  const want = pick.line?.lines?.[0];
  if (!want || !lines.length) return null;
  if (lines[pick.line.start] === want) return pick.line.start;
  const i = lines.indexOf(want);
  return i >= 0 ? i : null;
}

function arNewTurn() {
  const pl = ar.play;
  if (pl.turn >= pl.queue.length) { ar.phase = "done"; arFinish(); return; }
  pl.cur = arFreshTurn(pl.queue[pl.turn]);
  arSave();
  const next = pl.queue[pl.turn + 1];
  if (next) arFetchLyrics(next.k).catch(() => {});    // get the next song's lyrics ready
}

async function arFetchLyrics(k) {
  if (arLyrics[k]) return arLyrics[k];
  const d = await getJSON("/api/arena/lyrics?k=" + enc(k));
  arLyrics[k] = {text: d.text, lang: d.lang, lines: arLines(d.text)};
  return arLyrics[k];
}

// bits of web pages that end up in some crowd-sourced lyrics: page tabs at the top, Genius leftovers anywhere
const AR_PAGE_TABS = /^(resumen|letras|videos|escuchar|otras grabaciones|resultados principales|overview|lyrics|listen|other recordings|top results|songtext|paroles|\d+ contributors.*|translations.*)$/i;
const AR_PAGE_JUNK = /^(you might also like|\d*embed|see .+ live|get tickets as low as .*)$/i;
function arLines(text) {
  if (!text || /^\s*this track is instrumental\.?\s*$/i.test(text)) return [];
  const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim())
    .filter(l => l && !/^\[[^\]]*\]$/.test(l) && !/^\(?x\d+\)?$/i.test(l) && !AR_PAGE_JUNK.test(l));
  let i = 0;
  while (i < lines.length && AR_PAGE_TABS.test(lines[i])) i++;
  return lines.slice(i);
}
const arNorm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// the tier's rule for a random starting line (the presenter can always tap another one)
function arRandomLine(lines, tier, title) {
  if (!lines.length) return 0;
  const freq = new Map();
  lines.forEach(l => freq.set(arNorm(l), (freq.get(arNorm(l)) || 0) + 1));
  const t = arNorm(title.replace(/\s*[\(\[].*?[\)\]]/g, "").replace(/\s+-\s+.*$/, ""));
  const idx = lines.map((_, i) => i);
  const repeats = i => freq.get(arNorm(lines[i])) > 1;
  const hasTitle = i => t.length > 2 && arNorm(lines[i]).includes(t);
  let choice = [];
  if (tier === 0) choice = idx.filter(repeats);
  if (tier === 0 && !choice.length) choice = idx.slice(0, 4);
  if (tier === 1) choice = idx.slice(0, Math.max(1, Math.ceil(lines.length * 0.5)));
  if (tier === 2) choice = idx.filter(i => !repeats(i) && !hasTitle(i));
  if (tier === 3) choice = idx.slice(Math.floor(lines.length / 2)).filter(i => !repeats(i) && !hasTitle(i));
  if (!choice.length) choice = idx.filter(i => !hasTitle(i));
  if (!choice.length) choice = idx;
  return Math.min(arRand(choice), Math.max(0, lines.length - 1));
}

function arPenalty(c) { return c.hints + c.wrong; }
// the lines on screen: the excerpt plus one line per hint, going on down; at the end of the song, back up
function arShownRange(c, n) {
  const start = c.start ?? 0;
  const down = Math.min(n, start + c.shown);
  const up = Math.max(0, start - Math.max(0, start + c.shown - n));
  return [up, down];
}
function arStarsNow(c) { const p = arPenalty(c); return p === 0 ? 3 : p <= 2 ? 2 : p < AR_MAX_PENALTY ? 1 : 0; }

function arScore(turn, c, pick) {
  const base = arTier(turn.tier).points, bonus = arRar(pick.rar).bonus;
  const stars = c.outcome === "won" ? arStarsNow(c) : 0;
  let gain = base * stars;
  if (pick.boss) gain *= 2;
  if (c.double) gain = c.outcome === "won" && arPenalty(c) <= 1 ? gain * 2 : 0;
  const out = {stars, guesser: gain, presenter: 0, bonusTo: null, bonus};
  if (bonus) {
    if (c.outcome === "won") { out.guesser += bonus; out.bonusTo = "guesser"; }
    else { out.presenter += bonus; out.bonusTo = "presenter"; }
  }
  return out;
}

function arTurnHeader(turn) {
  const pl = ar.play, t = arTier(turn.tier);
  return `<div class="ar-turn-head"><span>${t.emoji} <b>${t.name}</b> · song ${pl.turn + 1} of ${pl.queue.length}</span>
    <span><b>${arName(turn.presenter)}</b> presents · <b>${arName(turn.guesser)}</b> guesses</span>
    <span class="ar-scores">${Object.entries(pl.scores).map(([p, s]) => `<span style="--c:${color(+p)}">${arName(+p)} <b>${s}</b></span>`).join("")}</span></div>`;
}

function arPlayHTML() {
  const pl = ar.play, turn = pl.queue[pl.turn], c = pl.cur, pick = arPickOf(turn);
  if (!turn || !pick) return "";
  const head = arTurnHeader(turn);
  if (c.stage === "cover") {
    return `${head}<div class="ar-handoff"><p class="ar-big">🙈</p>
      <p><b>${arName(turn.guesser)}</b>, look away! <b>${arName(turn.presenter)}</b>, tap when only you can see the screen.</p>
      <div class="g-actions"><button type="button" data-ar="choose">I’m ${arName(turn.presenter)}: show me the song</button></div></div>`;
  }
  const r = arRar(pick.rar), L = arLyrics[pick.k];
  if (c.stage === "choose") {
    const lines = L?.lines || [];
    const sel = c.start;
    const chosen = pick.line?.lines?.length && sel === arChosenStart(pick, lines);
    const warn = L && L.lang && L.lang !== "en" && ar.setup.english
      ? `<p class="ar-bad">⚠️ These lyrics look like ${esc(arLangName(L.lang))}. Play it anyway, or skip it for no points.</p>` : "";
    return `${head}<div class="ar-present">
      <div class="ar-present-song rar-${r.id}">${cover(pick.k)}<div><p class="ar-card-title">${esc(pick.t)}</p>
        <p class="muted">${esc(pick.a)}${pick.y ? ` · ${pick.y}` : ""}</p><p><span class="ar-pill rar-${r.id}">${r.name}</span>
        ${pick.boss ? `<span class="ar-pill">👑 Boss: double points</span>` : ""}</p>${pick.story ? `<p class="ar-card-story">${esc(pick.story)}</p>` : ""}</div></div>
      <div class="ar-present-help"><p><b>${chosen ? "Your lines from the draft are selected." : "Choose where to start."}</b> ${chosen ? "Tap another line to change them." : esc(arLineRule(turn.tier))}</p>
        <div class="g-actions"><button type="button" class="ghost" data-ar="random-line" ${lines.length ? "" : "disabled"}>🎲 Random line</button>
          <span class="ar-count">Start with <button type="button" class="ghost" data-ar="count-" ${c.count > 1 ? "" : "disabled"}>−</button>
          <b>${c.count}</b> line${c.count > 1 ? "s" : ""} <button type="button" class="ghost" data-ar="count+" ${c.count < 4 ? "" : "disabled"}>+</button></span></div>
        ${warn}</div>
      ${!L ? `<p class="muted">Loading the lyrics…</p>` : lines.length ? `<ol class="ar-lyric-pick">${lines.map((l, i) =>
        `<li class="${sel !== null && i >= sel && i < sel + c.count ? "sel" : ""}"><button type="button" data-ar="line" data-i="${i}">${esc(l)}</button></li>`).join("")}</ol>`
        : `<p class="ar-bad">No lyrics found for this one. Present it from memory: read or sing a line yourself, and use “Next line” for every extra line you give.</p>`}
      <div class="g-actions ar-sticky"><button type="button" data-ar="show" ${lines.length && sel === null ? "disabled" : ""}>👀 Show ${arName(turn.guesser)}</button>
        ${warn ? `<button type="button" class="ghost" data-ar="skip-song">Skip this song</button>` : ""}</div></div>`;
  }
  if (c.stage === "guess") {
    const lines = L?.lines || [];
    const [from, to] = arShownRange(c, lines.length);
    const shown = lines.slice(from, to);
    const stars = arStarsNow(c), base = arTier(turn.tier).points;
    const stake = base * stars * (pick.boss ? 2 : 1) * (c.double ? 2 : 1);
    const items = pl.items[turn.guesser] || [];
    const info = [];
    if (c.shown_info.artist) info.push(`🎤 ${esc(pick.a)}`);
    if (c.shown_info.year) info.push(`📅 ${pick.y || (pick.era ? `peak ${pick.era}` : "year unknown")}`);
    if (c.shown_info.initials) info.push(`🔤 ${esc(arInitials(pick.t))}`);
    if (c.shown_info.album) info.push(`💿 ${esc(pick.al || "album unknown")}`);
    if (c.shown_info.chorus) info.push(`🎶 “${esc(c.shown_info.chorus)}”`);
    if (c.shown_info.fifty) info.push(`⚖️ ${c.shown_info.fifty.map(t => `<b>${esc(t)}</b>`).join(" or ")}`);
    const more = lines.length ? to - from < lines.length : true;
    return `${head}<div class="ar-guess">
      <div class="ar-guess-meta"><span class="ar-pill rar-${r.id}">${r.name}</span>${pick.boss ? `<span class="ar-pill">👑 Boss</span>` : ""}
        ${c.double ? `<span class="ar-pill">✖️ Double down</span>` : ""}${c.shield ? `<span class="ar-pill">🛡️ Shield up</span>` : ""}
        <span class="ar-stars" title="Each hint or wrong guess costs: 0 → ★★★, 1–2 → ★★, 3–5 → ★, 6 → lost">${arStars(stars)}</span>
        <span class="muted">${stake} pt${stake === 1 ? "" : "s"} at stake${r.bonus ? ` + ${r.bonus} rarity bonus` : ""}</span></div>
      ${lines.length ? `<blockquote class="ar-lyrics">${shown.map(l => `<p>${esc(l)}</p>`).join("")}</blockquote>`
        : `<p class="ar-lyrics muted">(${arName(turn.presenter)} reads the lyrics aloud)</p>`}
      ${info.length ? `<p class="ar-info">${info.join(" · ")}</p>` : ""}
      <div class="g-actions ar-guess-actions">
        <button type="button" data-ar="won">✅ Got it</button>
        <button type="button" class="ghost" data-ar="wrong">❌ Wrong guess</button>
        <button type="button" class="ghost" data-ar="hint" ${more ? "" : "disabled"}>➕ Next line</button>
        <button type="button" class="ghost" data-ar="lost">🏳️ Give up</button></div>
      <p class="muted ar-penalty">Hints ${c.hints} · wrong guesses ${c.wrong} · the song is lost at ${AR_MAX_PENALTY}</p>
      ${items.length ? `<div class="ar-hand"><p class="sub-h">${arName(turn.guesser)}’s power-ups <small class="muted">· click to use</small></p>
        <div class="ar-icons">${items.map((id, n) => `<button type="button" class="ar-icon guess" data-ar="use" data-n="${n}"
          title="${esc(arPU(id).name)}: ${esc(arPU(id).text)}" ${arPlayItemOk(c, id) ? "" : "disabled"}><span class="ar-icon-e">${arPU(id).emoji}</span>
          <small>${esc(arPU(id).name)}</small></button>`).join("")}</div></div>` : ""}
    </div>`;
  }
  // reveal
  const sc = c.score;
  const won = c.outcome === "won";
  const singAsk = won && ar.setup.sing && c.sing === null && L?.lines?.length;
  const fresh = !arCalm() && arFx.revealed !== `${pl.turn}:${turn.k}`;   // animate the reveal once, not on every redraw
  const stars = [0, 1, 2].map(i => `<span class="ar-star${i < sc.stars ? " on" : ""}" style="--i:${i}">${i < sc.stars ? "★" : "☆"}</span>`).join("");
  return `${head}<div class="ar-reveal rar-${r.id}${fresh ? " fresh" : ""}">
    <div class="ar-present-song rar-${r.id}">${cover(pick.k)}<div><p class="ar-card-title">${esc(pick.t)}</p>
      <p class="muted">${esc(pick.a)}${pick.y ? ` · ${pick.y}` : ""}</p>
      <p><span class="ar-pill rar-${r.id}">${r.name}</span>${pick.cat ? ` <span class="muted">${esc(pick.cat)}</span>` : ""}</p>
      ${pick.story ? `<p class="ar-card-story">${esc(pick.story)}</p>` : ""}</div></div>
    <p class="ar-result ${won ? "ok" : "bad"}">${won ? `<span class="ar-stars-fx">${stars}</span> ${arName(turn.guesser)} got it: +${sc.guesser}` : `💨 Missed.`}
      ${!won && sc.presenter ? `${arName(turn.presenter)} steals the rarity bonus: +${sc.presenter}` : ""}${c.sing ? " · 🎤 +1 for singing it" : ""}</p>
    ${c.loot ? `<p class="ar-loot-msg">🎁 Legendary loot: ${arName(turn.guesser)} gets ${arPU(c.loot).emoji} ${esc(arPU(c.loot).name)}</p>` : ""}
    ${singAsk ? `<div class="ar-sing"><p>🎤 Now sing it! Did ${arName(turn.guesser)} get the next line right?</p>
      <p class="ar-lyrics small">${esc(arSingLine(c, L.lines))}</p>
      <div class="g-actions"><button type="button" data-ar="sing-yes">Yes: +1</button><button type="button" class="ghost" data-ar="sing-no">No</button></div></div>` : ""}
    <div class="g-actions"><button type="button" class="ghost" data-ar="preview">▶ Play the song</button>
      <button type="button" data-ar="next-turn" ${singAsk ? "disabled" : ""}>${pl.turn + 1 >= pl.queue.length ? "🏁 See the results" : "Next song ▶"}</button></div>
  </div>`;
}

function arSingLine(c, lines) {
  const [from, to] = arShownRange(c, lines.length);
  return lines[to] ?? lines[from - 1] ?? "";
}

function arLineRule(tier) {
  return ["Easy: start on the chorus or the line everybody knows.",
          "Medium: any line from the first verse or the chorus.",
          "Hard: any line, but not the chorus and not one with the title in it.",
          "Impossible: any line from the second half that isn’t the chorus or the title."][tier];
}
const arInitials = title => title.replace(/\s*[\(\[].*?[\)\]]/g, "").split(/\s+/).filter(Boolean)
  .map(w => w[0].toUpperCase() + "_".repeat(Math.max(0, w.replace(/[^\p{L}\p{N}]/gu, "").length - 1))).join(" ");

function arResolve(outcome) {
  const pl = ar.play, turn = pl.queue[pl.turn], c = pl.cur, pick = arPickOf(turn);
  c.outcome = outcome;
  c.stage = "reveal";
  c.score = arScore(turn, c, pick);
  pl.scores[turn.guesser] += c.score.guesser;
  pl.scores[turn.presenter] += c.score.presenter;
  if (outcome === "won" && pick.rar === 3 && c.score.stars === 3) {   // legendary loot
    c.loot = arRand(AR_PLAY_ITEMS);
    (pl.items[turn.guesser] = pl.items[turn.guesser] || []).push(c.loot);
  }
  pl.results.push({turn: pl.turn, k: pick.k, t: pick.t, a: pick.a, presenter: turn.presenter, guesser: turn.guesser,
                   tier: turn.tier, rar: pick.rar, outcome, stars: c.score.stars, hints: c.hints, wrong: c.wrong,
                   gain: c.score.guesser, steal: c.score.presenter, boss: pick.boss});
  arSave();
  arPlayPreview(pick.k);
}

// guessing power-ups that only make sense at some moments
function arPlayItemOk(c, id) {
  if (id === "double") return arPenalty(c) === 0 && !c.double;
  if (id === "rewind") return arPenalty(c) > 0;
  if (id === "shield") return !c.shield;
  if (["artist", "year", "initials", "album", "chorus", "fifty"].includes(id)) return !c.shown_info[id];
  return true;
}
// the line repeated most often: the chorus, more or less
function arChorusLine(lines) {
  const n = new Map();
  lines.forEach(l => n.set(arNorm(l), (n.get(arNorm(l)) || 0) + 1));
  let best = null, most = 1;
  lines.forEach(l => { if (n.get(arNorm(l)) > most) { most = n.get(arNorm(l)); best = l; } });
  return best;
}
// the wrong title for Fifty-fifty: another song in the decks, by the same band when there is one
function arDecoy(pick) {
  const all = ar.drafts.flatMap(d => d.picks).filter(p => !p.skipped && p.k !== pick.k && arNorm(p.t) !== arNorm(pick.t));
  const same = all.filter(p => p.a === pick.a);
  const d = arRand(same.length ? same : all);
  return shuffle([pick.t, d ? d.t : "Something else"]);
}

function arUseItem(n) {
  const pl = ar.play, turn = pl.queue[pl.turn], c = pl.cur, pick = arPickOf(turn);
  const items = pl.items[turn.guesser] || [];
  const id = items[n];
  if (!id || !arPlayItemOk(c, id)) return;
  items.splice(n, 1);
  c.used.push(id);
  if (id === "album") c.shown_info.album = true;
  if (id === "fifty") c.shown_info.fifty = arDecoy(pick);
  if (id === "rewind") { if (c.wrong) c.wrong--; else c.hints--; }
  if (id === "chorus") {
    const line = arChorusLine(arLyrics[pick.k]?.lines || []);
    if (line) c.shown_info.chorus = line;
    else { items.splice(n, 0, id); c.used.pop(); toast("This song has no repeated line: keep the Chorus for another one."); }
  }
  if (id === "artist") c.shown_info.artist = true;
  if (id === "year") c.shown_info.year = true;
  if (id === "initials") c.shown_info.initials = true;
  if (id === "shield") c.shield = true;
  if (id === "double") c.double = true;
  if (id === "hum") arHum(pick.k);
  if (id === "veto") {
    // swap with a later song of the same presenter and tier; without one, the song just goes
    const later = pl.queue.findIndex((q, i) => i > pl.turn && q.presenter === turn.presenter && q.tier === turn.tier);
    if (later > 0) {
      [pl.queue[pl.turn], pl.queue[later]] = [pl.queue[later], pl.queue[pl.turn]];
      toast("Vetoed: here comes another one.");
    } else {
      pl.queue.splice(pl.turn, 1);
      toast("Vetoed: no other song left on this floor, so this one just goes.");
      if (pl.turn >= pl.queue.length) { ar.phase = "done"; arFinish(); arSave(); arRender(); return; }
    }
    pl.cur = arFreshTurn(pl.queue[pl.turn]);
  }
  arSave();
  arRender();
}

// ---------------------------------------------------------------- sound --
function arStopSound() {
  try { arSound.audio?.pause(); } catch { /* fine */ }
  try { arSound.src?.stop(); } catch { /* already stopped */ }
  arSound.src = null;
}
function arPlayPreview(k) {
  arStopSound();
  arSound.audio ??= new Audio();
  arSound.audio.src = "/api/preview?audio=1&k=" + enc(k);
  arSound.audio.play().catch(() => { /* no preview for this one */ });
}
async function arHum(k) {
  arStopSound();
  try {
    arSound.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (arSound.ctx.state === "suspended") arSound.ctx.resume();
    const r = await fetch("/api/preview?audio=1&k=" + enc(k));
    if (!r.ok) throw new Error("no preview");
    const buf = await arSound.ctx.decodeAudioData(await r.arrayBuffer());
    const from = typeof audibleStart === "function" ? audibleStart(buf, 2, 3) : 0;
    const src = arSound.ctx.createBufferSource(), gain = arSound.ctx.createGain(), t = arSound.ctx.currentTime;
    src.buffer = buf;
    src.connect(gain).connect(arSound.ctx.destination);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.9, t + 0.02);
    gain.gain.setValueAtTime(0.9, t + 2.95);
    gain.gain.linearRampToValueAtTime(0, t + 3);
    src.start(t, from, Math.min(3, buf.duration - from));
    arSound.src = src;
  } catch {
    toast("No preview for this song: the hum is on the house, use it on another one.");
    const pl = ar.play, g = pl.queue[pl.turn].guesser;
    (pl.items[g] = pl.items[g] || []).push("hum");
    arSave();
    arRender();
  }
}

// ------------------------------------------------------------- effects --
// Hearthstone-style reveals: a new pack is dealt face down, each card glowing in its rarity's colour
// (none for common, blue for rare, purple for epic, orange for legendary). The cards turn over one by
// one, commons first; a rare one bursts open in blue, an epic one in purple with its name called out,
// and a legendary one shakes, charges up, and explodes in gold with a flash and a fanfare. Tap a
// face-down card to turn it at once. Picked cards fly into the deck. With "reduce motion" switched on
// in the system settings, everything is shown at once (the sounds stay, unless they're muted).
const AR_SOUND_KEY = "music-stats-arena-sound";
const arFx = {
  sound: (() => { try { return localStorage.getItem(AR_SOUND_KEY) !== "0"; } catch { return true; } })(),
  ctx: null, out: null, noise: null,
  gen: 0,                                          // bumped by every redraw: a running reveal stops
  seen: new Set(),                                 // "pack id|song key" already turned over
  packs: new Set(),                                // packs already announced
  justPicked: null,                                // the deck line to light up after a pick
  revealed: null,                                  // the turn whose reveal already played
  busy: false,                                     // a pick is flying: ignore clicks
};
const AR_FX_COLOR = ["#ced4da", "#4dabf7", "#cc5de8", "#ffa94d"];
const arCalm = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const arWait = ms => new Promise(res => setTimeout(res, ms));

function arAudio() {
  if (!arFx.sound) return null;
  try {
    if (!arFx.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const out = ctx.createGain(), delay = ctx.createDelay(1), feedback = ctx.createGain(), wet = ctx.createGain();
      out.gain.value = 0.55;
      delay.delayTime.value = 0.16;                // a short echo gives the big moments some room
      feedback.gain.value = 0.28;
      wet.gain.value = 0.3;
      out.connect(ctx.destination);
      out.connect(delay).connect(feedback).connect(delay);
      delay.connect(wet).connect(ctx.destination);
      arFx.ctx = ctx;
      arFx.out = out;
    }
    if (arFx.ctx.state === "suspended") arFx.ctx.resume();
    return arFx.ctx;
  } catch { return null; }
}
function arTone(ctx, f, {at = 0, dur = 0.4, type = "sine", vol = 0.1, to = null, attack = 0.008} = {}) {
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(arFx.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function arNoise(ctx, {at = 0, dur = 0.14, vol = 0.05, freq = 2400, q = 0.9} = {}) {
  if (!arFx.noise) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    arFx.noise = b;
  }
  const t = ctx.currentTime + at, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = arFx.noise;
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(freq, t);
  bp.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(arFx.out);
  src.start(t, Math.random() * 0.5, dur + 0.02);
}
const AR_SFX = {
  deal: ctx => [0, 0.08, 0.16].forEach(at => arNoise(ctx, {at, dur: 0.07, vol: 0.03, freq: 3400})),
  flip: ctx => arNoise(ctx, {dur: 0.12, vol: 0.045, freq: 1900}),
  pick: ctx => { arTone(ctx, 230, {dur: 0.16, type: "triangle", vol: 0.13, to: 115}); arNoise(ctx, {dur: 0.09, vol: 0.035, freq: 900}); },
  rare: ctx => [1046.5, 1568].forEach((f, i) => arTone(ctx, f, {at: i * 0.075, dur: 0.6, vol: 0.06})),
  epic: ctx => [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => arTone(ctx, f, {at: i * 0.07, dur: 0.9, type: "triangle", vol: 0.055})),
  charge: ctx => {
    arTone(ctx, 140, {dur: 0.95, type: "sawtooth", vol: 0.025, to: 620, attack: 0.7});
    arNoise(ctx, {dur: 0.9, vol: 0.02, freq: 700, q: 0.5});
  },
  legendary: ctx => {
    arTone(ctx, 98, {dur: 1.2, vol: 0.3, to: 41});                       // the boom
    arNoise(ctx, {dur: 0.5, vol: 0.08, freq: 420, q: 0.6});
    [523.25, 659.25, 783.99, 1046.5].forEach(f => arTone(ctx, f, {at: 0.05, dur: 1.8, type: "triangle", vol: 0.045, attack: 0.25}));
    [1567.98, 2093, 2637.02, 3135.96, 4186.01].forEach((f, i) => arTone(ctx, f, {at: 0.25 + i * 0.07, dur: 0.7, vol: 0.03}));
  },
  boss: ctx => [0, 0.22, 0.44].forEach((at, i) => {
    arTone(ctx, 82.4 - i * 6, {at, dur: 0.5, vol: 0.22, to: 50});
    arNoise(ctx, {at, dur: 0.2, vol: 0.05, freq: 300});
  }),
  treasure: ctx => [784, 988, 1175, 1568, 1976].forEach((f, i) => arTone(ctx, f, {at: i * 0.06, dur: 0.5, vol: 0.045})),
  win: ctx => [523.25, 659.25, 783.99].forEach((f, i) => arTone(ctx, f, {at: i * 0.09, dur: 0.5, type: "triangle", vol: 0.07})),
  miss: ctx => [392, 311.13].forEach((f, i) => arTone(ctx, f, {at: i * 0.16, dur: 0.45, type: "triangle", vol: 0.06})),
};
function arPlay(name) {
  const ctx = arAudio();
  if (!ctx || !AR_SFX[name]) return;
  try { AR_SFX[name](ctx); } catch { /* sound is a bonus */ }
}
function arSoundButton() {
  const b = $("arena-sound");
  if (!b) return;
  b.textContent = arFx.sound ? "🔊" : "🔇";
  b.setAttribute("aria-pressed", String(arFx.sound));
  b.title = arFx.sound ? "Sound effects: on" : "Sound effects: off";
}

// sparks, a ring of light, rays and a callout over an element, in the colour of a rarity
function arFxLayer() {
  let layer = $("ar-fx");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "ar-fx";
    layer.className = "ar-fx-layer";
    $("arena-dlg").append(layer);
  }
  return layer;
}
function arBurst(el, rar, {quiet = false, small = false} = {}) {
  if (arCalm() || !el?.isConnected || rar < 1) return;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const layer = arFxLayer(), c = AR_FX_COLOR[rar];
  const box = document.createElement("div");
  box.className = "ar-burst";
  box.style.cssText = `left:${x}px;top:${y}px;--c:${c}`;
  const n = small ? 10 : [0, 16, 26, 44][rar], reach = (small ? 70 : [0, 110, 160, 250][rar]);
  let html = `<i class="ar-ring"></i>${rar >= 2 && !small ? `<i class="ar-ring late"></i>` : ""}${rar === 3 && !small ? `<i class="ar-rays"></i>` : ""}`;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = reach * (0.45 + Math.random() * 0.75);
    html += `<b style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;`
      + `--s:${(3 + Math.random() * (rar + 3)).toFixed(1)}px;--d:${(600 + Math.random() * 700).toFixed(0)}ms"></b>`;
  }
  box.innerHTML = html;
  layer.append(box);
  setTimeout(() => box.remove(), 2000);
  if (small) return;
  if (rar === 3) {
    const flash = document.createElement("div");
    flash.className = "ar-flash";
    flash.style.cssText = `--x:${x}px;--y:${y}px`;
    layer.append(flash);
    setTimeout(() => flash.remove(), 1000);
    const b = arBody();
    b.classList.remove("ar-shake");
    void b.offsetWidth;                            // restart the animation
    b.classList.add("ar-shake");
    setTimeout(() => b.classList.remove("ar-shake"), 500);
  }
  if (rar >= 2 && !quiet) {
    const label = document.createElement("div");
    label.className = "ar-callout";
    label.textContent = `${AR_RARITY[rar].name}!`;
    label.style.cssText = `left:${x}px;top:${r.top + Math.min(70, r.height / 3)}px;--c:${c}`;
    layer.append(label);
    setTimeout(() => label.remove(), 1700);
  }
}

// turn one card over; rare and better ones burst open
async function arFlip(card, pack, {quick = false} = {}) {
  if (!card || card.dataset.flipping || !card.classList.contains("is-down")) return;
  card.dataset.flipping = "1";
  const rar = +card.dataset.rar;
  if (pack) arFx.seen.add(`${pack.id}|${card.dataset.k}`);
  if (!quick && rar >= 2) {                        // epic and legendary cards gather themselves first
    const r = card.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) {     // on a phone it may be further down: bring it into view
      card.scrollIntoView({block: "center", behavior: "smooth"});
      await arWait(380);
    }
    card.classList.add(rar === 3 ? "charging" : "charging-sm");
    if (rar === 3) arPlay("charge");
    await arWait(rar === 3 ? 950 : 320);
    card.classList.remove("charging", "charging-sm");
    if (!card.isConnected) return;                 // the screen changed meanwhile (a refresh, a pick)
  }
  card.classList.remove("is-down");
  card.dataset.turned = String(Date.now());
  arPlay("flip");
  if (rar >= 1) {
    await arWait(240);                             // halfway through the turn
    if (!card.isConnected) return;
    arBurst(card, rar);
    arPlay(AR_RARITY[rar].id);
  }
}

// a fresh pack: deal it face down, then turn the cards over, commons first and the rarest last
async function arRevealPack(box, pack) {
  const downs = [...box.querySelectorAll(".ar-pack .ar-card.is-down")];
  if (!downs.length) return;
  const gen = arFx.gen;
  downs.forEach(c => c.classList.add("dealt"));
  arPlay("deal");
  await arWait(380 + downs.length * 90);
  downs.forEach(c => c.classList.remove("dealt"));   // done: or it would play again after a charge-up
  const order = downs.slice().sort((a, b) => +a.dataset.rar - +b.dataset.rar);
  for (const card of order) {
    if (gen !== arFx.gen || !card.isConnected) return;
    await arFlip(card, pack);
    if (gen !== arFx.gen) return;
    await arWait(+card.dataset.rar >= 2 ? 420 : 160);
  }
}

// the picked card lifts and flies into the deck, the others fall away
async function arPickFx(card) {
  if (arCalm() || !card) return;
  const rar = +card.dataset.rar;
  arPlay("pick");
  card.closest(".ar-pack")?.querySelectorAll(".ar-card").forEach(c => { if (c !== card) c.classList.add("ar-gone"); });
  if (rar >= 1) arBurst(card, rar, {small: true});
  const from = card.getBoundingClientRect(), to = document.querySelector(".ar-deck")?.getBoundingClientRect();
  const visible = to && to.width > 0 && to.top < innerHeight - 60 && to.bottom > 60;
  const dx = visible ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
  const dy = visible ? to.top + 70 - (from.top + from.height / 2) : -80;
  card.style.zIndex = "5";
  const anim = card.animate([
    {transform: "translate(0, 0) scale(1)", opacity: 1},
    {transform: "translate(0, -14px) scale(1.07)", opacity: 1, offset: 0.3},
    {transform: `translate(${dx}px, ${dy}px) scale(${visible ? 0.16 : 0.55})`, opacity: 0},
  ], {duration: 560, easing: "cubic-bezier(.45,0,.75,1)", fill: "forwards"});
  await anim.finished.catch(() => {});
}

// a single card shown big in the middle of the screen, turned over with its effects (the face-down card)
async function arShowcase(pool, key, caption) {
  if (arCalm()) { toast(caption); return; }
  const wrap = document.createElement("div");
  wrap.className = "ar-showcase";
  wrap.innerHTML = `<div class="ar-showcase-card">${arSongCard(pool, key, {cat: null}, {static: true, down: true})}</div>
    <p class="ar-showcase-cap">${esc(caption)}</p><p class="ar-showcase-tap">tap to continue</p>`;
  arFxLayer().append(wrap);
  const card = wrap.querySelector(".ar-card");
  card.classList.add("dealt");
  await arWait(450);
  card.classList.remove("dealt");
  await arFlip(card, null);
  wrap.classList.add("shown");
  await Promise.race([arWait(2600), new Promise(res => wrap.addEventListener("pointerdown", res, {once: true}))]);
  wrap.classList.add("out");
  await arWait(250);
  wrap.remove();
}

// the song is revealed in the game: the card turns, bursts in its colour, the stars pop
function arRevealSong(box, pick, c) {
  const won = c.outcome === "won";
  if (arCalm()) { arPlay(won ? "win" : "miss"); return; }
  const el = box.querySelector(".ar-reveal .ar-present-song");
  setTimeout(() => {
    if (pick.rar >= 1) { arBurst(el, pick.rar, {quiet: true}); arPlay(AR_RARITY[pick.rar].id); }
    arPlay(won ? "win" : "miss");
  }, 330);
  if (c.loot) setTimeout(() => arBurst(box.querySelector(".ar-loot-msg"), 3, {quiet: true, small: true}), 1000);
}

// after a redraw of the draft: announce a new pack, deal it, light up the newest deck line
function arAfterDraftRender(box, dr) {
  const pk = dr.pack, ev = dr.event;
  arFx.justPicked = null;
  if (ev?.type === "treasure" && !ev.announced) { ev.announced = true; arPlay("treasure"); }
  if (!pk) return;
  const fresh = pk.id && !arFx.packs.has(pk.id);
  if (fresh) {
    arFx.packs.add(pk.id);
    const pool = arPoolNow(dr);
    pk.songs.forEach(k => { if (pool?.songs[pool.byKey.get(k)]?.lang === "en") arFetchLyrics(k).catch(() => {}); });
    if (pk.boss) arPlay("boss");
    if (arCalm()) {                                // no animation: still say how good the pack is
      const best = Math.max(0, ...pk.songs.map(k => arPoolNow(dr)?.songs[arPoolNow(dr).byKey.get(k)]?.rar || 0));
      if (best >= 1) arPlay(AR_RARITY[best].id);
    }
  }
  arRevealPack(box, pk);
}

// -------------------------------------------------------------- results --
function arFinish() {
  arStopSound();
  const pl = ar.play;
  if (!pl || pl.saved) return;
  const best = [...pl.results].sort((a, b) => (b.gain + b.steal) - (a.gain + a.steal))[0];
  const hof = arHof();
  hof.unshift({date: new Date().toLocaleDateString(), mode: ar.setup.mode,
               scores: Object.entries(pl.scores).map(([p, s]) => ({name: pname(+p), points: s})),
               mvp: best ? `${best.t} (${pname(best.guesser)} +${best.gain})` : null});
  try { localStorage.setItem(AR_HOF, JSON.stringify(hof.slice(0, 30))); } catch { /* no storage */ }
  pl.saved = true;
}

function arResultsHTML() {
  const pl = ar.play;
  const rows = Object.entries(pl.scores).map(([p, s]) => ({pid: +p, s})).sort((a, b) => b.s - a.s);
  const duel = ar.setup.mode === "duel";
  const winner = duel && rows[0].s !== rows[1]?.s ? rows[0].pid : null;
  const per = pid => pl.results.filter(r => r.guesser === pid);
  const statLine = pid => {
    const rs = per(pid), got = rs.filter(r => r.outcome === "won");
    if (!rs.length) return "";
    return `${got.length} of ${rs.length} guessed · ${got.filter(r => r.stars === 3).length} on the first try · ${AR_TIERS.map((t, i) =>
      `${t.emoji} ${got.filter(r => r.tier === i).length}/${rs.filter(r => r.tier === i).length}`).join(" ")}`;
  };
  const best = [...pl.results].sort((a, b) => (b.gain + b.steal) - (a.gain + a.steal)).slice(0, 5);
  return `<div class="ar-results">
    <p class="ar-big">${winner !== null ? "🏆" : "🎤"}</p>
    <p class="ar-event-title">${winner !== null ? `${arName(winner)} wins!` : duel ? "It’s a draw!" : "That’s the deck!"}</p>
    <div class="ar-final">${rows.map(r => `<div style="--c:${color(r.pid)}"><b>${arName(r.pid)}</b><span class="huge">${r.s}</span>
      <small>${statLine(r.pid)}</small></div>`).join("")}</div>
    ${best.length ? `<p class="sub-h">Biggest moments</p><ol class="ar-moments">${best.map(r =>
      `<li><b>${esc(r.t)}</b> <span class="muted">· ${esc(r.a)}</span> — ${r.outcome === "won" ? `${arName(r.guesser)} ${arStars(r.stars)} +${r.gain}`
        : `missed${r.steal ? `, ${arName(r.presenter)} stole +${r.steal}` : ""}`}${r.boss ? " 👑" : ""}</li>`).join("")}</ol>` : ""}
    <div class="g-actions"><button type="button" data-ar="new-run">🏟️ New run</button></div></div>`;
}

// ---------------------------------------------------------------- rules --
function arRulesHTML() {
  const pu = ids => ids.map(id => `<li>${arPU(id).emoji} <b>${esc(arPU(id).name)}</b>: ${esc(arPU(id).text)}</li>`).join("");
  return `<div class="ar-rules">
  <p class="g-actions"><button type="button" class="ghost" data-ar="rules">← Back to the game</button></p>
  <h3>📜 Lyrics Arena: the rules</h3>
  <p><b>Guess the lyrics</b>: someone picks a song and shows a line of its lyrics, the other one has to name the
    exact song, and every extra line is a hint. The Arena adds the part that used to be hard, choosing the songs, as a
    draft like Hearthstone’s Arena, with roguelike twists. A run has two parts: <b>the draft</b>, where you also choose each
    song’s lyric, and <b>the game</b>, on paper from the lyric sheet or on this screen.</p>

  <h4>1. Setting up</h4>
  <ul><li><b>Duel</b>: both of you draft a deck for the other one, then you take turns presenting. <b>One deck</b>: only one of
    you drafts, the other only guesses (the drafter collects the guessing power-ups for them).</li>
    <li><b>Songs per floor</b>: 3, 5 or 10. Ten makes the classic 40 songs: 10 Easy, 10 Medium, 10 Hard, 10 Impossible.</li>
    <li><b>Refreshes</b>: how many times you can swap a whole pack for a new one (5 by default).</li>
    <li><b>English lyrics only</b> (on by default): songs in other languages give the band away, so they’re left out.</li>
    <li><b>Sing-it bonus</b>: after a correct guess, singing the next line earns 1 more point (on screen; on paper it’s a house rule).</li></ul>
  <p>The run is saved in this browser after every step, so you can close the page and continue later.</p>

  <h4>2. The draft</h4>
  <p>Pass the device to the drafter; the guesser mustn’t see it. Your deck has <b>four floors</b>, 🌱 Easy, 🔥 Medium,
    💀 Hard and 👹 Impossible, each with the chosen number of songs, but <b>the floors come in a random order you don’t
    see</b>: a pack is always for one floor, and you find out which one when its song is in your deck (or with the 🔭 Spyglass).
    Every pick shows a <b>pack</b>: a theme and 3 to 5 songs. Click one to put it in your deck. The others go away (a song can be offered at most twice per draft).
    Then <b>choose its lyric</b>: the song’s lyrics open with a suggested line that follows the floor’s rule (see the game below).
    Tap another line, 🎲 for a new suggestion, and − / + for how many lines the guesser gets (Easy and Medium start with two,
    Hard and Impossible with one), then ✍️ <b>Keep</b>. Changed your mind? ↩ puts the song back into the pack.</p>
  <ul><li><b>🌅 A blessing to start</b>, like Neow’s in Slay the Spire: choose one of three, one of them with a price.
      ${Object.values(AR_BLESSINGS).map(b => `${b.emoji} <b>${esc(b.name)}</b>${b.cost ? ` (${esc(b.cost.toLowerCase())})` : ""}: ${esc(b.text)}`).join(" ")}</li>
    <li><b>Songs you both know.</b> It’s a game for two: every song is one you’ve <i>both</i> played at least 3 times,
    so the guesser can name it and the drafter can present it and sing along. On the easier floors the drafter’s favourites
    come up more (on Easy, a song they played 30+ times is 2.5 times as likely as one they played 3–9 times).</li>
    <li><b>Seen from the guesser’s side.</b> Which floor a song is on, how special it is, its story, the year it belongs to and
    whether it was played “lately” come from the <i>guesser’s</i> history, and packs put the songs the guesser played most
    first. The cards show the guesser’s plays first, then the drafter’s.</li>
    <li><b>Difficulty</b>: <code>log2(1 + the guesser’s plays)</code>, shrinking with the years since they last played the song
    (four years halve it). 6.5 or more is Easy (about 90+ plays, recently), 5 to 6.5 Medium (about 30–90), 3.5 to 5 Hard
    (about 10–30), 2 to 3.5 Impossible (about 3–10, or more but long ago). Below 2 the guesser barely knows the song, so it
    isn’t offered at all.</li>
    <li><b>Rarity</b> is how special the song is in the guesser’s own history, shown by the card’s colour:
      <span class="ar-pill rar-common">Common</span> <span class="ar-pill rar-rare">Rare</span> <span class="ar-pill rar-epic">Epic</span>
      <span class="ar-pill rar-legendary">Legendary</span>.
      Legendary: telepathy (you both put it on within an hour, out of nowhere), one of the guesser’s 10 biggest one-day binges,
      their #1 song of a year at least three years ago followed by two years of silence, or one of the first 100 songs in both
      your histories. Epic: their next 20 biggest binges, their top 10 of a year at least three years back, a forgotten favourite
      with 100+ plays, or a one-season fling. Rare: their next 50 binges, the rest of their top 30 of a past year, one of their
      first 100 songs, a forgotten favourite with 40+ plays, a comeback after two years, a one-hit wonder or a night-owl song.
      Binges count against the guesser’s own habits, since some people loop a song 100 times a day and others never pass 15.
      About 55–70% of songs are Common, 23–33% Rare, 6–9% Epic and 2% Legendary. A rare song is worth a bonus in the game.</li>
    <li><b>The reveal</b>: a pack is dealt face down, each card glowing in its rarity’s colour, then the cards turn over one by
      one, the rarest last. Rare cards burst open in blue, epic ones in purple, and a legendary one shakes, charges up and explodes
      in gold. Tap a face-down card to turn it at once. 🔊 at the top switches the sounds off.</li>
    <li><b>Refresh</b> 🔄: swap the whole pack for a new one, as long as you haven’t picked from it.</li>
    <li><b>🚫 Not for the lyrics game</b>: under every card. Leaves that song, or the whole artist, out of every future draft
      (German lyrics that slipped through, instrumentals, no lyrics anywhere…). The card is replaced at once and it doesn’t
      cost a refresh. Undo it from the start screen.</li>
    <li><b>Lyrics check</b>: songs whose lyrics haven’t been fetched yet say “lyrics unchecked”. When you pick one, its lyrics
      are fetched; if they turn out not to be in English, or there are none, the lyric step says so and you can pick another song.</li>
    <li><b>The lyric sheet</b>: when a deck is done, it becomes a list, floor by floor: the lines you chose, up to three more lines
      as hints, and the answer with its rarity and points. Write it on paper, 📋 copy it or 🖨️ print it. At the end of the draft
      every deck’s sheet is there again (each drafter opens their own), and ▶ <b>Play on this screen</b> is the optional alternative.</li>
    <li><b>Treasure</b> 🎁: after every fifth of the draft (four times) you take one power-up for the draft and one for guessing,
      each from three. With a blessing, that’s about five of each by the end. Sometimes a 🧰 chest turns up too.</li>
    <li><b>Your hand</b>: power-ups wait as little icons under the floors. Click a draft one to use it; most act on the pack in
      front of you, before you pick from it. The guessing ones are for the game: in a duel the drafter keeps them for their
      own turns as guesser, with one deck they’re for the guesser. They’re on the lyric sheet to tick off on paper.</li>
    <li><b>Events</b> (at most one between two treasures, by chance): 🎴 <b>a face-down card</b>, a Rare-or-better song you take
      blind or leave; 🧳 <b>a trader</b> who swaps a refresh for a power-up.</li>
    <li><b>👑 The boss pack</b>: the very last pick is an Epic or Legendary pack when there is one. That song is
      worth double in the game.</li>
    <li>At most 3 songs per artist in one deck.</li></ul>

  <h4>3. The packs</h4>
  <p>Each pack has a theme. Packs about your past are the point: they pull the draft away from what you played last month.</p>
  <ul>
    <li>💭 <b>Forgotten favourites</b> (Epic): songs the guesser played 15+ times but not in the last year of their history, and the drafter has played too.</li>
    <li>🗓️ <b>The guesser’s year</b> (Rare, Epic for years 4+ years back): the songs they played most in one past year.
      🏆 <b>Their all-time favourites</b>: their 200 most played songs.</li>
    <li>🧳 <b>The drafter’s old favourites</b> and 📼 <b>the drafter’s year</b> (Rare): the same from the drafter’s side.</li>
    <li>📅 <b>Year vibes</b> and 📻 <b>decade throwbacks</b>: by release year (from Apple Music’s catalogue).</li>
    <li>🤝 <b>Shared anthems</b>: 10+ plays each. 🎸 <b>The hits of bands you share</b>: the five songs of each band the guesser plays most.
      💎 <b>Deep cuts</b>: the rest of those bands’ songs.</li>
    <li>🎁 <b>More the guesser’s than the drafter’s</b>: songs the guesser played at least three times as often.</li>
    <li>🌞 <b>One-season flings</b> (Epic): 75% of the guesser’s plays within two months, at least a year ago.
      🔁 <b>On repeat</b> (Epic): the guesser’s biggest one-day binges.</li>
    <li>🐣 <b>First discoveries</b>: the first 300 songs in someone’s history. 🔙 <b>Comebacks</b>: the guesser went back to a song after a year or more.</li>
    <li>🔮 <b>Telepathy</b> and ✨ <b>Legends</b> (Legendary). 🧬 <b>Someone got the other into these</b> (Rare).</li>
    <li>💿 <b>A whole album</b> and 🎤 <b>one band only</b> (bands the guesser knows): guess <i>which</i> track it is.
      🦄 <b>One-hit wonders</b>: the one song of a band the guesser plays.
      🌙 <b>Demon hours</b>, ☀️ <b>summer</b> and ❄️ <b>winter songs</b> (the guesser’s), 🎭 <b>moods</b> (from the lyrics), 🎛️ <b>genres</b>.</li>
    <li>🎲 <b>Wildcard</b>: anything, five songs.</li></ul>
  <p><b>Against recency bias</b>: whatever the pack, a song is chosen by first picking one of the years it covers at random,
    every year equally likely, and only then a song from that year (a song’s year is the one the guesser played it most in).
    Songs the guesser played in the last two months are four times less likely, so are themes made mostly of them, year packs
    favour older years, and the current year never gets a year pack. Rare-or-better songs are a bit more likely than common ones.</p>

  <h4>4. Power-ups</h4>
  <p>For the draft (click them in your hand):</p><ul>${pu(AR_DRAFT_ITEMS)}</ul>
  <p>For guessing (in a duel, the drafter keeps them for their own turns as guesser; with one deck they’re the guesser’s).
    On paper the presenter does what the power-up says: names the artist, reads the chorus, names a wrong title next to
    the right one…</p><ul>${pu(AR_PLAY_ITEMS)}</ul>

  <h4>5. The game</h4>
  <p><b>On paper</b>: the drafter reads (or sings) the lines from their sheet, each hint is the next line on it, and you count
    stars and points the same way as below. <b>On screen</b> (optional): songs come floor by floor, Easy first, alternating
    presenters in a duel, starting with the lines chosen in the draft. Each turn:</p>
  <ol><li>The guesser looks away. The presenter sees the song and its lyrics, with the lines from the draft selected (tap another to change them). 🎲 gives a random line that
      follows the floor’s rule: <b>Easy</b> the chorus or the famous line, <b>Medium</b> any line from the first half,
      <b>Hard</b> any line that isn’t the chorus or the title, <b>Impossible</b> the same from the second half.
      Easy and Medium start with two lines, Hard and Impossible with one (the presenter can change it).</li>
    <li>👀 Show: the guesser sees only the lines. They guess out loud; the presenter judges (exact song: right title, right band).</li>
    <li>➕ <b>Next line</b> reveals one more line. ❌ <b>Wrong guess</b> counts like a hint. Every hint or wrong guess costs:
      0 → ★★★, 1–2 → ★★, 3–5 → ★, at 6 the song is lost. 🏳️ gives up.</li>
    <li>Reveal: the song plays, and with the sing-it bonus on, sing the next line for +1.</li></ol>

  <h4>6. Points</h4>
  <table class="ar-table"><tr><th>Floor</th><th>Points per star</th><th>Max (★★★)</th></tr>
    ${AR_TIERS.map(t => `<tr><td>${t.emoji} ${t.name}</td><td>${t.points}</td><td>${t.points * 3}</td></tr>`).join("")}</table>
  <ul><li><b>Rarity bonus</b>: Rare +1, Epic +2, Legendary +3. If the guesser gets the song, it’s theirs. If not, the presenter
      steals it: a rare pick is a gamble.</li>
    <li>👑 <b>Boss song</b>: everything ×2 (not the rarity bonus).</li>
    <li>✖️ <b>Double down</b>: the floor points ×2 if guessed with at most one hint or wrong guess, otherwise no floor points (the rarity bonus works as usual).</li>
    <li>🎤 <b>Sing it</b>: +1. 🎁 <b>Legendary loot</b>: getting a Legendary song ★★★ earns a random power-up.</li>
    <li>In a duel, most points after the last song wins. The result goes into the 🏆 hall of fame.</li></ul>

  <h4>7. House rules worth agreeing on</h4>
  <ul><li>What counts as “exact”: is a live version the same song? Is the band name needed?</li>
    <li>Whether guesses have a time limit, and whether the guesser may say several titles at once (each one counts as a wrong guess).</li></ul>
  </div>`;
}

// ---------------------------------------------------------------- render --
async function arRender() {
  const box = arBody();
  if (!box) return;
  arFx.gen++;                                      // a reveal still running on the old screen stops
  if (arRulesOpen) { box.innerHTML = arRulesHTML(); return; }
  if (!ar || ar.phase === "setup") {
    box.innerHTML = arSetupHTML();
    arRenderBlocked();
    const [a, b] = arPeople();
    if (b !== undefined) arPrefetch(a, b);
    return;
  }
  if (ar.phase === "handoff") { box.innerHTML = arHandoffHTML(); return; }
  if (ar.phase === "draft") {
    const dr = arDraft();
    let pool;
    try {
      if (!arPoolNow(dr)) box.innerHTML = `<p class="muted">Gathering ${arName(dr.drafter)}’s songs for ${arName(dr.guesser)}… (the first time can take a few seconds)</p>`;
      pool = await arPool(dr);
    } catch (e) {
      box.innerHTML = `<p class="muted">Couldn't load the songs: ${esc(e.message)}</p><div class="g-actions"><button type="button" data-ar="new-run">Back</button></div>`;
      return;
    }
    if (pool.songs.length < ar.setup.perTier * 4 && !dr.small) {
      const pr = pool.lyrics;
      box.innerHTML = `<div class="ar-event"><p class="ar-event-title">Not enough songs yet</p>
        <p>Only ${plural(pool.songs.length, "song")} can be drafted so far: the Arena only offers songs whose lyrics are known to be
          ${ar.setup.english ? "in English" : "there"}.${pr ? ` The server fetches lyrics in the background (${pr.done.toLocaleString()} of
          ${pr.total.toLocaleString()} songs so far${pr.running ? "" : "; start it without --no-lyrics-scan to fetch the rest"}).` : ""}</p>
        <div class="g-actions"><button type="button" data-ar="new-run">Back</button>
          <button type="button" class="ghost" data-ar="small-ok">Draft anyway</button></div></div>`;
      return;
    }
    if (dr.lyric) {
      const lp = dr.lyric, p = dr.picks.find(x => x.k === lp.k);
      if (!p) dr.lyric = null;
      else {
        if (!arLyrics[lp.k]) {
          box.innerHTML = arDraftHTML(dr, pool);
          try { await arFetchLyrics(lp.k); } catch { arLyrics[lp.k] = {text: null, lang: null, lines: [], failed: true}; }
          if (dr !== arDraft() || dr.lyric !== lp || ar.phase !== "draft") return;    // moved on meanwhile
        }
        arCheckLyrics(p, arLyrics[lp.k]);
        if (lp.start === null && arLyrics[lp.k].lines.length) lp.start = arRandomLine(arLyrics[lp.k].lines, lp.tier, p.t);
        arFitLyric(lp, arLyrics[lp.k].lines);
      }
    }
    if (!dr.pack && !dr.event && !dr.done && !dr.lyric) arNext(dr);
    arSave();
    box.innerHTML = dr.done ? arDoneHTML(dr) : arDraftHTML(dr, pool);
    if (!dr.done && !dr.lyric) arAfterDraftRender(box, dr);
    if (dr.lyric) {
      if (arFx.lyricFor !== dr.lyric.k) { arFx.lyricFor = dr.lyric.k; box.scrollTop = 0; }   // a new song: from its top
      arScrollToLine(box);
    }
    return;
  }
  if (ar.phase === "sheets") { box.innerHTML = arSheetsHTML(); return; }
  if (ar.phase === "play") {
    const pl = ar.play, turn = pl.queue[pl.turn];
    if (pl.cur.stage === "choose") {
      if (!arLyrics[turn.k]) {
        box.innerHTML = arPlayHTML();
        try { await arFetchLyrics(turn.k); } catch { arLyrics[turn.k] = {text: null, lang: null, lines: []}; }
      }
      const c = pl.cur;
      if (c.start === null && arLyrics[turn.k].lines.length) {   // the drafter's lines, or one that follows the floor's rule
        c.start = arChosenStart(arPickOf(turn), arLyrics[turn.k].lines) ?? arRandomLine(arLyrics[turn.k].lines, turn.tier, arPickOf(turn).t);
        arSave();
      }
    }
    box.innerHTML = arPlayHTML();
    if (pl.cur.stage === "choose") arScrollToLine(box);
    const seen = `${pl.turn}:${turn.k}`;
    if (pl.cur.stage === "reveal" && arFx.revealed !== seen) {
      arFx.revealed = seen;
      arRevealSong(box, arPickOf(turn), pl.cur);
    }
    return;
  }
  if (ar.phase === "done") { arFinish(); arSave(); box.innerHTML = arResultsHTML(); }
}

// scroll the lyrics list so the chosen lines are in the middle of the part you can see (above the buttons
// stuck to the bottom); only if that's not enough, the page moves too
function arScrollToLine(box) {
  const li = box.querySelector(".ar-lyric-pick li.sel"), list = li?.parentElement;
  if (!li) return;
  const lr = list.getBoundingClientRect(), bar = box.querySelector(".ar-sticky")?.getBoundingClientRect();
  const bottom = Math.min(lr.bottom, bar ? bar.top : lr.bottom, box.getBoundingClientRect().bottom);
  const seen = Math.max(li.offsetHeight, bottom - lr.top);
  const at = li.getBoundingClientRect().top - lr.top + list.scrollTop;
  list.scrollTop = Math.max(0, at - seen / 2 + li.offsetHeight / 2);
  const last = [...list.querySelectorAll("li.sel")].pop().getBoundingClientRect(), top = bar ? bar.top : bottom;
  if (last.bottom > top) box.scrollTop += last.bottom - top + 8;
}

function openArena() {
  arRulesOpen = false;
  ar = null;                                       // the start screen offers to continue a saved run
  arSoundButton();
  $("arena-dlg").showModal();
  arRender();
}

// ---------------------------------------------------------------- events --
async function arBan(dr, key, artist) {
  const pool = arPoolNow(dr), i = pool.byKey.get(key), s = pool.songs[i];
  try {
    await getJSON("/api/arena/block?" + (artist ? "artist=" + enc(s.a) : "song=" + enc(s.k)));
  } catch (e) { toast("Couldn't save that: " + e.message); return; }
  const gone = artist ? pool.songs.filter(x => x.a === s.a) : [s];
  gone.forEach(x => { x.blocked = true; });
  const pk = dr.pack;
  if (pk) {                                        // refill the pack from the same theme, or anything on the floor
    const ok = arAvailable(dr, pool, pk.tier);
    const c = pool.cat.get(pk.cat);
    pk.songs = pk.songs.filter(k => !pool.songs[pool.byKey.get(k)].blocked);
    const have = new Set(pk.songs);
    const want = Math.max(0, (pk.size || 3) - pk.songs.length);
    const extra = (c ? c.songs : []).filter(j => ok(j) && !have.has(pool.songs[j].k));
    const fill = extra.length >= want ? extra : pool.songs.map((_, j) => j).filter(j => ok(j) && !have.has(pool.songs[j].k));
    shuffle(fill).slice(0, want).forEach(j => {
      pk.songs.push(pool.songs[j].k);
      dr.offered[pool.songs[j].k] = (dr.offered[pool.songs[j].k] || 0) + 1;
    });
  }
  toast(artist ? `${s.a} won’t come up in the lyrics game again.` : `“${s.t}” won’t come up in the lyrics game again.`);
  arSave();
  arRender();
}

function arSwapOut(dr, key, free) {
  const n = dr.picks.findIndex(p => p.k === key);
  if (n < 0) return;
  const [p] = dr.picks.splice(n, 1);
  if (!free) dr.hand.splice(dr.hand.indexOf("mulligan"), 1);
  dr.pending.push(p.tier);
  if (dr.done) dr.done = false;
  if (!dr.pack && !dr.event) arNext(dr);
  toast(`“${p.t}” is out: you get a new pick for the ${arTier(p.tier).name} floor.`);
}

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-ar]");
  if (!b || !b.closest("#arena-dlg")) return;
  const a = b.dataset.ar, dr = arDraft();
  arAudio();                                       // browsers only allow sound once someone has clicked
  if (a === "flip") { arFlip(b.closest(".ar-card"), dr?.pack, {quick: true}); return; }
  if (arFx.busy) return;                           // a card is still flying into the deck
  if (a === "rules") { arRulesOpen = !arRulesOpen; arRender(); $("arena-body").scrollTop = 0; return; }
  if (a === "resume") { ar = arLoad(); arRender(); return; }
  if (a === "abandon") {
    if (!confirm("Abandon the run in progress? Its drafts and scores are lost.")) return;
    try { localStorage.removeItem(AR_KEY); } catch { /* fine */ }
    ar = null; arRender(); return;
  }
  if (a === "new-run") { ar = null; try { localStorage.removeItem(AR_KEY); } catch { /* fine */ } arRender(); return; }
  if (a === "unblock-artist" || a === "unblock-song") {
    await getJSON("/api/arena/block?undo=1&" + (a === "unblock-artist" ? "artist=" : "song=") + enc(b.dataset.v));
    Object.keys(arPools).forEach(k => delete arPools[k]);
    arRenderBlocked();
    return;
  }
  if (a === "begin-draft") { ar.phase = "draft"; arSave(); arRender(); return; }
  if (a === "small-ok") { arDraft().small = true; arSave(); arRender(); return; }
  if (a === "next-draft") { ar.cur++; ar.phase = "handoff"; arSave(); arRender(); return; }
  if (a === "sheets") { ar.phase = "sheets"; arSheetOpen = null; arSave(); arRender(); return; }
  if (a === "start-play") { arStartPlay(); arSave(); arRender(); return; }
  if (a === "sheet-copy") { arCopySheet(+b.dataset.di); return; }
  if (a === "sheet-print") { arPrintSheet(+b.dataset.di); return; }
  if (ar?.phase === "sheets") {
    if (a === "sheet-open") { arSheetOpen = arSheetOpen === +b.dataset.di ? null : +b.dataset.di; arRender(); }
    if (a === "end-run") {
      if (!confirm("Start a new run? Copy or print the lyric sheets first if you still need them.")) return;
      ar = null; try { localStorage.removeItem(AR_KEY); } catch { /* fine */ } arRender();
    }
    return;
  }
  // ---- draft
  if (ar?.phase === "draft" && dr) {
    const pool = arPoolNow(dr);
    const lp = dr.lyric, lines = lp ? arLyrics[lp.k]?.lines || [] : [], ev = dr.event;
    if (lp && a === "lyric-line") { lp.start = +b.dataset.i; }
    else if (lp && a === "lyric-random") { lp.start = arRandomLine(lines, lp.tier, dr.picks.find(x => x.k === lp.k)?.t || ""); }
    else if (lp && a === "lyric-count-") { lp.count = Math.max(1, lp.count - 1); }
    else if (lp && a === "lyric-count+") { lp.count = Math.min(4, lp.count + 1); }
    else if (lp && a === "lyric-keep") { arKeepLyric(dr); }
    else if (lp && (a === "lyric-undo" || (a === "swap-free" && b.dataset.k === lp.k))) { arUndoLyric(dr); }
    else if (lp && a !== "swap-free" && a !== "mulligan") return;   // first the lines
    else if (a === "pick" && dr.pack) {
      const tier = dr.pack.tier;
      // a tap meant to turn a card over can land just after it turned by itself: don't take that as a pick
      if (Date.now() - (+b.closest(".ar-card")?.dataset.turned || 0) < 450) return;
      arFx.busy = true;
      try { await arPickFx(b.closest(".ar-card")); } finally { arFx.busy = false; }
      if (!dr.pack) return;
      arTakeSong(dr, b.dataset.k);                 // then the lyric step; the draft goes on after it
    } else if (a === "refresh" && dr.pack && dr.refreshes > 0 && !dr.pack.taken) {
      dr.refreshes--;
      const tier = dr.pack.tier, scouted = dr.pack.scouted;
      dr.pack = null;
      dr.pack = arBuildPack(dr, pool, tier, {scouted});
    } else if (a === "ban-menu") {
      b.parentElement.querySelector(".ar-ban-menu").hidden = !b.parentElement.querySelector(".ar-ban-menu").hidden;
      return;
    } else if (a === "ban-song" || a === "ban-artist") {
      return arBan(dr, b.dataset.k, a === "ban-artist");
    } else if (a === "pu") {
      arUseDraftPU(dr, pool, +b.dataset.n);
    } else if (a === "bless" && ev?.type === "neow") {
      const bl = AR_BLESSINGS[b.dataset.id];
      arBless(dr, b.dataset.id);
      toast(`${bl.emoji} ${bl.name}`);
      arPlay("treasure");
      if (!dr.event) arNext(dr);
    } else if (a === "loot" && ev?.type === "treasure") {
      ev.sel[b.dataset.row] = b.dataset.id;
    } else if (a === "loot-take" && ev?.type === "treasure" && ev.sel.d && ev.sel.g) {
      arGain(dr, ev.sel.d);
      arGain(dr, ev.sel.g);
      toast(`${arPU(ev.sel.d).emoji} ${arPU(ev.sel.d).name} and ${arPU(ev.sel.g).emoji} ${arPU(ev.sel.g).name} are in your hand.`);
      dr.event = null;
      if (dr.hoard) { dr.event = arTreasureEvent({title: `👑 Dragon’s hoard (${4 - dr.hoard} of 3)`}); dr.hoard--; }
      arNext(dr);
    } else if (a === "compass" && ev?.type === "compass") {
      const t = +b.dataset.t, i = dr.order.indexOf(t);
      dr.order.splice(i, 1);
      dr.order.unshift(t);
      dr.event = null;
      dr.pack = arBuildPack(dr, pool, t, {scouted: true});
      if (!dr.pack && !dr.event) arNext(dr);
    } else if (a === "mystery-take" && dr.event?.type === "mystery") {
      const ev = dr.event;
      dr.event = null;
      const p = arTakeSong(dr, ev.key, {tier: ev.tier, cat: "🎴 Face-down card"});
      arSave();
      arFx.busy = true;
      try { await arShowcase(pool, ev.key, `🎴 It was… ${p.t} by ${p.a} (${arRar(p.rar).name})`); } finally { arFx.busy = false; }
    } else if (a === "mystery-skip") {
      dr.event = null;
      arNext(dr);
    } else if (a === "trade-yes" && dr.event?.type === "trader") {
      dr.refreshes--;
      arGain(dr, dr.event.item);
      toast(`🧳 ${arPU(dr.event.item).emoji} ${arPU(dr.event.item).name} is yours.`);
      dr.event = null;
      arNext(dr);
    } else if (a === "trade-no") {
      dr.event = null;
      arNext(dr);
    } else if (a === "cherry" && dr.event?.type === "cherry") {
      const ev = dr.event;
      dr.event = null;
      dr.pack = arPackFrom(dr, pool, ev.tier, b.dataset.id);
      if (dr.pack && ev.boss) dr.pack.boss = true;
      if (!dr.pack) arNext(dr);
    } else if (a === "time" && dr.event?.type === "time") {
      const ev = dr.event;
      dr.event = null;
      dr.pack = arPackFrom(dr, pool, ev.tier, "release", +b.dataset.y);
      if (dr.pack && ev.boss) dr.pack.boss = true;
      if (!dr.pack) arNext(dr);
    } else if (a === "mulligan" && dr.hand.includes("mulligan")) {
      if (!confirm("Use your Mulligan on this song? You get a new pick for its floor.")) return;
      arSwapOut(dr, b.dataset.k, false);
      arMulliganMode = false;
    } else if (a === "swap-free") {
      arSwapOut(dr, b.dataset.k, true);
    } else return;
    arSave();
    arRender();
    return;
  }
  // ---- play
  if (ar?.phase === "play") {
    const pl = ar.play, c = pl.cur, turn = pl.queue[pl.turn];
    if (a === "choose") { c.stage = "choose"; }
    else if (a === "line") { c.start = +b.dataset.i; }
    else if (a === "random-line") { c.start = arRandomLine(arLyrics[turn.k]?.lines || [], turn.tier, arPickOf(turn).t); }
    else if (a === "count-") { c.count = Math.max(1, c.count - 1); }
    else if (a === "count+") { c.count = Math.min(4, c.count + 1); }
    else if (a === "show") { c.stage = "guess"; c.shown = c.count; if (c.start === null) c.start = 0; }
    else if (a === "skip-song") { pl.queue.splice(pl.turn, 1); arNewTurn(); }
    else if (a === "hint") {
      c.hints++; c.shown++;
      if (arPenalty(c) >= AR_MAX_PENALTY) arResolve("lost");
    } else if (a === "wrong") {
      if (c.shield) { c.shield = false; toast("🛡️ The shield took that one."); }
      else c.wrong++;
      if (arPenalty(c) >= AR_MAX_PENALTY) arResolve("lost");
    } else if (a === "won") { arResolve("won"); }
    else if (a === "lost") { arResolve("lost"); }
    else if (a === "use") { return arUseItem(+b.dataset.n); }
    else if (a === "sing-yes") { c.sing = true; pl.scores[turn.guesser] += 1; pl.results[pl.results.length - 1].sing = true; }
    else if (a === "sing-no") { c.sing = false; }
    else if (a === "preview") { arPlayPreview(turn.k); return; }
    else if (a === "next-turn") { arStopSound(); pl.turn++; arNewTurn(); }
    else return;
    arSave();
    arRender();
  }
});

document.addEventListener("submit", e => {
  if (e.target.id !== "ar-setup") return;
  e.preventDefault();
  const f = new FormData(e.target);
  const mode = f.get("mode");
  let a = +f.get("a"), b2 = +f.get("b");
  if (a === b2) { toast("Pick two different people."); return; }
  arNewRun({mode, a, b: b2, perTier: f.get("perTier"), refreshes: f.get("refreshes"),
            english: !!f.get("english"), sing: !!f.get("sing")});
  arRender();
});

document.addEventListener("change", e => {                 // keep the names in the setup's options right
  const f = e.target.closest("#ar-setup");
  if (!f || !["a", "b"].includes(e.target.name)) return;
  f.querySelectorAll("[data-ar-name]").forEach(x => { x.textContent = pname(+f.elements[x.dataset.arName].value); });
});
$("arena-open").addEventListener("click", openArena);
$("arena-close").addEventListener("click", () => { arStopSound(); $("arena-dlg").close(); });
$("arena-dlg").addEventListener("close", () => {
  arStopSound();
  arFx.gen++;                                      // stop a reveal that's still running
  $("ar-fx")?.replaceChildren();
});
$("arena-rules").addEventListener("click", () => { arRulesOpen = !arRulesOpen; arRender(); });
$("arena-sound").addEventListener("click", () => {
  arFx.sound = !arFx.sound;
  try { localStorage.setItem(AR_SOUND_KEY, arFx.sound ? "1" : "0"); } catch { /* remembered for this visit only */ }
  arSoundButton();
  arPlay("rare");
});