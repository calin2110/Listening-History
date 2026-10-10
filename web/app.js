"use strict";

const $ = id => document.getElementById(id);
const state = {
  frame: "all", from: "", to: "", q: "", sort: "total", min: 20, decay: 0, size: 48, page: 1,
  people: [], weights: {}, by: "plays", common: true, formula: "entropy", norm: false,   // multi-person
  level: "track", view: "top", gap: 365, minplay: true, era: "month", itab: "overview",
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
const GAPS = {91: "3 months", 182: "6 months", 365: "a year", 730: "2 years"};
const COLORS = ["#e8590c", "#7048e8", "#d6336c", "#0c8599", "#f59f00", "#5c7cfa", "#2f9e44", "#868e96"];
const BY_LABEL = {plays: "plays", minutes: "minutes", score: "points"};
const FORMULAS = ["entropy", "logsum", "harmonic"];
const LEVELS = {track: ["song", "songs"], artist: ["artist", "artists"], album: ["album", "albums"]};

const enc = encodeURIComponent;
const decayOn = () => state.decay > 0;
const joint = () => state.people.length > 1;
const color = pid => META.people.length > 1 ? COLORS[pid % COLORS.length] : "var(--accent)";
const pname = pid => META.people[pid]?.name ?? "Person " + (pid + 1);
const weight = pid => state.weights[pid] ?? 1;
const noun = (n = 2) => LEVELS[state.level][n === 1 ? 0 : 1];

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function niceDay(s) {
  return s ? new Date(s + "T00:00").toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"}) : "";
}
function fmt(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return Math.round(ms / 1000) + "s";
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60), r = m % 60;
  return h.toLocaleString() + " h" + (r ? " " + r + " min" : "");
}
function hours(ms) { return (ms / 3.6e6).toLocaleString(undefined, {maximumFractionDigits: ms < 3.6e7 ? 1 : 0}) + " hours"; }
function pts(v) { return v.toLocaleString(undefined, {maximumFractionDigits: v < 100 ? 1 : 0}); }
function jointFmt(v) { return v.toLocaleString(undefined, {maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0}); }
function pct(x) { return Math.round(x * 100) + "%"; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
function listNames(pids) {
  const n = pids.map(pname);
  return n.length <= 1 ? (n[0] || "") : n.slice(0, -1).join(", ") + " & " + n[n.length - 1];
}
// stacked bar: parts = [[value, cssColor], ...]
function bar(parts) {
  const t = parts.reduce((a, [v]) => a + v, 0) || 1;
  return parts.map(([v, c]) => `<i style="width:${v / t * 100}%;--c:${c}"></i>`).join("");
}
// streaming services: [key in the API, name, bar color]
const SOURCES = [["spotify", "Spotify", "var(--spotify)"], ["tidal", "Tidal", "var(--tidal)"],
                 ["apple", "Apple Music", "var(--apple)"]];
const present = () => SOURCES.filter(([k]) => (META.sources || ["spotify", "tidal"]).includes(k));
const sourceBar = r => bar(present().map(([k, , c]) => [r[k] || 0, c]));
const sourceSplit = r => present().filter(([k]) => r[k]).map(([k, n]) => `${n} ${fmt(r[k])}`).join(" / ");
const sourceTotal = r => SOURCES.reduce((a, [k]) => a + (r[k] || 0), 0);
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
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 6000);
}
const regionNames = (() => { try { return new Intl.DisplayNames(undefined, {type: "region"}); } catch { return null; } })();
function placeName(p) {
  if (p.startsWith("c:")) { try { return regionNames?.of(p.slice(2)) || p.slice(2); } catch { return p.slice(2); } }
  return p.slice(2);
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
function headline() {
  const subj = subject();
  if (state.view === "rediscover") {
    const verb = subj === "I" || state.people.length > 1 ? "haven't" : "hasn't";
    return `What ${subj} ${verb} played in ${GAPS[state.gap] || state.gap + " days"}`;
  }
  const m = /^d(\d+)$/.exec(state.view);
  if (m) {
    const pid = +m[1], others = state.people.filter(p => p !== pid);
    return `What ${pname(pid)} listens to that ${listNames(others)} ${others.length > 1 ? "have" : "has"} never played`;
  }
  return `What ${subj} listened to ${frameLabel()}`;
}

function setFrame(frame, from, to) {
  state.frame = frame;
  [state.from, state.to] = frame === "custom" ? [from, to] : rangeFor(frame);
  if (state.from && state.to && state.from > state.to) [state.from, state.to] = [state.to, state.from];
  state.page = 1;
  syncUI();
  refresh();
}

// ------------------------------------------------------------- UI syncing --
function viewOptions() {
  const opts = [["top", "Top " + noun()], ["rediscover", "Not played lately"]];
  if (joint()) {
    state.people.forEach(pid => {
      const others = state.people.filter(p => p !== pid);
      opts.push(["d" + pid, `${pname(pid)}’s, new to ${listNames(others)}`]);
    });
  }
  return opts;
}
function sortOptions() {
  const opts = joint()
    ? [["joint", "Joint score"], ...state.people.map(pid => ["p" + pid, `Most ${BY_LABEL[state.by]} by ${pname(pid)}`]),
       ["score", "Top points (with decay), combined"], ["total", "Most time, combined"]]
    : [["score", "Top score (with decay)"], ["total", "Most time listened"]];
  if (state.view === "top") opts.push(["climb", "Biggest climbers"]);
  if (present().length > 1) present().forEach(([k, n]) => opts.push([k, "Most played on " + n]));
  opts.push(["plays", "Most plays"],
            ["last", "Recently played"], ["skip_hi", "Most skipped"], ["skip_lo", "Least skipped"]);
  if (state.level === "track") opts.push(["artist", "Artist A–Z"], ["title", "Song A–Z"]);
  else if (state.level === "album") opts.push(["artist", "Artist A–Z"], ["title", "Album A–Z"]);
  else opts.push(["title", "Name A–Z"]);
  return opts;
}
function defaultSort() { return joint() ? "joint" : decayOn() ? "score" : "total"; }

function syncUI() {
  document.querySelectorAll("#frames button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.frame === state.frame)));
  const isYear = /^y\d{4}$/.test(state.frame);
  $("year").value = isYear ? state.frame.slice(1) : "";
  $("year").classList.toggle("active", isYear);
  document.querySelector(".custom").classList.toggle("active", state.frame === "custom");
  $("from").value = state.from;
  $("to").value = state.to;
  const redisc = state.view === "rediscover";
  $("frames").hidden = redisc;
  $("frame-note").hidden = !redisc;
  $("headline").textContent = headline();
  document.title = $("headline").textContent;

  if (META.people.length > 1) {
    $("people").hidden = false;
    $("people").innerHTML = META.people.map((p, pid) => {
      const on = state.people.includes(pid);
      return `<button type="button" data-pid="${pid}" style="--c:${color(pid)}" aria-pressed="${on}"
        ${on && state.people.length === 1 ? 'disabled title="At least one person stays selected"' : ""}>${esc(p.name)}</button>`;
    }).join("");
  }

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

  document.querySelectorAll("#level button").forEach(b =>
    b.setAttribute("aria-selected", String(b.dataset.level === state.level)));
  const vopts = viewOptions();
  if (!vopts.some(([v]) => v === state.view)) state.view = "top";
  $("view").innerHTML = vopts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("view").value = state.view;
  $("gap-wrap").hidden = state.view !== "rediscover";
  $("gap").value = String(state.gap);
  $("copy").disabled = state.level !== "track";
  $("copy").title = state.level === "track" ? "" : "Switch to Songs to copy a playlist";

  const sopts = sortOptions();
  if (!sopts.some(([v]) => v === state.sort)) state.sort = defaultSort();
  $("sort").innerHTML = sopts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("sort").value = state.sort;

  $("q").value = state.q;
  $("q").placeholder = "Search " + noun();
  $("min").value = String(state.min);
  $("size").value = String(state.size);
  $("decay").value = String(state.decay);
  $("decay-val").textContent = DECAY[state.decay][1];
  $("minplay").checked = state.minplay;
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
      `, where P(x) is x’s share of the ${noun(1)}’s ${by}. Nobody can carry a ${noun(1)} alone.`;
  }
  if (state.norm) text += ` Each person’s ${by} are first divided by their own total in this time frame.`;
  if (state.by === "score" && !decayOn()) text += " With decay off, points are the same as minutes.";
  if (state.by !== "score" && decayOn()) text += " Decay only changes the ranking when comparing by points.";
  $("formula-text").textContent = text;
}

// ---------------------------------------------------------------- loading --
function baseParams() {
  const redisc = state.view === "rediscover";
  return {
    from: redisc ? "" : state.from, to: redisc ? "" : state.to,
    people: state.people.join(","), by: state.by, half: DECAY[state.decay][0], minplay: state.minplay ? 30 : 0,
  };
}
function listParams(extra = {}) {
  return new URLSearchParams({
    ...baseParams(), q: state.q, sort: state.sort, min: state.min, page: state.page, size: state.size,
    w: state.people.map(weight).join(","), common: state.common ? 1 : 0, formula: state.formula,
    norm: state.norm ? 1 : 0, level: state.level, view: state.view, gap: state.gap, ...extra,
  });
}

function refresh() { load(); if ($("insights").open) loadInsights(); }

async function load() {
  ctrl?.abort();
  const mine = ctrl = new AbortController();
  $("grid").setAttribute("aria-busy", "true");
  try {
    const r = await fetch("/api/tracks?" + listParams(), {signal: mine.signal});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    state.page = d.page;
    render(d);
  } catch (e) {
    if (e.name === "AbortError") return;
    $("grid").innerHTML = `<li class="empty">Couldn't load ${noun()} (${esc(e.message)}). Check that server.py is still running, then reload the page.</li>`;
    $("pager").innerHTML = "";
  } finally {
    if (ctrl === mine) $("grid").removeAttribute("aria-busy");
  }
  writeHash();
}

function render(d) {
  lastData = d;
  const t = d.totals, sel = d.people, isJoint = sel.length > 1;
  const total = sourceTotal(t);

  if (!t.tracks) {
    $("totals").innerHTML = "";
  } else if (isJoint) {
    $("totals").innerHTML =
      `<span><b>${hours(total)}</b> across <b>${t.tracks.toLocaleString()}</b> ${state.common && state.view === "top" ? noun() + " in common" : noun()}</span>` +
      sel.map((pid, j) => `<span class="legend" style="--c:${color(pid)}">${esc(pname(pid))} ${hours(t.people[j].ms)}, ` +
        `${t.people[j].plays.toLocaleString()} plays</span>`).join("");
  } else {
    $("totals").innerHTML =
      `<span><b>${hours(total)}</b> across <b>${t.tracks.toLocaleString()}</b> ${noun()} and ${t.plays.toLocaleString()} plays</span>` +
      present().filter(([k]) => t[k]).map(([k, n, c]) => `<span class="legend" style="--c:${c}">${n} ${hours(t[k])}</span>`).join("") +
      (decayOn() ? `<span>Score <b>${pts(t.score)}</b></span>` : "");
  }
  $("bigsplit").innerHTML = isJoint ? bar(sel.map((pid, j) => [t.people[j].ms, color(pid)])) : sourceBar(t);

  $("decay-note").textContent = decayOn()
    ? `A minute played ${DECAY[state.decay][1]} before ${niceDay(d.ref)} counts half as much, ` +
      `${DECAY[state.decay][1]} before that a quarter, and so on. Score = weighted minutes.`
    : "Every minute counts the same. Slide to make recent listening count more.";
  if (d.cutoff) {
    $("frame-note").textContent = `${noun()[0].toUpperCase() + noun().slice(1)} played before ${niceDay(d.cutoff)} ` +
      `and not since, ranked by how much ${state.people.length > 1 ? "you" : subject() === "I" ? "you" : pname(sel[0])} played them back then. ` +
      `Time frames don't apply to this view.`;
  }

  // taste match line in the joint panel
  $("match").hidden = !d.match?.length;
  if (d.match?.length) {
    $("match").innerHTML = d.match.map(m =>
      `${d.match.length > 1 ? esc(pname(m.a) + " & " + pname(m.b)) + ": " : "Taste match: "}${pct(m.songs)} on songs, ` +
      `${pct(m.artists)} on artists <span>(${m.shared_songs.toLocaleString()} songs in common)</span>`).join("<br>");
  }

  const extra = [];
  if (t.hidden) extra.push(`${t.hidden.toLocaleString()} shorter hidden`);
  if (isJoint && t.not_common) extra.push(`${t.not_common.toLocaleString()} not shared`);
  $("count").textContent = (d.matched === t.tracks
    ? `${t.tracks.toLocaleString()} ${noun(t.tracks)}`
    : `${d.matched.toLocaleString()} of ${t.tracks.toLocaleString()}`) + (extra.length ? ", " + extra.join(", ") : "");

  items = d.items;
  const empty = emptyMessage(d);
  if (empty) {
    $("grid").innerHTML = `<li class="empty">${esc(empty)}</li>`;
  } else {
    $("grid").innerHTML = items.map((r, i) => card(r, i, d)).join("");
  }
  renderPager(d.page, d.pages);
}

function emptyMessage(d) {
  const t = d.totals, sel = d.people;
  if (t.tracks && !d.items.length) return `No ${noun()} match “${state.q}”. Try a shorter search.`;
  if (t.tracks) return null;
  if (d.view === "discover") {
    const m = /^d(\d+)$/.exec(state.view), pid = m ? +m[1] : sel[0];
    return `Everything ${pname(pid)} played in this time frame, ${listNames(sel.filter(p => p !== pid))} has played too` +
      (t.hidden ? `, or it's under the minimum time (${t.hidden.toLocaleString()} hidden). Lower the minimum` : ". Try a wider frame") + ".";
  }
  if (d.view === "rediscover") {
    return `Nothing fits: everything played before ${niceDay(d.cutoff)}` +
      (t.hidden ? ` that reaches the minimum time` : "") + ` has been played since. Try a shorter gap or lower the minimum.`;
  }
  if (sel.length > 1 && state.common && t.not_common) {
    return `${listNames(sel)} have no ${noun()} in common in this time frame${t.hidden ? " that reach the minimum time" : ""}. ` +
      `${t.not_common.toLocaleString()} were played by only some of you. Untick “Only songs everyone played”, pick a wider frame, or lower the minimum.`;
  }
  if (t.hidden) {
    return `No ${noun(1)} reached ${$("min").selectedOptions[0].text.toLowerCase()} in this time frame ` +
      `(${t.hidden.toLocaleString()} shorter ones are hidden). Lower the minimum or pick a wider frame.`;
  }
  const range = META.first ? ` The history runs from ${niceDay(META.first)} to ${niceDay(META.last)}.` : "";
  return `Nothing was played in this time frame.${range} Pick a wider frame or a different year.`;
}

function subtitle(r) {
  if (r.kind === "artist") return `${r.n_tracks.toLocaleString()} ${r.n_tracks === 1 ? "song" : "songs"}`;
  return r.sub;
}

function card(r, i, d) {
  const sel = d.people, isJoint = sel.length > 1;
  let badge = "";
  if (r.move !== null && d.has_prev) {
    if (r.new) badge = `<span class="move new" title="Not in the previous period">NEW</span>`;
    else if (r.move > 0) badge = `<span class="move up" title="Up ${r.move} from the previous period">▲${r.move}</span>`;
    else if (r.move < 0) badge = `<span class="move down" title="Down ${-r.move} from the previous period">▼${-r.move}</span>`;
  }
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
      <div class="split" title="${esc(sourceSplit(r))}">${sourceBar(r)}</div>`;
  }
  let line = "";
  if (state.sort === "skip_hi" || state.sort === "skip_lo") {
    line = r.skip_n ? `Skipped ${pct(r.skips / r.skip_n)} of ${r.skip_n.toLocaleString()} plays` : "No skip data (Tidal only)";
  } else if (state.view === "rediscover") {
    line = `Last played ${niceDay(r.last)}`;
  }
  return `<li class="item">
    <button type="button" class="cover" data-i="${i}" aria-label="Details for ${esc(r.title)}">
      <span class="ph">${esc((r.title[0] || "?").toUpperCase())}</span>
      <img src="/api/cover?k=${enc(r.cover_key)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="rank">${r.rank}</span>${badge}<span class="hint">${r.kind === "track" ? "Lyrics and timeline" : "Top songs and timeline"}</span>
    </button>
    <div class="meta">
      <div class="title" title="${esc(r.title)}">${esc(r.title)}</div>
      <div class="artist" title="${esc(subtitle(r))}">${esc(subtitle(r))}</div>
      ${stats}
      ${line ? `<div class="skipline">${esc(line)}</div>` : ""}
    </div></li>`;
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

// --------------------------------------------------------------- insights --
let insCtrl = null;
async function loadInsights() {
  insCtrl?.abort();
  const mine = insCtrl = new AbortController();
  const body = $("insights-body");
  body.style.opacity = ".5";
  try {
    const q = new URLSearchParams(baseParams());
    const [r, rf, rt, rc, rm, rmu] = await Promise.all([fetch("/api/insights?" + q, {signal: mine.signal}),
                                           fetch("/api/fun?" + new URLSearchParams({...baseParams(), era: state.era}),
                                                 {signal: mine.signal}),
                                           fetch("/api/time?" + q, {signal: mine.signal}),
                                           fetch("/api/clock?" + q, {signal: mine.signal}),
                                           fetch("/api/more?" + q, {signal: mine.signal}),
                                           fetch("/api/music?" + q, {signal: mine.signal})]);
    const [d, f, t, c, m, mu] = await Promise.all([r, rf, rt, rc, rm, rmu].map(x => x.json()));
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    body.innerHTML = renderInsights(d, rf.ok ? f : null, rt.ok ? t : null, rc.ok ? c : null,
                                    rm.ok ? m : null, rmu.ok ? mu : null);
    showInsTab(state.itab);
  } catch (e) {
    if (e.name === "AbortError") return;
    body.innerHTML = `<p class="muted">Couldn't load insights (${esc(e.message)}).</p>`;
  } finally {
    if (insCtrl === mine) body.style.opacity = "";
  }
}

