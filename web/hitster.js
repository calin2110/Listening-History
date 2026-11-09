"use strict";
// Hitster: hear a hidden shared song, then place it on a release-year timeline.

const HS_DIFFICULTIES = Object.freeze({
  easy: {seconds: 20, plays: Infinity, hint: "widely spaced years, popular songs, unlimited replays"},
  medium: {seconds: 15, plays: 3, hint: "balanced years, normal song weighting, three plays"},
  hard: {seconds: 10, plays: 2, hint: "nearby years, less-played songs, two plays"},
  expert: {seconds: 6, plays: 1, hint: "tightly clustered years, obscure songs, no replay"},
});

const hs = {
  mode: "solo", difficulty: "medium", target: 10, pool: [], people: [], players: [], timelines: [], scores: [],
  turn: 0, current: null, revealed: false, correct: false, picked: null, winner: null,
  playsUsed: 0, ctx: null, buf: null, src: null, load: null, timer: null, gen: 0,
};

function hsDifficulty() { return HS_DIFFICULTIES[hs.difficulty]; }
function hsCanPlay() { return hs.playsUsed < hsDifficulty().plays; }
function hsPlayLabel() {
  const level = hsDifficulty(), remaining = level.plays - hs.playsUsed;
  if (remaining <= 0) return "Snippet used";
  const replay = Number.isFinite(remaining) ? ` · ${remaining} play${remaining === 1 ? "" : "s"} left` : "";
  return `▶ Play ${level.seconds}-second snippet${replay}`;
}

function hsStop() {
  clearTimeout(hs.timer);
  hs.timer = null;
  const source = hs.src;
  hs.src = null;
  try { source?.stop(); } catch { /* already stopped */ }
  const button = $("hitster-body")?.querySelector("[data-hs='play']");
  if (button) { button.textContent = hsPlayLabel(); button.disabled = !hsCanPlay(); }
  const bar = $("hitster-body")?.querySelector(".hs-progress i");
  if (bar) { bar.style.transition = "none"; bar.style.width = "0"; }
}

