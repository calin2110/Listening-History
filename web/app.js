"use strict";

const $ = id => document.getElementById(id);
const state = {
  frame: "all", from: "", to: "", q: "", sort: "total", min: 20, decay: 0, size: 48, page: 1,
  people: [], weights: {}, by: "plays", common: true,       // multi-person
  formula: "entropy", norm: false,
};
let META = {people: [], years: []}, items = [], lastData = null, ctrl = null;

// ---------------------------------------------------------------- helpers --
const PRESETS = {  // months back, headline phrase
  "1m": [1, "in the last month"], "3m": [3, "in the last 3 months"], "6m": [6, "in the last 6 months"],
  "1y": [12, "in the last year"], "2y": [24, "in the last 2 years"], "5y": [60, "in the last 5 years"],
};
// slider stops: [half-life in days, label]; 0 = no decay
const DECAY = [[0, "Off"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"], [91, "3 months"],
               [182, "6 months"], [365, "1 year"], [730, "2 years"], [1826, "5 years"]];
const COLORS = ["#e8590c", "#7048e8", "#d6336c", "#0c8599", "#f59f00", "#5c7cfa", "#2f9e44", "#868e96"];
const BY_LABEL = {plays: "plays", minutes: "minutes", score: "points"};
const FORMULAS = ["entropy", "logsum", "harmonic"];

const enc = encodeURIComponent;
const decayOn = () => state.decay > 0;
const joint = () => state.people.length > 1;
const color = pid => COLORS[pid % COLORS.length];
const pname = pid => META.people[pid]?.name ?? "Person " + (pid + 1);
const weight = pid => state.weights[pid] ?? 1;

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function niceDay(s) {
  return new Date(s + "T00:00").toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"});
}
function fmt(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return Math.round(ms / 1000) + "s";
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60), r = m % 60;
  return h.toLocaleString() + " h" + (r ? " " + r + " min" : "");
}
function hours(ms) { return (ms / 3.6e6).toLocaleString(undefined, {maximumFractionDigits: ms < 3.6e7 ? 1 : 0}) + " hours"; }
function jointFmt(v) { return v.toLocaleString(undefined, {maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0}); }
function pts(v) { return v.toLocaleString(undefined, {maximumFractionDigits: v < 100 ? 1 : 0}); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
function listNames(pids) {
  const n = pids.map(pname);
  return n.length <= 1 ? (n[0] || "") : n.slice(0, -1).join(", ") + " & " + n[n.length - 1];
}
// generic stacked bar: parts = [[value, cssColor], ...]
function bar(parts) {
  const t = parts.reduce((a, [v]) => a + v, 0) || 1;
  return parts.map(([v, c]) => `<i style="width:${v / t * 100}%;--c:${c}"></i>`).join("");
}
const sourceBar = (sp, td) => bar([[sp, "var(--spotify)"], [td, "var(--tidal)"]]);
// one person's value in the measure the joint score uses
function measure(p) {
  if (!p) return 0;
  return state.by === "plays" ? p.plays : state.by === "minutes" ? p.ms / 60000 : p.score;
}
function measureText(p) {
  if (!p) return "not played";
  if (state.by === "plays") return p.plays.toLocaleString() + (p.plays === 1 ? " play" : " plays");
  if (state.by === "minutes") return fmt(p.ms);
  return pts(p.score) + " pts";
}

// ------------------------------------------------------------ time frames --
function rangeFor(frame) {
  if (frame === "all") return ["", ""];
  if (PRESETS[frame]) {
    const to = new Date(), from = new Date();
    from.setMonth(from.getMonth() - PRESETS[frame][0]);
    return [isoDay(from), isoDay(to)];
  }
  if (/^y\d{4}$/.test(frame)) return [frame.slice(1) + "-01-01", frame.slice(1) + "-12-31"];
  return [state.from, state.to];                        // custom
}

function frameLabel() {
  if (PRESETS[state.frame]) return PRESETS[state.frame][1];
  if (/^y\d{4}$/.test(state.frame)) return "in " + state.frame.slice(1);
  if (state.frame === "custom" && (state.from || state.to)) {
    if (state.from && state.to) return `from ${niceDay(state.from)} to ${niceDay(state.to)}`;
    return state.from ? `since ${niceDay(state.from)}` : `until ${niceDay(state.to)}`;
  }
  return META.first ? "since " + META.first.slice(0, 4) : "of all time";
}

function subject() {
  if (META.people.length <= 1 && (!META.people.length || pname(0) === "Me")) return "I";
  return listNames(state.people);
}

function setFrame(frame, from, to) {
  state.frame = frame;
  [state.from, state.to] = frame === "custom" ? [from, to] : rangeFor(frame);
  if (state.from && state.to && state.from > state.to) [state.from, state.to] = [state.to, state.from];
  state.page = 1;
  syncUI();
  load();
}

// ------------------------------------------------------------- UI syncing --
function syncUI() {
  document.querySelectorAll(".frames button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.frame === state.frame)));
  const isYear = /^y\d{4}$/.test(state.frame);
  $("year").value = isYear ? state.frame.slice(1) : "";
  $("year").classList.toggle("active", isYear);
  document.querySelector(".custom").classList.toggle("active", state.frame === "custom");
  $("from").value = state.from;
  $("to").value = state.to;
  $("headline").textContent = `What ${subject()} listened to ${frameLabel()}`;

  // people chips
  if (META.people.length > 1) {
    $("people").hidden = false;
    $("people").innerHTML = META.people.map((p, pid) => {
      const on = state.people.includes(pid);
      return `<button type="button" data-pid="${pid}" style="--c:${color(pid)}" aria-pressed="${on}"
        ${on && state.people.length === 1 ? 'disabled title="At least one person stays selected"' : ""}>${esc(p.name)}</button>`;
    }).join("");
  }

  // joint panel
  $("joint").hidden = !joint();
  if (joint()) {
    $("by").value = state.by;
    $("formula").value = state.formula;
    $("common").checked = state.common;
    $("norm").checked = state.norm;
    $("weights").innerHTML = state.people.map(pid => `
      <label class="who-name" for="w${pid}" style="--c:${color(pid)}">${esc(pname(pid))}</label>
      <input type="range" id="w${pid}" data-pid="${pid}" min="0" max="3" step="0.1" value="${weight(pid)}" style="--c:${color(pid)}">
      <output for="w${pid}">${weight(pid).toFixed(1)}</output>`).join("");
    syncFormula();
  }

  // sort options depend on solo vs joint
  const opts = joint()
    ? [["joint", "Joint score"], ...state.people.map(pid => ["p" + pid, `Most ${BY_LABEL[state.by]} by ${pname(pid)}`]),
       ["score", "Top points (with decay), combined"], ["total", "Most time, combined"]]
    : [["score", "Top score (with decay)"], ["total", "Most played (both)"]];
  opts.push(["spotify", "Most played on Spotify"], ["tidal", "Most played on Tidal"], ["plays", "Most plays"],
            ["last", "Recently played"], ["artist", "Artist A–Z"], ["title", "Track A–Z"]);
  if (!opts.some(([v]) => v === state.sort)) state.sort = defaultSort();
  $("sort").innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("sort").value = state.sort;

  $("q").value = state.q;
  $("min").value = String(state.min);
  $("size").value = String(state.size);
  $("decay").value = String(state.decay);
  $("decay-val").textContent = DECAY[state.decay][1];
}

function syncFormula() {
  const by = BY_LABEL[state.by];
  const val = pid => `${pname(pid)}’s ${by}`;
  const w = pid => weight(pid).toFixed(1);
  let text;
  if (state.formula === "logsum") {
    text = "Joint score = " + state.people.map(pid => `${w(pid)} × log(1 + ${val(pid)})`).join(" + ") + ".";
  } else if (state.formula === "harmonic") {
    text = `Joint score = (${state.people.map(w).join(" + ")}) / (` +
      state.people.map(pid => `${w(pid)} / ${val(pid)}`).join(" + ") +
      "). Anyone at zero makes it zero, so it follows whoever listened least.";
  } else {
    text = "Joint score = " + state.people.map(pid => `${w(pid)} × ${val(pid)} × log(1 / P(${pname(pid)}))`).join(" + ") +
      `, where P(x) is x’s share of the song’s ${by}. Nobody can carry a song alone.`;
  }
  if (state.norm) text += ` Each person’s ${by} are first divided by their own total in this time frame.`;
  let note = "";
  if (state.by === "score" && !decayOn()) note = " With decay off, points are the same as minutes.";
  if (state.by !== "score" && decayOn()) note = " Decay only changes the ranking when comparing by points.";
  $("formula-text").textContent = text + note;
}

function defaultSort() { return joint() ? "joint" : decayOn() ? "score" : "total"; }

// ---------------------------------------------------------------- loading --
async function load() {
  ctrl?.abort();
  const mine = ctrl = new AbortController();
  $("grid").setAttribute("aria-busy", "true");
  const p = new URLSearchParams({
    from: state.from, to: state.to, q: state.q, sort: state.sort, min: state.min,
    half: DECAY[state.decay][0], page: state.page, size: state.size,
    people: state.people.join(","), w: state.people.map(weight).join(","),
    by: state.by, common: state.common ? 1 : 0, formula: state.formula, norm: state.norm ? 1 : 0,
  });
  try {
    const r = await fetch("/api/tracks?" + p, {signal: mine.signal});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    state.page = d.page;
    render(d);
  } catch (e) {
    if (e.name === "AbortError") return;
    $("grid").innerHTML = `<li class="empty">Couldn't load tracks (${esc(e.message)}). Check that server.py is still running, then reload the page.</li>`;
    $("pager").innerHTML = "";
  } finally {
    if (ctrl === mine) $("grid").removeAttribute("aria-busy");
  }
  writeHash();
}

function render(d) {
  lastData = d;
  const t = d.totals, sel = d.people, isJoint = sel.length > 1;
  const total = t.spotify + t.tidal;

  // header totals + big bar
  if (!t.tracks) {
    $("totals").innerHTML = "";
  } else if (isJoint) {
    $("totals").innerHTML =
      `<span><b>${hours(total)}</b> across <b>${t.tracks.toLocaleString()}</b> ${state.common ? "songs in common" : "songs"}</span>` +
      sel.map((pid, j) => `<span class="legend" style="--c:${color(pid)}">${esc(pname(pid))} ${hours(t.people[j].ms)}, ` +
        `${t.people[j].plays.toLocaleString()} plays</span>`).join("");
  } else {
    $("totals").innerHTML =
      `<span><b>${hours(total)}</b> across <b>${t.tracks.toLocaleString()}</b> tracks and ${t.plays.toLocaleString()} plays</span>` +
      `<span class="legend" style="--c:var(--spotify)">Spotify ${hours(t.spotify)}</span>` +
      `<span class="legend" style="--c:var(--tidal)">Tidal ${hours(t.tidal)}</span>` +
      (decayOn() ? `<span>Score <b>${pts(t.score)}</b></span>` : "");
  }
  $("bigsplit").innerHTML = isJoint ? bar(sel.map((pid, j) => [t.people[j].ms, color(pid)])) : sourceBar(t.spotify, t.tidal);

  $("decay-note").textContent = decayOn()
    ? `A minute played ${DECAY[state.decay][1]} before ${niceDay(d.ref)} counts half as much, ` +
      `${DECAY[state.decay][1]} before that a quarter, and so on. Score = weighted minutes.`
    : "Every minute counts the same. Slide to make recent listening count more.";

  const extra = [];
  if (t.hidden) extra.push(`${t.hidden.toLocaleString()} shorter hidden`);
  if (isJoint && t.not_common) extra.push(`${t.not_common.toLocaleString()} not shared`);
  $("count").textContent = (d.matched === t.tracks
    ? `${t.tracks.toLocaleString()} ${isJoint ? "songs" : "tracks"}`
    : `${d.matched.toLocaleString()} of ${t.tracks.toLocaleString()}`) + (extra.length ? ", " + extra.join(", ") : "");

  // grid
  items = d.items;
  const start = (d.page - 1) * d.size;
  let empty = null;
  if (!t.tracks && isJoint && state.common && t.not_common) {
    empty = `${listNames(sel)} have no songs in common in this time frame${t.hidden ? " that reach the minimum time" : ""}. ` +
            `${t.not_common.toLocaleString()} songs were played by only some of you. ` +
            `Untick “Only songs everyone played”, pick a wider frame, or lower the minimum.`;
  } else if (!t.tracks && t.hidden) {
    empty = `No track reached ${$("min").selectedOptions[0].text.toLowerCase()} in this time frame ` +
            `(${t.hidden.toLocaleString()} shorter ones are hidden). Lower the minimum or pick a wider frame.`;
  } else if (!t.tracks) {
    const range = META.first ? ` The history runs from ${niceDay(META.first)} to ${niceDay(META.last)}.` : "";
    empty = `Nothing was played in this time frame.${range} Pick a wider frame or a different year.`;
  } else if (!items.length) {
    empty = `No tracks match “${state.q}” in this time frame. Try a shorter search or a wider frame.`;
  }
  if (empty) {
    $("grid").innerHTML = `<li class="empty">${esc(empty)}</li>`;
  } else {
    $("grid").innerHTML = items.map((r, i) => {
      let stats;
      if (isJoint) {
        stats = `<div class="time"><b>${jointFmt(r.joint)}</b><span>joint score</span></div>
          <ul class="who">${sel.map((pid, j) => `<li class="${r.per[j] ? "" : "none"}" style="--c:${color(pid)}">
            <span>${esc(pname(pid))}</span><span>${measureText(r.per[j])}</span></li>`).join("")}</ul>
          <div class="split" title="Share of ${BY_LABEL[state.by]}">${bar(sel.map((pid, j) => [measure(r.per[j]), color(pid)]))}</div>`;
      } else {
        stats = `<div class="time">${decayOn()
            ? `<b>${pts(r.score)} pts</b><span>${fmt(r.total)}</span>`
            : `<b>${fmt(r.total)}</b><span>${r.plays.toLocaleString()} plays</span>`}</div>
          <div class="split" title="Spotify ${fmt(r.spotify)} / Tidal ${fmt(r.tidal)}">${sourceBar(r.spotify, r.tidal)}</div>`;
      }
      return `<li class="item">
        <button type="button" class="cover" data-i="${i}" aria-label="Lyrics for ${esc(r.title)} by ${esc(r.artist)}">
          <span class="ph">${esc((r.artist[0] || "?").toUpperCase())}</span>
          <img src="/api/cover?k=${enc(r.key)}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="rank">${start + i + 1}</span><span class="hint">Show lyrics</span>
        </button>
        <div class="meta">
          <div class="title" title="${esc(r.title)}">${esc(r.title)}</div>
          <div class="artist" title="${esc(r.artist)}">${esc(r.artist)}</div>
          ${stats}
        </div></li>`;
    }).join("");
  }
  renderPager(d.page, d.pages);
}

function renderPager(page, pages) {
  if (pages <= 1) { $("pager").innerHTML = ""; return; }
  const list = [...new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2])]
    .filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = `<button type="button" data-p="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`;
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) html += `<span class="gap">…</span>`;
    html += `<button type="button" data-p="${n}" ${n === page ? 'aria-current="page"' : ""}>${n}</button>`;
  });
  html += `<button type="button" data-p="${page + 1}" ${page === pages ? "disabled" : ""} aria-label="Next page">›</button>`;
  $("pager").innerHTML = html;
}

