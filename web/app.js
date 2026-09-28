"use strict";

const $ = id => document.getElementById(id);
const state = {frame: "all", from: "", to: "", q: "", sort: "total", min: 20, decay: 0, size: 48, page: 1};
let META = null, items = [], ctrl = null;

// ---------------------------------------------------------------- helpers --
const PRESETS = {  // months back, headline phrase
  "1m": [1, "in the last month"], "3m": [3, "in the last 3 months"], "6m": [6, "in the last 6 months"],
  "1y": [12, "in the last year"], "2y": [24, "in the last 2 years"], "5y": [60, "in the last 5 years"],
};

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
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
function splitBar(sp, td) {
  const t = sp + td || 1;
  return `<i class="sp" style="width:${sp / t * 100}%"></i><i class="td" style="width:${td / t * 100}%"></i>`;
}
const enc = encodeURIComponent;

// slider stops: [half-life in days, label]; 0 = no decay
const DECAY = [[0, "Off"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"], [91, "3 months"],
               [182, "6 months"], [365, "1 year"], [730, "2 years"], [1826, "5 years"]];
const decayOn = () => state.decay > 0;
function pts(v) { return v.toLocaleString(undefined, {maximumFractionDigits: v < 100 ? 1 : 0}); }

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
  return META?.first ? "since " + META.first.slice(0, 4) : "of all time";
}

function setFrame(frame, from, to) {
  state.frame = frame;
  [state.from, state.to] = frame === "custom" ? [from, to] : rangeFor(frame);
  if (state.from && state.to && state.from > state.to) [state.from, state.to] = [state.to, state.from];
  state.page = 1;
  syncFrameUI();
  load();
}