// "12 Mar 2025, 21:04–23:40", or with both dates when a streak runs past midnight (browser's time zone)
function streakWhen(s) {
  const a = new Date(s.start_ts * 1000), b = new Date(s.end_ts * 1000);
  const day = d => d.toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"});
  const time = d => d.toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit"});
  return a.toDateString() === b.toDateString()
    ? `${day(a)}, ${time(a)}–${time(b)}`
    : `${day(a)} ${time(a)} to ${day(b)} ${time(b)}`;
}

// Insights is grouped into tabs; each section goes into one group
const INS_TABS = [["overview", "Overview"], ["habits", "Habits"], ["time", "Through time"],
                  ["music", "Your music"], ["places", "Places"]];
function renderInsights(d, f, t, c, m, mu) {
  const G = Object.fromEntries(INS_TABS.map(([k]) => [k, []]));
  const scope = state.view === "rediscover" ? "over the whole history" : frameLabel();
  const fun = f && typeof renderFunSections === "function" ? renderFunSections(f) : [];
  const has = name => typeof window[name] === "function";

  if (d.compat?.length) {
    G.overview.push(`<div><h3>How compatible are you? <span class="muted">${esc(scope)}</span></h3>
      ${d.compat.map(c => compatCard(c, d.compat_weights)).join("")}</div>`);
  }
  if (has("renderAwards") && state.people.length > 1) G.overview.push(renderAwards({d, f, t, c, m, mu}));
  if (fun[0]) G.overview.push(fun[0]);                                   // listening personality
  if (m && has("renderMilestones")) G.overview.push(renderMilestones(m));

  if (c && has("renderClock")) G.habits.push(renderClock(c));
  if (m && has("renderSessions")) G.habits.push(renderSessions(m));
  if (m && has("renderCalendar")) G.habits.push(renderCalendar(m));
  if (m && has("renderModes")) G.habits.push(renderModes(m));
  if (m && has("renderDevices")) G.habits.push(renderDevices(m));

  if (fun[1]) G.time.push(fun[1]);                                       // eras
  if (t && has("renderTimeTravel")) G.time.push(renderTimeTravel(t));

  if (mu && has("renderMusic")) G.music.push(renderMusic(mu));
  if (m && has("renderLoveHate")) G.music.push(renderLoveHate(m));

  const streakList = (list, kind) => list.length
    ? `<ul class="streaks">${list.slice(0, 5).map(s => `<li><b>×${s.len}</b><span>${esc(s.title)}
        <small>${kind === "song" ? esc(s.sub) + " · " : ""}${streakWhen(s)} · ${fmt(s.ms)}</small></span></li>`).join("")}</ul>`
    : `<p class="muted">No ${kind} played twice in a row here.</p>`;
  G.time.push(`<div><h3>Longest streaks ${esc(scope)}</h3><div class="ins-grid">${d.streaks.map(s => `
    <div>${META.people.length > 1 ? `<p class="who-h" style="--c:${color(s.pid)}"><b>${esc(pname(s.pid))}</b></p>` : ""}
      <p class="muted">Same song, back to back</p>${streakList(s.songs, "song")}
      <p class="muted">Same artist, back to back</p>${streakList(s.artists, "artist")}
    </div>`).join("")}</div></div>`);

  const days = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, {weekday: "short"}));
  G.habits.splice(1, 0, `<div><h3>When you listen <span class="muted">day of the week × hour</span></h3><div class="ins-grid">${d.clock.map(c => {
    const max = Math.max(1, ...c.ms);
    let cells = `<span></span>` + [0, 6, 12, 18].map(h => `<span class="hl">${h}:00</span>`).join("");
    for (let day = 0; day < 7; day++) {
      cells += `<span>${days[day]}</span>`;
      for (let h = 0; h < 24; h++) {
        const v = c.ms[day * 24 + h];
        cells += `<i style="--c:${color(c.pid)};--o:${(v / max).toFixed(3)}" title="${days[day]} ${h}:00, ${fmt(v)}"></i>`;
      }
    }
    return `<div>${META.people.length > 1 ? `<p class="who-h" style="--c:${color(c.pid)}"><b>${esc(pname(c.pid))}</b></p>` : ""}
      <div class="heat">${cells}</div></div>`;
  }).join("")}</div></div>`);

  if (m && has("renderTrips")) G.places.push(renderTrips(m));
  // places: merge country codes (Spotify, Apple Music) and Tidal's country names for the same country
  const merged = new Map();
  d.places.forEach(p => {
    const name = placeName(p.place);
    const x = merged.get(name) || {name, ms: 0, plays: 0, top: p.top, topMs: 0};
    x.ms += p.ms; x.plays += p.plays;
    if (p.ms > x.topMs) { x.top = p.top; x.topMs = p.ms; }
    merged.set(name, x);
  });
  const places = [...merged.values()].sort((a, b) => b.ms - a.ms).slice(0, 8);
  if (places.length) {
    const max = places[0].ms;
    G.places.push(`<div><h3>Where you listened</h3><ul class="places">${places.map(p => `<li>
      <span>${esc(p.name)}</span><span class="muted">${hours(p.ms)}</span>
      <div class="bars"><i style="width:${p.ms / max * 100}%"></i></div>
      <small>Most played there: ${esc(p.top.title)} by ${esc(p.top.sub)}</small></li>`).join("")}</ul></div>`);
  }
  const tabs = INS_TABS.filter(([k]) => G[k].length);
  if (!tabs.some(([k]) => k === state.itab)) state.itab = tabs[0]?.[0] || "overview";
  return `<div class="tabs ins-tabs" role="tablist" aria-label="Insights">${tabs.map(([k, l]) =>
      `<button type="button" role="tab" data-itab="${k}" aria-selected="${k === state.itab}">${l}</button>`).join("")}</div>` +
    tabs.map(([k]) => `<div class="ins-group" data-group="${k}" ${k === state.itab ? "" : "hidden"}>${G[k].join("")}</div>`).join("");
}