// ------------------------------------------------------------- URL state --
function writeHash() {
  const h = {f: state.frame, q: state.q, s: state.sort, m: state.min, d: state.decay, n: state.size, p: state.page};
  if (state.frame === "custom") Object.assign(h, {from: state.from, to: state.to});
  if (META.people.length > 1) {
    Object.assign(h, {ppl: state.people.join(","), w: state.people.map(weight).join(","),
                      by: state.by, c: state.common ? 1 : 0, fx: state.formula, nm: state.norm ? 1 : 0});
  }
  history.replaceState(null, "", "#" + new URLSearchParams(h));
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const f = h.get("f") || "all";
  state.frame = (f === "all" || f === "custom" || PRESETS[f] || /^y\d{4}$/.test(f)) ? f : "all";
  if (state.frame === "custom") { state.from = h.get("from") || ""; state.to = h.get("to") || ""; }
  else [state.from, state.to] = rangeFor(state.frame);  // presets roll with today's date
  state.q = h.get("q") || "";
  if (h.get("s")) state.sort = h.get("s");
  if (h.has("m") && !isNaN(+h.get("m"))) state.min = +h.get("m");
  if (DECAY[+h.get("d")]) state.decay = +h.get("d");
  if (+h.get("n")) state.size = +h.get("n");
  if (+h.get("p")) state.page = +h.get("p");

  const n = META.people.length;
  const ppl = (h.get("ppl") || "").split(",").filter(x => x !== "").map(Number)
    .filter((x, i, a) => Number.isInteger(x) && x >= 0 && x < n && a.indexOf(x) === i);
  state.people = ppl.length ? ppl : [...Array(Math.max(n, 1)).keys()];   // default: everyone
  const w = (h.get("w") || "").split(",").map(x => x.trim() === "" ? NaN : Number(x));
  state.people.forEach((pid, i) => { if (Number.isFinite(w[i]) && w[i] >= 0) state.weights[pid] = w[i]; });
  if (BY_LABEL[h.get("by")]) state.by = h.get("by");
  if (h.has("c")) state.common = h.get("c") !== "0";
  if (FORMULAS.includes(h.get("fx"))) state.formula = h.get("fx");
  if (h.has("nm")) state.norm = h.get("nm") === "1";
  if (!h.get("s")) state.sort = defaultSort();
}

