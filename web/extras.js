"use strict";
// More fun: A–Z of artists, song-title mood, one-hit wonders, telepathy and in-sync days (Insights),
// the rediscover roulette, and the "Which came first?" game.
// Uses helpers from app.js, fun.js and more.js (esc, enc, pname, color, pct, plural, cover, ttRow, moreList, …).

// ---------------------------------------------------------------- insights --
// Each section is its own function: the Insights panel shows it as soon as its data arrives.
const xWho = pid => META.people.length > 1 ? `<p class="who-h" style="--c:${color(pid)}"><b>${esc(pname(pid))}</b></p>` : "";
const xGrid = (list, fn) => `<div class="ins-grid">${list.map(p => `<div>${xWho(p.pid)}${fn(p)}</div>`).join("")}</div>`;

// telepathy and in-sync days, for each pair (extras?part=sync)
function renderTelepathy(x) {
  return x.pairs.map(pr => {
    const A = esc(pname(pr.a)), B = esc(pname(pr.b));
    const tele = pr.telepathy.length
      ? `<p>${plural(pr.telepathy_n, "time")} one of you put on a song neither had played in a month, and the other did too within the hour.</p>
         ${moreList(pr.telepathy, 4, e => ttRow(e, `${esc(pname(e.first))} → ${esc(pname(e.second))}, ${plural(e.minutes, "minute")} later`,
           esc(nice(e.day))))}`
      : `<p class="muted">No telepathy yet: you’ve never both reached for the same forgotten song within an hour.</p>`;
    const s = pr.sync;
    const sync = s ? `<p>Your most in-sync day was <b>${esc(nice(s.day))}</b>: ${plural(s.common, "song")} in common
        (${pct(s.share)} of everything either of you played that day).</p>
        <div class="xs-covers">${s.songs.map(t => `<button type="button" data-open-key="${esc(t.key)}" data-title="${esc(t.title)}"
          data-sub="${esc(t.sub)}" title="${esc(t.title)} · ${esc(t.sub)}">${cover(t.cover_key)}</button>`).join("")}</div>
        <p class="muted">${plural(pr.shared_days, "day")} with at least one song you both played.</p>` : "";
    return `<div><h3>🔮 Telepathy <span class="muted">${A} & ${B}</span></h3>${tele}
      ${sync ? `<p class="sub-h">🫂 Most in sync</p>${sync}` : ""}</div>`;
  }).join("");
}

// A–Z (extras?part=taste)
function renderAZ(x) {
  return `<div><h3>🔤 Your A–Z <span class="muted">the top artist for every letter</span></h3>${xGrid(x.people, p => {
    const by = Object.fromEntries(p.letters.map(l => [l.letter, l]));
    const covered = 26 - p.missing.length;
    return `<p>${covered === 26 ? "<b>All 26 letters.</b> A complete alphabet. 🏆" : `<b>${covered} of 26</b> letters.
      ${p.missing.length <= 6 ? `Missing: ${p.missing.join(", ")}.` : ""}`}</p>
      <div class="az">${[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", ...(by["#"] ? ["#"] : [])].map(L => {
        const l = by[L];
        return l ? `<span class="az-tile" title="${esc(l.artist)} · ${fmt(l.ms)}${l.n > 1 ? ` · ${l.n} artists` : ""}">${cover(l.cover_key)}
            <b>${L}</b><small>${esc(l.artist)}</small></span>`
          : `<span class="az-tile none"><b>${L}</b></span>`;
      }).join("")}</div>`;
  })}</div>`;
}