function hsWeightedTake(items, weightFor) {
  const weights = items.map(item => {
    const weight = weightFor(item);
    return Number.isFinite(weight) && weight > 0 ? weight : Number.EPSILON;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    at -= weights[i];
    if (at <= 0) return items.splice(i, 1)[0];
  }
  return items.pop();
}

function hsBuildPool(songs) {
  const grouped = new Map();
  for (const song of songs) {
    if (!grouped.has(song.year)) grouped.set(song.year, []);
    grouped.get(song.year).push(song);
  }
  const years = [...grouped].map(([year, choices]) => {
    const strongest = choices.map(s => Math.max(s.weight || 0, 0.01)).sort((a, b) => b - a).slice(0, 3);
    return {year, choices, quality: strongest.reduce((sum, weight) => sum + weight, 0) / strongest.length};
  });
  const chosenYears = [], pool = [];
  while (years.length) {
    const bucket = hsWeightedTake(years, candidate => {
      const quality = Math.log1p(candidate.quality);
      if (!chosenYears.length) {
        return quality ** ({easy: 1.5, medium: 1, hard: 0.6, expert: 0.35}[hs.difficulty]);
      }
      const gap = Math.min(...chosenYears.map(year => Math.abs(year - candidate.year)));
      if (hs.difficulty === "easy") return quality ** 1.5 * (1 + Math.min(gap, 24) / 3);
      if (hs.difficulty === "medium") return quality * (1 + Math.min(gap, 16) / 8);
      if (hs.difficulty === "hard") return quality ** 0.6 / (1 + gap / 6);
      return quality ** 0.35 / ((1 + gap / 3) ** 2);
    });
    pool.push(hsWeightedTake(bucket.choices, song => {
      const popularity = Math.max(song.weight || 0, 0.01);
      if (hs.difficulty === "easy") return popularity ** 1.5;
      if (hs.difficulty === "medium") return popularity;
      if (hs.difficulty === "hard") return 1 / Math.sqrt(popularity);
      return 1 / popularity;
    }));
    chosenYears.push(bucket.year);
  }
  return pool;
}

function hsWeightedPick() {
  return hs.pool.shift();
}

function hsCard(s) {
  return `<article class="hs-card${s.anchor ? " anchor" : ""}">${cover(s.cover_key)}
    <b>${esc(s.title)}</b><span>${esc(s.sub)}</span><strong>${s.year}</strong>${s.anchor ? `<small>Starting card</small>` : ""}</article>`;
}

function hsTimeline(cards, place) {
  let html = "";
  for (let i = 0; i <= cards.length; i++) {
    if (place) {
      const label = i === 0 ? `Before ${cards[0].year}` : i === cards.length ? `After ${cards.at(-1).year}`
        : `Between ${cards[i - 1].year} and ${cards[i].year}`;
      html += `<button type="button" class="hs-slot" data-hs="place" data-at="${i}"><span>＋</span>${label}</button>`;
    }
    if (i < cards.length) html += hsCard(cards[i]);
  }
  return `<div class="hs-scroll"><div class="hs-timeline">${html}</div></div>`;
}

function hsScores() {
  return `<div class="hs-scores">${hs.players.map((name, i) => `<span class="${i === hs.turn && hs.winner == null ? "turn" : ""}">
    <b>${esc(name)}</b> ${hs.scores[i]} / ${hs.target} cards</span>`).join("")}</div>`;
}

function hsRange(cards, year) {
  const at = cards.findIndex(s => s.year > year);
  const i = at < 0 ? cards.length : at;
  return i === 0 ? `before ${cards[0].year}` : i === cards.length ? `after ${cards.at(-1).year}`
    : `between ${cards[i - 1].year} and ${cards[i].year}`;
}

function hsRender() {
  const current = hs.current, name = hs.players[hs.turn], timeline = hs.timelines[hs.turn];
  const shared = listNames(hs.people);
  const reveal = hs.revealed ? `<div class="hs-reveal">${cover(current.cover_key)}<div><p class="g-title">${esc(current.title)}</p>
      <p class="muted">${esc(current.sub)}</p><p class="hs-year">${current.year}</p></div></div>
    <p class="g-result ${hs.correct ? "ok" : "bad"}">${hs.correct ? "Correct — you keep the card!" :
      `Not quite — it belongs ${esc(hsRange(timeline, current.year))}.`}</p>
    <div class="g-actions"><button type="button" data-hs="${hs.winner == null ? "next" : "finish"}">
      ${hs.winner == null ? (hs.mode === "duo" ? "Next player" : "Next song") : "See the result"}</button></div>` : "";
  $("hitster-body").innerHTML = `${hsScores()}
    <p class="hs-note">Drawn from songs shared by <b>${esc(shared)}</b>.
      Every song has a different release year, and only one song per album can appear. The starting card anchors the timeline and does not count toward the
      ${hs.target} you need to keep. <b>${esc(hs.difficulty[0].toUpperCase() + hs.difficulty.slice(1))}:</b>
      ${esc(hsDifficulty().hint)}.</p>
    <h3>${hs.mode === "duo" ? esc(name) + "’s turn" : "Place the mystery song"}</h3>
    <div class="hs-mystery${hs.revealed ? " heard" : ""}"><span aria-hidden="true">?</span>
      <button type="button" data-hs="play"${hsCanPlay() ? "" : " disabled"}>${hsPlayLabel()}</button><div class="hs-progress"><i></i></div>
      <small>No title, artist, cover, or year until you place it.</small></div>
    ${hs.revealed ? reveal : `<p class="g-q">Where was it released?</p>${hsTimeline(timeline, true)}`}`;
}

async function hsLoadPreview() {
  if (hs.buf) return hs.buf;
  if (hs.load) return hs.load;
  const key = hs.current.key, gen = hs.gen;
  hs.load = (async () => {
    const response = await fetch("/api/preview?audio=1&k=" + enc(key));
    if (!response.ok) {
      let message = "HTTP " + response.status;
      try { message = (await response.json()).error || message; } catch { /* audio/error body was not JSON */ }
      throw new Error(message);
    }
    const data = await response.arrayBuffer();
    if (data.byteLength < 1000) throw new Error("preview was empty");
    const buffer = await hs.ctx.decodeAudioData(data);
    if (gen !== hs.gen || hs.current?.key !== key) return null;
    hs.buf = buffer;
    return buffer;
  })().finally(() => { if (hs.current?.key === key) hs.load = null; });
  return hs.load;
}

async function hsPlay() {
  if (hs.src) return hsStop();
  if (!hsCanPlay()) return;
  hsStop();
  const button = $("hitster-body").querySelector("[data-hs='play']");
  const bar = $("hitster-body").querySelector(".hs-progress i");
  button.disabled = true;
  button.textContent = "Loading preview…";
  try {
    if (hs.ctx.state === "suspended") await hs.ctx.resume();
    const buffer = await hsLoadPreview();
    if (!buffer || !button.isConnected) return;
    const source = hs.ctx.createBufferSource(), gain = hs.ctx.createGain(), now = hs.ctx.currentTime;
    const len = Math.min(hsDifficulty().seconds, buffer.duration), fade = Math.min(0.02, len / 4);
    source.buffer = buffer;
    source.connect(gain).connect(hs.ctx.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + fade);
    gain.gain.setValueAtTime(0.9, now + len - fade);
    gain.gain.linearRampToValueAtTime(0, now + len);
    source.onended = () => { if (hs.src === source) hsStop(); };
    source.start(now, 0, len);
    hs.playsUsed++;
    hs.src = source;
    button.textContent = "■ Stop snippet";
    bar.style.transition = "none"; bar.style.width = "0";
    void bar.offsetWidth;
    bar.style.transition = `width ${len}s linear`; bar.style.width = "100%";
    hs.timer = setTimeout(hsStop, len * 1000 + 100);
  } catch (e) {
    hsStop();
    toast(`Couldn't play this preview: ${e.message}.`);
  } finally {
    if (button.isConnected) button.disabled = !hs.src && !hsCanPlay();
  }
}

function hsPlace(at) {
  if (hs.revealed) return;
  hsStop();
  const cards = hs.timelines[hs.turn], year = hs.current.year;
  const before = at ? cards[at - 1].year : -Infinity;
  const after = at < cards.length ? cards[at].year : Infinity;
  hs.correct = before <= year && year <= after;
  hs.picked = at;
  hs.revealed = true;
  if (hs.correct) {
    cards.splice(at, 0, {...hs.current, anchor: false});
    hs.scores[hs.turn]++;
    if (hs.scores[hs.turn] >= hs.target) hs.winner = hs.turn;
  }
  hsRender();
}

function hsNext() {
  hsStop();
  if (hs.mode === "duo") hs.turn = (hs.turn + 1) % hs.players.length;
  hs.current = hsWeightedPick();
  if (!hs.current) {
    $("hitster-body").innerHTML = `<p class="muted">The shared-song pool ran out.</p>
      <div class="g-actions"><button type="button" data-hs="restart">Start again</button></div>`;
    return;
  }
  Object.assign(hs, {revealed: false, correct: false, picked: null, playsUsed: 0, buf: null, load: null});
  hsRender();
  hsLoadPreview().catch(() => {});                       // same preloading path as Name That Tune
}

function hsFinish() {
  hsStop();
  const title = hs.mode === "duo" ? `${esc(hs.players[hs.winner])} wins!` : `You got ${hs.target} cards!`;
  $("hitster-body").innerHTML = `<div class="g-final"><p class="huge">${title}</p><p class="big-line">Timeline complete.</p>
    ${hs.players.map((name, i) => `<section class="hs-final"><h3>${esc(name)} · ${hs.scores[i]} kept</h3>
      ${hsTimeline(hs.timelines[i], false)}</section>`).join("")}
    <div class="g-actions"><button type="button" data-hs="restart">Play again</button></div></div>`;
}

async function startHitster() {
  hsStop();
  hs.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  const gen = ++hs.gen;
  $("hitster-body").innerHTML = `<p class="muted">Building a shared timeline…</p>`;
  try {
    const all = META.people.map((_, i) => i);
    hs.people = state.people.length >= 2 ? state.people.slice() : all;
    if (hs.people.length < 2) throw new Error("Hitster needs at least two listening histories");
    const q = new URLSearchParams({...baseParams(), people: hs.people.join(",")});
    const response = await fetch("/api/hitster?" + q);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
    if (gen !== hs.gen) return;
    const needed = hs.target * (hs.mode === "duo" ? 2 : 1) + 1;
    const yearCount = new Set(data.songs.map(song => song.year)).size;
    if (yearCount < needed) throw new Error(`not enough distinct release years with shared songs and previews (need ${needed})`);
    hs.pool = hsBuildPool(data.songs);
    hs.players = hs.mode === "duo" ? hs.people.slice(0, 2).map(pname) : ["You"];
    hs.scores = hs.players.map(() => 0);
    hs.turn = 0; hs.winner = null;
    const seed = hsWeightedPick();
    hs.timelines = hs.players.map(() => [{...seed, anchor: true}]);
    // hsNext advances the turn in duo mode, so compensate before the first round.
    if (hs.mode === "duo") hs.turn = hs.players.length - 1;
    hsNext();
  } catch (e) {
    if (gen !== hs.gen) return;
    $("hitster-body").innerHTML = `<p class="muted">Can't start Hitster: ${esc(e.message)}.</p>
      <div class="g-actions"><button type="button" data-hs="restart">Try again</button></div>`;
  }
}

function openHitster() {
  if (META.people.length < 2) return toast("Hitster needs at least two listening histories.");
  $("hitster-dlg").showModal();
  startHitster();
}

$("hitster-open").addEventListener("click", openHitster);
$("hitster-close").addEventListener("click", () => $("hitster-dlg").close());
$("hitster-dlg").addEventListener("close", () => { hs.gen++; hsStop(); });
$("hitster-target").addEventListener("change", e => {
  hs.target = Math.max(2, Math.min(25, Math.round(Number(e.target.value) || 10)));
  e.target.value = hs.target;
  if ($("hitster-dlg").open) startHitster();
});
$("hitster-difficulty").addEventListener("change", e => {
  if (!HS_DIFFICULTIES[e.target.value]) return;
  hs.difficulty = e.target.value;
  if ($("hitster-dlg").open) startHitster();
});
$("hitster-modes").addEventListener("click", e => {
  const button = e.target.closest("[data-hs-mode]");
  if (!button || button.dataset.hsMode === hs.mode) return;
  hs.mode = button.dataset.hsMode;
  $("hitster-modes").querySelectorAll("[data-hs-mode]").forEach(b =>
    b.setAttribute("aria-selected", String(b === button)));
  startHitster();
});
$("hitster-body").addEventListener("click", e => {
  const button = e.target.closest("[data-hs]");
  if (!button || button.disabled) return;
  const action = button.dataset.hs;
  if (action === "play") return hsPlay();
  if (action === "place") return hsPlace(+button.dataset.at);
  if (action === "next") return hsNext();
  if (action === "finish") return hsFinish();
  if (action === "restart") return startHitster();
});