function showInsTab(tab) {
  state.itab = tab;
  document.querySelectorAll(".ins-tabs [data-itab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.itab === tab)));
  document.querySelectorAll(".ins-group").forEach(g => { g.hidden = g.dataset.group !== tab; });
  if (tab === "overview") document.querySelectorAll(".compat").forEach((card, i) => setTimeout(() => animateCompat(card), 150 + i * 300));
  writeHash();
}
document.addEventListener("click", e => {
  const b = e.target.closest(".ins-tabs [data-itab]");
  if (b) showInsTab(b.dataset.itab);
});

// ---------------------------------------------------------- compatibility --
const VERDICTS = [[0.6, "Musical soulmates"], [0.45, "On the same wavelength"], [0.3, "Plenty in common"],
                  [0.18, "A solid overlap"], [0.08, "A few shared favorites"], [0, "Opposites attract"]];
const verdict = x => VERDICTS.find(([t]) => Math.round(x * 100) / 100 >= t)[1];   // matches the shown %

function compatCard(c, weights) {
  const A = pname(c.a), B = pname(c.b), tc = c.top_counts;
  const rows = [
    ["songs", "Song taste", "How similarly you spread your listening across songs"],
    ["artists", "Artist taste", "The same, per artist"],
    ["overlap", "Common ground", "How much of your listening goes to songs you both play"],
    ["top", "Top 20 crossover", `${B} has played ${tc.b_played_a} of ${A}’s top ${tc.a_top}; ${A} has played ${tc.a_played_b} of ${B}’s top ${tc.b_top}`],
    ["rhythm", "Listening rhythm", "How alike your listening days and hours are"],
  ];
  const formula = rows.map(([k, l]) => `${Math.round(weights[k] * 100)}% ${l.toLowerCase()}`).join(" + ");
  const extra = [];
  if (c.anthem) extra.push(`Your shared anthem: <button type="button" class="linkish" data-open-key="${esc(c.anthem.key)}"
    data-title="${esc(c.anthem.title)}" data-sub="${esc(c.anthem.sub)}"><b>${esc(c.anthem.title)}</b> by ${esc(c.anthem.sub)}</button>`);
  if (c.artist) extra.push(`Most shared artist: <b>${esc(c.artist.title)}</b>`);
  extra.push(`${c.shared_songs.toLocaleString()} songs in common`);
  return `<div class="compat" data-overall="${c.overall}" style="--ca:${color(c.a)};--cb:${color(c.b)}">
    <svg class="venn" viewBox="0 0 260 150" role="img" aria-label="${esc(A)} and ${esc(B)}: ${pct(c.overall)} compatible">
      <circle class="va" cx="58" cy="70" r="52"/>
      <circle class="vb" cx="202" cy="70" r="52"/>
      <circle class="spark" cx="130" cy="70" r="6"/>
      <text class="la" x="124" y="142" text-anchor="end">${esc(A)}</text>
      <text class="lb" x="136" y="142" text-anchor="start">${esc(B)}</text>
    </svg>
    <div class="compat-main">
      <p class="compat-score"><span class="num">0</span><span class="unit">%</span></p>
      <p class="compat-verdict">${esc(verdict(c.overall))}</p>
      <button type="button" class="ghost replay">Play again</button>
      <button type="button" class="ghost replay" data-share="compat" data-name="compatibility">Save image</button>
    </div>
    <ul class="compat-metrics">${rows.map(([k, label, help]) => `<li title="${esc(help)}">
      <span>${esc(label)}</span><span class="track"><i data-v="${c.metrics[k]}"></i></span><b>${pct(c.metrics[k])}</b>
      <small>${esc(help)}</small></li>`).join("")}</ul>
    <p class="compat-extra">${extra.join(" · ")}</p>
    <p class="compat-formula muted">Overall = ${esc(formula)}. Based on ${BY_LABEL[state.by]} ${esc(frameLabel())}.</p>
  </div>`;
}

const ease = t => 1 - Math.pow(1 - t, 3);
function animateCompat(card) {
  const s = +card.dataset.overall;
  const va = card.querySelector(".va"), vb = card.querySelector(".vb"), spark = card.querySelector(".spark");
  const la = card.querySelector(".la"), lb = card.querySelector(".lb");
  const num = card.querySelector(".num");
  const bars = [...card.querySelectorAll(".compat-metrics i")];
  // final distance between centres: touching at 0%, on top of each other at 100%
  const r = 52, d = 2 * r * (1 - Math.min(s, 1)) + 4;
  const from = [58, 202], to = [130 - d / 2, 130 + d / 2];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.classList.remove("done");
  cancelAnimationFrame(card._raf);
  bars.forEach(b => { b.style.transition = "none"; b.style.width = "0"; });
  void card.offsetWidth;                                   // restart CSS transitions

  const finish = () => {
    card.classList.add("done");
    bars.forEach((b, i) => {
      b.style.transition = reduce ? "none" : `width .7s cubic-bezier(.2,.8,.2,1) ${i * 0.12}s`;
      b.style.width = (Math.min(+b.dataset.v, 1) * 100) + "%";
    });
  };
  const place = p => {
    const xa = from[0] + (to[0] - from[0]) * p, xb = from[1] + (to[1] - from[1]) * p;
    va.setAttribute("cx", xa); la.setAttribute("x", Math.min(xa, 124));   // names sit side by side, never overlap
    vb.setAttribute("cx", xb); lb.setAttribute("x", Math.max(xb, 136));
    spark.setAttribute("cx", (xa + xb) / 2);
    num.textContent = Math.round(s * 100 * p);
  };
  if (reduce) { place(1); finish(); return; }
  const t0 = performance.now(), dur = 1600;
  const step = now => {
    const p = ease(Math.min((now - t0) / dur, 1));
    place(p);
    if (p < 1) card._raf = requestAnimationFrame(step);
    else finish();
  };
  place(0);
  card._raf = requestAnimationFrame(step);
}

// ------------------------------------------------------------- URL state --
function writeHash() {
  const h = {f: state.frame, q: state.q, s: state.sort, m: state.min, d: state.decay, n: state.size, p: state.page,
             lv: state.level, v: state.view, g: state.gap, mp: state.minplay ? 1 : 0, er: state.era, it: state.itab};
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
  if (LEVELS[h.get("lv")]) state.level = h.get("lv");
  if (h.get("v")) state.view = h.get("v");
  if (GAPS[+h.get("g")]) state.gap = +h.get("g");
  if (h.has("mp")) state.minplay = h.get("mp") !== "0";
  if (["day", "month", "quarter", "half", "year"].includes(h.get("er"))) state.era = h.get("er");
  if (h.get("it")) state.itab = h.get("it");

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

// ----------------------------------------------------------------- detail --
const lyricCache = new Map();
let current = null, dlgStack = [];

async function openDetail(item, fromStack = false) {
  if (!fromStack) dlgStack = [];
  current = item;
  const img = $("dlg-img");
  img.style.display = "none";
  img.onload = () => { img.style.display = ""; };
  img.onerror = () => { img.style.display = "none"; };
  img.src = "/api/cover?k=" + enc(item.cover_key || item.key);
  $("dlg-title").textContent = item.title;
  $("dlg-sub").textContent = item.kind === "artist" ? "Artist" : item.sub + (item.album ? " — " + item.album : "");
  const back = dlgStack.length ? `<section><button type="button" class="dlg-back" id="dlg-back">← Back to ${esc(dlgStack[dlgStack.length - 1].title)}</button></section>` : "";
  $("dlg-body").innerHTML = back + `<section><p class="muted">Loading…</p></section>`;
  if (!$("dlg").open) $("dlg").showModal();
  $("dlg-body").scrollTop = 0;

  let d;
  try {
    const r = await fetch("/api/detail?" + new URLSearchParams({...baseParams(), k: item.key}));
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  } catch (e) {
    if (current !== item) return;
    $("dlg-body").innerHTML = back + `<section><p class="muted">Couldn't load details (${esc(e.message)}).</p></section>`;
    return;
  }
  if (current !== item) return;
  if (d.album) $("dlg-sub").textContent = d.sub + " — " + d.album;

  const sections = [back];
  if (d.spotify_url) {
    const id = d.spotify_url.split("/").pop();
    sections.push(`<section class="embed"><iframe src="https://open.spotify.com/embed/track/${esc(id)}?utm_source=generator"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Spotify player"></iframe></section>`);
  }

  const scope = state.view === "rediscover" ? "over the whole history" : frameLabel();
  const statLine = p => `${p.plays.toLocaleString()} plays · ${fmt(p.ms)}` +
    (p.skip_n ? ` · skipped ${pct(p.skips / p.skip_n)}` : "") +
    (p.first ? ` · ${p.first === p.last ? niceDay(p.first) : niceDay(p.first) + " to " + niceDay(p.last)}` : "");
  const links = (d.spotify_url ? `<a href="${esc(d.spotify_url)}" target="_blank" rel="noopener">Open in Spotify</a>` : "") +
    (d.apple_id ? `<a href="https://music.apple.com/song/${enc(d.apple_id)}" target="_blank" rel="noopener">Open in Apple Music</a>` : "") +
    (d.kind === "track" ? `<a href="https://genius.com/search?q=${enc(d.sub + " " + d.title)}" target="_blank" rel="noopener">Search on Genius</a>` : "");
  sections.push(`<section><h3>${esc(scope[0].toUpperCase() + scope.slice(1))}</h3><div class="stats">${
    d.per.map(p => `<span>${META.people.length > 1 ? `<b class="who-h" style="--c:${color(p.pid)}">${esc(pname(p.pid))}</b>: ` : ""}${p.plays ? statLine(p) : "not played"}</span>`).join("")
  }${links}</div></section>`);

  if (d.buckets.length > 1) sections.push(`<section class="timeline"><h3>Over time</h3>${timelineSVG(d)}</section>`);
  if (typeof hoursSection === "function") sections.push(hoursSection(d));

  if (d.kind === "track") {
    sections.push(`<section><h3>Lyrics</h3><div class="lyrics status" id="dlg-lyrics">Loading lyrics…</div></section>`);
  } else if (d.top.length) {
    sections.push(`<section><h3>Top songs</h3><ol class="toplist">${d.top.map((t, i) => `<li>
      <button type="button" data-top="${i}"><span class="muted">${i + 1}</span><span>${esc(t.title)}${d.kind === "album" ? "" : ""}</span>
      <span>${fmt(t.ms)} · ${t.plays.toLocaleString()} plays</span></button></li>`).join("")}</ol></section>`);
  }
  $("dlg-body").innerHTML = sections.join("");
  $("dlg-body").querySelectorAll("[data-top]").forEach(b => b.addEventListener("click", () => {
    const t = d.top[+b.dataset.top];
    dlgStack.push(item);
    openDetail({key: t.key, cover_key: t.key, kind: "track", title: t.title, sub: t.sub}, true);
  }));
  $("dlg-back")?.addEventListener("click", () => openDetail(dlgStack.pop(), true));

  if (d.kind === "track") loadLyrics(item);
}

async function loadLyrics(item) {
  const box = () => $("dlg-lyrics");
  try {
    let text = lyricCache.get(item.key);
    if (text === undefined) {
      const res = await fetch("/api/lyrics?k=" + enc(item.key));
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "HTTP " + res.status);
      text = d.text;
      lyricCache.set(item.key, text);
    }
    if (current !== item || !box()) return;
    box().className = text ? "lyrics" : "lyrics status";
    box().textContent = text || "No lyrics found on lrclib.net for this song. The Genius link above may have them.";
  } catch (e) {
    if (current !== item || !box()) return;
    box().textContent = `Couldn't load lyrics (${e.message}). Close this and open it again to retry.`;
  }
}

function timelineSVG(d) {
  const W = 620, H = 150, L = 36, B = 22, T = 10, R = 6;
  const useMs = state.by !== "plays";
  const series = d.series.map(s => ({pid: s.pid, v: useMs ? s.ms.map(x => x / 60000) : s.plays}));
  const n = d.buckets.length;
  const max = Math.max(1, ...series.flatMap(s => s.v));
  const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const y = v => T + (H - T - B) * (1 - v / max);
  const label = s => {
    const dt = new Date(s + "T00:00");
    return d.unit === "month" ? dt.toLocaleDateString(undefined, {month: "short", year: "numeric"})
                              : dt.toLocaleDateString(undefined, {day: "numeric", month: "short"});
  };
  const unitWord = useMs ? "min" : "plays";
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unitWord)} per ${d.unit} over time">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
    <line x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}" stroke="var(--line)" stroke-dasharray="3 4"/>
    <text x="${L - 6}" y="${y(max) + 4}" text-anchor="end">${Math.round(max).toLocaleString()}</text>
    <text x="${L - 6}" y="${y(0) + 4}" text-anchor="end">0</text>`;
  if (series.length === 1) {
    const bw = Math.max(1, (W - L - R) / n * 0.75);
    series[0].v.forEach((v, i) => {
      if (!v) return;
      const cx = n === 1 ? x(i) : L + (i + 0.5) * (W - L - R) / n;
      svg += `<rect x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="1.5" fill="${color(series[0].pid)}">
        <title>${label(d.buckets[i])}: ${Math.round(v).toLocaleString()} ${unitWord}</title></rect>`;
    });
  } else {
    series.forEach(s => {
      svg += `<polyline fill="none" stroke="${color(s.pid)}" stroke-width="2" stroke-linejoin="round"
        points="${s.v.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
    });
  }
  const ticks = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
  [...new Set(ticks)].forEach((i, k, arr) => {
    const anchor = k === 0 ? "start" : k === arr.length - 1 ? "end" : "middle";
    svg += `<text x="${x(i)}" y="${H - 4}" text-anchor="${anchor}">${esc(label(d.buckets[i]))}</text>`;
  });
  return svg + `</svg>`;
}

