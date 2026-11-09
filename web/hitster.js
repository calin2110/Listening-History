"use strict";
// Hitster: hear a hidden shared song, then place it on a release-year timeline.

const hs = {
  mode: "solo", target: 10, pool: [], people: [], players: [], timelines: [], scores: [],
  turn: 0, current: null, revealed: false, correct: false, picked: null, winner: null,
  ctx: null, buf: null, src: null, load: null, timer: null, gen: 0,
};

function hsStop() {
  clearTimeout(hs.timer);
  hs.timer = null;
  const source = hs.src;
  hs.src = null;
  try { source?.stop(); } catch { /* already stopped */ }
  const button = $("hitster-body")?.querySelector("[data-hs='play']");
  if (button) button.textContent = "▶ Play 20-second snippet";
  const bar = $("hitster-body")?.querySelector(".hs-progress i");
  if (bar) { bar.style.transition = "none"; bar.style.width = "0"; }
}

function hsWeightedPick() {
  const total = hs.pool.reduce((n, s) => n + Math.max(s.weight || 0, 0.01), 0);
  let at = Math.random() * total;
  for (let i = 0; i < hs.pool.length; i++) {
    at -= Math.max(hs.pool[i].weight || 0, 0.01);
    if (at <= 0) return hs.pool.splice(i, 1)[0];
  }
  return hs.pool.pop();
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
    <p class="hs-note">Drawn from songs shared by <b>${esc(shared)}</b>; songs popular with everyone are more likely.
      Only one song per album can appear. The starting card anchors the timeline and does not count toward the
      ${hs.target} you need to keep.</p>
    <h3>${hs.mode === "duo" ? esc(name) + "’s turn" : "Place the mystery song"}</h3>
    <div class="hs-mystery${hs.revealed ? " heard" : ""}"><span aria-hidden="true">?</span>
      <button type="button" data-hs="play">▶ Play 20-second snippet</button><div class="hs-progress"><i></i></div>
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
    const len = Math.min(20, buffer.duration), fade = Math.min(0.02, len / 4);
    source.buffer = buffer;
    source.connect(gain).connect(hs.ctx.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + fade);
    gain.gain.setValueAtTime(0.9, now + len - fade);
    gain.gain.linearRampToValueAtTime(0, now + len);
    source.onended = () => { if (hs.src === source) hsStop(); };
    source.start(now, 0, len);
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
    if (button.isConnected) button.disabled = false;
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
  Object.assign(hs, {revealed: false, correct: false, picked: null, buf: null, load: null});
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
    if (data.songs.length < needed) throw new Error(`not enough distinct shared albums with a release year and preview (need ${needed})`);
    hs.pool = data.songs.slice();
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