// title mood and words (extras?part=taste)
function renderMood(x) {
  return `<div><h3>💀 vs ☀️ <span class="muted">what your song titles are about</span></h3>${xGrid(x.people, p => {
    const d = p.dark, l = p.light, tot = d + l;
    const verdict = !tot ? "Your titles keep their feelings to themselves." : d > l * 2 ? "Mostly darkness. 🖤"
      : l > d * 2 ? "Sunshine and love songs. 🌻" : "Balanced: light and dark in equal measure.";
    const max = Math.max(1, ...p.words.map(w => w.plays));
    return `<p>${verdict}</p>
      <div class="mood"><span>💀 ${pctS(d)}</span><div class="mood-bar"><i class="dark" style="width:${tot ? d / tot * 100 : 50}%"></i><i class="light"></i></div><span>${pctS(l)} ☀️</span></div>
      <p class="muted tt-intro">Share of plays with a dark or a bright word in the title. Your most played title words:</p>
      <p class="words">${p.words.map(w => `<span style="font-size:${(0.8 + 1.1 * Math.sqrt(w.plays / max)).toFixed(2)}em;
        opacity:${(0.55 + 0.45 * w.plays / max).toFixed(2)}" title="${plural(w.plays, "play")}">${esc(w.word)}</span>`).join(" ")}</p>`;
  })}</div>`;
}

// unusual listening sessions (extras?part=unusual)
function renderUnusual(x) {
  if (x.people.some(p => p.unusual?.length)) {
    const when = u => new Date(u.day + "T00:00").toLocaleDateString(undefined, {weekday: "short", day: "numeric", month: "short", year: "numeric"})
      + (u.hour != null ? `, ${u.hour}:00` : "");
    return `<div><h3>🛸 Unusual sessions <span class="muted">listening that didn’t look like you</span></h3>${xGrid(x.people, p =>
      p.unusual?.length ? moreList(p.unusual, 4, u => `<li class="us">
        <p class="us-when"><b>${esc(when(u))}</b> <span class="muted">· ${plural(u.songs, "song")} · ${fmt(u.ms)}</span></p>
        <p class="us-tags">${u.tags.map(t => `<span class="us-tag us-${t.kind}">${t.emoji} ${esc(t.text)}</span>`).join("")}</p>
        <div class="xs-covers">${u.top.map(t => `<button type="button" data-open-key="${esc(t.key)}" data-title="${esc(t.title)}"
          data-sub="${esc(t.sub)}" title="${esc(t.title)} · ${esc(t.sub)} (${plural(t.plays_here, "play")})">${cover(t.cover_key)}</button>`).join("")}</div>
        ${u.artists.length ? `<p class="muted us-arts">${esc(u.artists.join(", "))}</p>` : ""}</li>`, "us-list")
        : `<p class="muted">Nothing out of the ordinary: you’re a creature of habit.</p>`)}</div>`;
  }
  return "";
}

// one-hit wonders (extras?part=taste)
function renderOneHit(x) {
  if (x.people.some(p => p.one_hit.length)) {
    return `<div><h3>🦄 One-hit wonders <span class="muted">artists you only know for one song</span></h3>${xGrid(x.people, p =>
      p.one_hit.length ? moreList(p.one_hit, 5, s => ttRow(s, plural(s.plays, "play"),
        s.share >= 1 ? "the only song of theirs you play" : `${pct(s.share)} of your ${plural(s.artist_plays, "play")} of them`))
        : `<p class="muted">None: when you like an artist, you dig in.</p>`)}</div>`;
  }
  return "";
}

// --------------------------------------------------------------- roulette --
const rl = {pid: null, pool: [], cur: null, spinning: false, audio: null};

function openRoulette() {
  rl.pid = state.people.includes(rl.pid) ? rl.pid : state.people[0];
  $("rl-dlg").showModal();
  loadRoulette();
}