// ----------------------------------------------------------------- lyrics --
const lyricCache = new Map();
let current = null;

async function openLyrics(r) {
  current = r;
  const sel = lastData?.people || [];
  const img = $("dlg-img");
  img.style.visibility = "hidden";
  img.onload = () => { img.style.visibility = "visible"; };
  img.src = "/api/cover?k=" + enc(r.key);
  $("dlg-title").textContent = r.title;
  $("dlg-sub").textContent = r.artist + (r.album ? " — " + r.album : "");
  const who = sel.length > 1
    ? `<span>Joint score ${jointFmt(r.joint)}</span>` + sel.map((pid, j) => {
        const p = r.per[j];
        return `<span>${esc(pname(pid))}: ${p ? `${p.plays.toLocaleString()} plays, ${fmt(p.ms)}${decayOn() ? `, ${pts(p.score)} pts` : ""}` : "not played"}</span>`;
      }).join("")
    : (decayOn() ? `<span>Score ${pts(r.score)}</span>` : "") +
      `<span>Spotify ${fmt(r.spotify)}</span><span>Tidal ${fmt(r.tidal)}</span>`;
  $("dlg-foot").innerHTML = who +
    (r.first ? `<span>${r.first === r.last ? "Played " + niceDay(r.first) : niceDay(r.first) + " to " + niceDay(r.last)}</span>` : "") +
    (r.spotify_url ? `<a href="${esc(r.spotify_url)}" target="_blank" rel="noopener">Open in Spotify</a>` : "") +
    `<a href="https://genius.com/search?q=${enc(r.artist + " " + r.title)}" target="_blank" rel="noopener">Search on Genius</a>`;

  const box = $("dlg-lyrics");
  box.className = "lyrics status";
  box.textContent = "Loading lyrics…";
  $("dlg").showModal();
  try {
    let text = lyricCache.get(r.key);
    if (text === undefined) {
      const res = await fetch("/api/lyrics?k=" + enc(r.key));
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "HTTP " + res.status);
      text = d.text;
      lyricCache.set(r.key, text);
    }
    if (current !== r) return;
    box.className = text ? "lyrics" : "lyrics status";
    box.textContent = text || "No lyrics found on lrclib.net for this track. The Genius link below may have them.";
  } catch (e) {
    if (current !== r) return;
    box.textContent = `Couldn't load lyrics (${e.message}). Close this and click the cover again to retry.`;
  }
  box.scrollTop = 0;
}