function syncFrameUI() {
  document.querySelectorAll(".frames button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.frame === state.frame)));
  const isYear = /^y\d{4}$/.test(state.frame);
  $("year").value = isYear ? state.frame.slice(1) : "";
  $("year").classList.toggle("active", isYear);
  document.querySelector(".custom").classList.toggle("active", state.frame === "custom");
  $("from").value = state.from;
  $("to").value = state.to;
  $("headline").textContent = "What I listened to " + frameLabel();
}

// ---------------------------------------------------------------- loading --
async function load() {
  ctrl?.abort();
  const mine = ctrl = new AbortController();
  $("grid").setAttribute("aria-busy", "true");
  const p = new URLSearchParams({from: state.from, to: state.to, q: state.q, sort: state.sort, min: state.min,
                                 half: DECAY[state.decay][0],
                                 page: state.page, size: state.size});
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
  const t = d.totals;
  $("totals").innerHTML = t.tracks
    ? `<span><b>${hours(t.spotify + t.tidal)}</b> across <b>${t.tracks.toLocaleString()}</b> tracks and ${t.plays.toLocaleString()} plays</span>` +
      `<span class="legend" style="--c:var(--spotify)">Spotify ${hours(t.spotify)}</span>` +
      `<span class="legend" style="--c:var(--tidal)">Tidal ${hours(t.tidal)}</span>` +
      (decayOn() ? `<span>Score <b>${pts(t.score)}</b></span>` : "")
    : "";
  $("decay-note").textContent = decayOn()
    ? `A minute played ${DECAY[state.decay][1]} before ${niceDay(d.ref)} counts half as much, ` +
      `${DECAY[state.decay][1]} before that a quarter, and so on. Score = weighted minutes.`
    : "Every minute counts the same. Slide to make recent listening count more.";
  $("bigsplit").innerHTML = splitBar(t.spotify, t.tidal);
  $("count").textContent = (d.matched === t.tracks
    ? `${t.tracks.toLocaleString()} tracks` : `${d.matched.toLocaleString()} of ${t.tracks.toLocaleString()}`) +
    (t.hidden ? `, ${t.hidden.toLocaleString()} shorter hidden` : "");

  items = d.items;
  const start = (d.page - 1) * d.size;
  if (!t.tracks && t.hidden) {
    $("grid").innerHTML = `<li class="empty">No track reached ${esc($("min").selectedOptions[0].text.toLowerCase())} in this time frame (${t.hidden.toLocaleString()} shorter ones are hidden). Lower the minimum or pick a wider frame.</li>`;
  } else if (!t.tracks) {
    const range = META?.first ? ` Your history runs from ${niceDay(META.first)} to ${niceDay(META.last)}.` : "";
    $("grid").innerHTML = `<li class="empty">Nothing was played in this time frame.${esc(range)} Pick a wider frame or a different year.</li>`;
  } else if (!items.length) {
    $("grid").innerHTML = `<li class="empty">No tracks match “${esc(state.q)}” in this time frame. Try a shorter search or a wider frame.</li>`;
  } else {
    $("grid").innerHTML = items.map((r, i) => `<li class="item">
      <button type="button" class="cover" data-i="${i}" aria-label="Lyrics for ${esc(r.title)} by ${esc(r.artist)}">
        <span class="ph">${esc((r.artist[0] || "?").toUpperCase())}</span>
        <img src="/api/cover?k=${enc(r.key)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="rank">${start + i + 1}</span><span class="hint">Show lyrics</span>
      </button>
      <div class="meta">
        <div class="title" title="${esc(r.title)}">${esc(r.title)}</div>
        <div class="artist" title="${esc(r.artist)}">${esc(r.artist)}</div>
        <div class="time">${decayOn()
          ? `<b>${pts(r.score)} pts</b><span>${fmt(r.total)}</span>`
          : `<b>${fmt(r.total)}</b><span>${r.plays.toLocaleString()} plays</span>`}</div>
        <div class="split" title="Spotify ${fmt(r.spotify)} / Tidal ${fmt(r.tidal)}">${splitBar(r.spotify, r.tidal)}</div>
      </div></li>`).join("");
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
  $("q").value = state.q; $("sort").value = state.sort; $("min").value = String(state.min);
  $("decay").value = String(state.decay); $("decay-val").textContent = DECAY[state.decay][1]; $("size").value = String(state.size);
}

// ----------------------------------------------------------------- lyrics --
const lyricCache = new Map();
let current = null;

async function openLyrics(r) {
  current = r;
  const img = $("dlg-img");
  img.style.visibility = "hidden";
  img.onload = () => { img.style.visibility = "visible"; };
  img.src = "/api/cover?k=" + enc(r.key);
  $("dlg-title").textContent = r.title;
  $("dlg-sub").textContent = r.artist + (r.album ? " — " + r.album : "");
  $("dlg-foot").innerHTML =
    (decayOn() ? `<span>Score ${pts(r.score)}</span>` : "") +
    `<span>Spotify ${fmt(r.spotify)}</span><span>Tidal ${fmt(r.tidal)}</span>` +
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
document.querySelectorAll(".frames button").forEach(b =>
  b.addEventListener("click", () => setFrame(b.dataset.frame)));
$("year").addEventListener("change", e => e.target.value ? setFrame("y" + e.target.value) : setFrame("all"));
["from", "to"].forEach(id => $(id).addEventListener("change", () => setFrame("custom", $("from").value, $("to").value)));

let debounce;
$("q").addEventListener("input", e => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { state.q = e.target.value; state.page = 1; load(); }, 200);
});
$("sort").addEventListener("change", e => { state.sort = e.target.value; state.page = 1; load(); });
$("min").addEventListener("change", e => { state.min = +e.target.value; state.page = 1; load(); });
let decayTimer;
$("decay").addEventListener("input", e => {
  const was = decayOn();
  state.decay = +e.target.value;
  $("decay-val").textContent = DECAY[state.decay][1];
  // switching decay on/off also switches between ranking by score and by raw time
  if (!was && decayOn() && state.sort === "total") state.sort = "score";
  if (was && !decayOn() && state.sort === "score") state.sort = "total";
  $("sort").value = state.sort;
  clearTimeout(decayTimer);
  decayTimer = setTimeout(() => { state.page = 1; load(); }, 200);
});
$("size").addEventListener("change", e => { state.size = +e.target.value; state.page = 1; load(); });
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
  readHash();
  try {
    META = await (await fetch("/api/meta")).json();
    $("year").insertAdjacentHTML("beforeend",
      META.years.slice().reverse().map(y => `<option value="${y}">${y}</option>`).join(""));
    if (META.first) { $("from").min = $("to").min = META.first; $("from").max = $("to").max = META.last; }
  } catch { /* the tracks request below will show the error */ }
  syncFrameUI();
  load();
})();