// --------------------------------------------------------------- playlist --
async function copyPlaylist() {
  const btn = $("copy");
  btn.disabled = true;
  try {
    const r = await fetch("/api/tracks?" + listParams({page: 1, size: 50, q: ""}));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    const urls = d.items.map(i => i.spotify_url).filter(Boolean);
    const missing = d.items.length - urls.length;
    if (!urls.length) { toast("None of these songs have a Spotify link (they were never played on Spotify)."); return; }
    const text = urls.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), {value: text});
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast(`Copied ${urls.length} songs. In the Spotify desktop app, open a playlist and press Ctrl+V (⌘V on a Mac).` +
          (missing ? ` ${missing} songs never played on Spotify were left out.` : ""));
  } catch (e) {
    toast(`Couldn't copy the playlist (${e.message}).`);
  } finally {
    btn.disabled = state.level !== "track";
  }
}

// ----------------------------------------------------------------- events --
const reload = () => { state.page = 1; refresh(); };
let timer;
const reloadSoon = () => { clearTimeout(timer); timer = setTimeout(reload, 200); };

document.querySelectorAll("#frames button").forEach(b =>
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
  clearTimeout(timer); timer = setTimeout(() => { state.page = 1; load(); }, 200);
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
$("minplay").addEventListener("change", e => { state.minplay = e.target.checked; reload(); });

$("level").addEventListener("click", e => {
  const b = e.target.closest("button[data-level]");
  if (!b || b.dataset.level === state.level) return;
  state.level = b.dataset.level;
  state.q = "";
  syncUI();
  reload();
});
$("view").addEventListener("change", e => { state.view = e.target.value; syncUI(); reload(); });
$("gap").addEventListener("change", e => { state.gap = +e.target.value; syncUI(); reload(); });
$("copy").addEventListener("click", copyPlaylist);
$("insights").addEventListener("toggle", () => { if ($("insights").open) loadInsights(); });
$("insights-body").addEventListener("click", e => {
  const replay = e.target.closest(".replay");
  if (replay) return animateCompat(replay.closest(".compat"));
  const open = e.target.closest("[data-open-key]");
  if (open) openDetail({key: open.dataset.openKey, cover_key: open.dataset.openKey, kind: "track",
                        title: open.dataset.title, sub: open.dataset.sub});
});

$("q").addEventListener("input", e => { state.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => { state.page = 1; load(); }, 200); });
$("sort").addEventListener("change", e => { state.sort = e.target.value; state.page = 1; load(); });
$("min").addEventListener("change", e => { state.min = +e.target.value; state.page = 1; load(); });
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
  if (b) openDetail(items[+b.dataset.i]);
});
// covers that can't be found: drop the <img> so the letter placeholder shows
$("grid").addEventListener("error", e => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
$("dlg-close").addEventListener("click", () => $("dlg").close());
$("dlg").addEventListener("click", e => { if (e.target === $("dlg")) $("dlg").close(); });
$("dlg").addEventListener("close", () => { current = null; $("dlg-body").innerHTML = ""; });   // stops the player

// ------------------------------------------------------------------- init --
(async () => {
  try {
    META = await (await fetch("/api/meta")).json();
    $("year").insertAdjacentHTML("beforeend",
      META.years.slice().reverse().map(y => `<option value="${y}">${y}</option>`).join(""));
    if (META.first) { $("from").min = $("to").min = META.first; $("from").max = $("to").max = META.last; }
  } catch { /* the list request below will show the error */ }
  readHash();
  syncUI();
  load();
})();