// ----------------------------------------------------------------- events --
const reload = () => { state.page = 1; load(); };
let timer;
const reloadSoon = () => { clearTimeout(timer); timer = setTimeout(reload, 200); };

document.querySelectorAll(".frames button").forEach(b =>
  b.addEventListener("click", () => setFrame(b.dataset.frame)));
$("year").addEventListener("change", e => e.target.value ? setFrame("y" + e.target.value) : setFrame("all"));
["from", "to"].forEach(id => $(id).addEventListener("change", () => setFrame("custom", $("from").value, $("to").value)));

$("people").addEventListener("click", e => {
  const b = e.target.closest("button[data-pid]");
  if (!b || b.disabled) return;
  const pid = +b.dataset.pid, wasJoint = joint(), defaultBefore = state.sort === defaultSort();
  state.people = state.people.includes(pid)
    ? state.people.filter(x => x !== pid)
    : [...state.people, pid].sort((a, b) => a - b);
  // switching between solo and joint resets a default sort to the new default
  if (wasJoint !== joint() && (defaultBefore || ["total", "score", "joint"].includes(state.sort))) state.sort = defaultSort();
  syncUI();
  reload();
});

$("by").addEventListener("change", e => { state.by = e.target.value; syncUI(); reload(); });
$("common").addEventListener("change", e => { state.common = e.target.checked; reload(); });
$("formula").addEventListener("change", e => { state.formula = e.target.value; syncFormula(); reload(); });
$("norm").addEventListener("change", e => { state.norm = e.target.checked; syncFormula(); reload(); });
$("weights").addEventListener("input", e => {
  if (e.target.type !== "range") return;
  const pid = +e.target.dataset.pid;
  state.weights[pid] = +e.target.value;
  e.target.nextElementSibling.textContent = state.weights[pid].toFixed(1);
  syncFormula();
  reloadSoon();
});