async function loadRoulette() {
  rl.gen = (rl.gen || 0) + 1; rl.spinning = false;
  $("rl-body").innerHTML = `<p class="muted">Digging through the archive…</p>`;
  try {
    const q = new URLSearchParams({people: rl.pid, minplay: state.minplay ? 30 : 0});
    rl.pool = (await getJSON("/api/roulette?" + q)).songs;
    rl.cur = null;
    renderRoulette();
    if (rl.pool.length) spinRoulette();
  } catch (e) {
    $("rl-body").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function renderRoulette() {
  const s = rl.cur;
  const people = state.people.length > 1 ? `<label class="g-who">Whose archive? <select id="rl-person">${state.people.map(p =>
    `<option value="${p}" ${p === rl.pid ? "selected" : ""}>${esc(pname(p))}</option>`).join("")}</select></label>` : "";
  if (!rl.pool.length) {
    $("rl-body").innerHTML = `${people}<p class="muted">Nothing to rediscover: there’s no song with 8+ plays that went quiet for over a year.</p>`;
    return;
  }
  $("rl-body").innerHTML = `${people}
    <div class="rl-window"><div class="rl-reel" id="rl-reel">${s ? cover(s.cover_key, "rl-cover") : ""}</div></div>
    <div class="rl-info" id="rl-info">${s && !rl.spinning ? `<p class="g-title">${esc(s.title)}</p><p class="muted">${esc(s.sub)}</p>
      <p>You played it <b>${plural(s.plays, "time")}</b>, then nothing for <b>${s.years >= 2 ? Math.floor(s.years) + " years" : Math.round(s.years * 12) + " months"}</b>
        (last on ${esc(nice(s.last))}).</p>` : `<p class="muted">Spinning…</p>`}</div>
    <div class="g-actions">
      <button type="button" data-rl="spin" ${rl.spinning ? "disabled" : ""}>🎰 Spin again</button>
      ${s && !rl.spinning ? `<button type="button" class="ghost" data-rl="play">▶ Preview</button>
        <button type="button" class="ghost" data-rl="open">Open song</button>` : ""}
    </div>`;
}

function spinRoulette() {
  if (rl.spinning || !rl.pool.length) return;
  rlStop();
  rl.spinning = true;
  const pool = rl.pool, gen = rl.gen = (rl.gen || 0) + 1;     // a new person or a closed dialog stops the spin
  const pickIt = pool[Math.floor(Math.random() * pool.length)];
  rl.cur = pickIt;
  renderRoulette();
  let n = 0, delay = 40;
  const total = 20 + Math.floor(Math.random() * 5);
  const step = () => {
    if (gen !== rl.gen) return;
    n++;
    const s = n >= total ? pickIt : pool[Math.floor(Math.random() * pool.length)];
    $("rl-reel").innerHTML = cover(s.cover_key, "rl-cover") + `<span class="rl-flash">${esc(s.title)}</span>`;
    if (n >= total) { rl.spinning = false; renderRoulette(); $("rl-reel").classList.add("landed"); return; }
    delay *= 1.08;
    setTimeout(step, delay);
  };
  step();
}

function rlStop() { if (rl.audio) rl.audio.pause(); }
$("rl-dlg").addEventListener("close", () => { rl.gen = (rl.gen || 0) + 1; rl.spinning = false; });

$("rl-open").addEventListener("click", openRoulette);
$("rl-close").addEventListener("click", () => $("rl-dlg").close());
$("rl-dlg").addEventListener("close", rlStop);
$("rl-body").addEventListener("change", e => { if (e.target.id === "rl-person") { rl.pid = +e.target.value; loadRoulette(); } });
$("rl-body").addEventListener("click", e => {
  const a = e.target.closest("[data-rl]")?.dataset.rl;
  if (a === "spin") spinRoulette();
  if (a === "play" && rl.cur) {
    rl.audio ??= new Audio();
    rl.audio.src = "/api/preview?audio=1&k=" + enc(rl.cur.key);
    rl.audio.play().catch(() => toast("No preview for this one."));
  }
  if (a === "open" && rl.cur) openDetail({key: rl.cur.key, cover_key: rl.cur.cover_key, kind: "track", title: rl.cur.title, sub: rl.cur.sub});
});

// --------------------------------------------------- game: which came first --
// Four songs: click them in the order you first played them, oldest first.
const wf = {rounds: 5, round: 0, score: 0, pool: [], cur: [], picks: []};

async function startOrder() {
  game.pid = state.people.includes(game.pid) ? game.pid : state.people[0];
  gameBox().innerHTML = `<p class="muted">Finding your first plays…</p>`;
  try {
    wf.pool = (await poolFor(game.pid, 300)).filter(s => s.first);
    if (wf.pool.length < 12) throw new Error("not enough songs in this time frame; pick a wider one");
    wf.round = 0; wf.score = 0;
    nextOrder();
  } catch (e) {
    gameBox().innerHTML = `${pickPerson("Whose songs?")}<p class="muted">Can't start the game: ${esc(e.message)}.</p>`;
  }
}

function nextOrder() {
  // four songs first played at least a month apart, so the answer is clear
  for (let tries = 0; tries < 50; tries++) {
    const four = [];
    for (const s of choose(wf.pool, wf.pool.length)) {
      const t = Date.parse(s.first);
      if (four.every(x => Math.abs(Date.parse(x.first) - t) >= 30 * 864e5)) four.push(s);
      if (four.length === 4) break;
    }
    if (four.length === 4) { wf.cur = four; break; }
  }
  wf.picks = [];
  renderOrder();
}

function renderOrder() {
  const done = wf.picks.length === wf.cur.length;
  const right = [...wf.cur].sort((a, b) => a.first.localeCompare(b.first));
  const got = done ? wf.picks.filter((k, i) => right[i].key === k).length : 0;
  gameBox().innerHTML = `${pickPerson("Whose songs?")}
    <p class="g-q">Round ${wf.round + 1} of ${wf.rounds}: tap them in the order you first played them, oldest first.</p>
    <div class="wf-cards">${wf.cur.map(s => {
      const at = wf.picks.indexOf(s.key), pos = right.indexOf(s);
      const cls = done ? (right[at]?.key === s.key ? "ok" : "bad") : at >= 0 ? "picked" : "";
      return `<button type="button" class="wf-card ${cls}" data-wf="${esc(s.key)}" ${done || at >= 0 ? "disabled" : ""}>
        ${at >= 0 ? `<span class="wf-n">${at + 1}</span>` : ""}${cover(s.cover_key)}
        <b>${esc(s.title)}</b><small>${esc(s.sub)}</small>
        ${done ? `<small class="wf-date">#${pos + 1} · ${esc(nice(s.first))}</small>` : ""}</button>`;
    }).join("")}</div>
    <div class="g-actions">${done ? `<p class="g-result ${got === 4 ? "ok" : got >= 2 ? "" : "bad"}">${got === 4 ? "Perfect order! 🎯" : `${got} of 4 in the right place.`}</p>
      <button type="button" data-wf-next>${wf.round + 1 >= wf.rounds ? "See your score" : "Next round"}</button>`
      : wf.picks.length ? `<button type="button" class="ghost" data-wf-undo>Undo</button>` : ""}</div>
    <p class="g-score">Score ${wf.score} / ${wf.round * 4 + (done ? 4 : 0)}</p>`;
}

function finishOrder() {
  const key = "order:" + pname(game.pid), max = wf.rounds * 4;
  saveBest(key, wf.score);
  gameBox().innerHTML = `<div class="g-final"><p class="huge">${wf.score} / ${max}</p>
    <p class="big-line">${wf.score >= max * 0.85 ? "A walking music diary. 📔" : wf.score >= max * 0.5 ? "You know your history." : "It all blurs together, doesn’t it?"}</p>
    <p class="g-score">Best ${bestScore(key)} / ${max}</p><div class="g-actions"><button type="button" data-g="again">Play again</button></div></div>`;
}

EXTRA_GAMES.order = startOrder;
$("game-stage").addEventListener("click", e => {
  if (game.mode !== "order") return;
  const card = e.target.closest("[data-wf]");
  if (card) {
    wf.picks.push(card.dataset.wf);
    if (wf.picks.length === wf.cur.length) {
      const right = [...wf.cur].sort((a, b) => a.first.localeCompare(b.first));
      wf.score += wf.picks.filter((k, i) => right[i].key === k).length;
    }
    return renderOrder();
  }
  if (e.target.closest("[data-wf-undo]")) { wf.picks.pop(); return renderOrder(); }
  if (e.target.closest("[data-wf-next]")) {
    wf.round++;
    return wf.round >= wf.rounds ? finishOrder() : nextOrder();
  }
});