$("decay").addEventListener("input", e => {
  const was = decayOn();
  state.decay = +e.target.value;
  $("decay-val").textContent = DECAY[state.decay][1];
  if (!joint()) {          // solo: switch between ranking by score and by raw time
    if (!was && decayOn() && state.sort === "total") state.sort = "score";
    if (was && !decayOn() && state.sort === "score") state.sort = "total";
    $("sort").value = state.sort;
  } else if (!was && decayOn() && state.by !== "score") {
    state.by = "score";    // joint: decay only matters when comparing by points
    syncUI();
  }
  if (joint()) syncFormula();
  reloadSoon();
});

$("q").addEventListener("input", e => { state.q = e.target.value; clearTimeout(timer); timer = setTimeout(reload, 200); });
$("sort").addEventListener("change", e => { state.sort = e.target.value; reload(); });
$("min").addEventListener("change", e => { state.min = +e.target.value; reload(); });
$("size").addEventListener("change", e => { state.size = +e.target.value; reload(); });
$("pager").addEventListener("click", e => {
  const b = e.target.closest("button[data-p]");
  if (!b || b.disabled) return;
  state.page = +b.dataset.p;
  load();
  window.scrollTo({top: $("grid").offsetTop - 80});
});
$("grid").addEventListener("click", e => {
  const b = e.target.closest(".cover");
  if (b) openLyrics(items[+b.dataset.i]);
});
// covers that can't be found: drop the <img> so the letter placeholder shows
$("grid").addEventListener("error", e => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
$("dlg-close").addEventListener("click", () => $("dlg").close());
$("dlg").addEventListener("click", e => { if (e.target === $("dlg")) $("dlg").close(); });

// ------------------------------------------------------------------- init --
(async () => {
  try {
    META = await (await fetch("/api/meta")).json();
    $("year").insertAdjacentHTML("beforeend",
      META.years.slice().reverse().map(y => `<option value="${y}">${y}</option>`).join(""));
    if (META.first) { $("from").min = $("to").min = META.first; $("from").max = $("to").max = META.last; }
  } catch { /* the tracks request below will show the error */ }
  readHash();
  syncUI();
  load();
})();
