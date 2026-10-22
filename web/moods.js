"use strict";
// Song moods (from lyrics) and the words you hear in lyrics: the Moods tab, mood over time, moods around
// the clock and through the seasons, lyric words, and small mood bars in other places (the clock's
// time-of-day view, seasons, and a song's or artist's popup).
// Uses helpers from app.js, fun.js and more.js (esc, pname, color, pct, plural, ttRow, moreList, …).

const MOOD_COLORS = {sad: "#4c6ef5", angry: "#e03131", dark: "#5f3dc4", love: "#e64980", party: "#f59f00",
                     hope: "#40c057", defiant: "#15aabf"};
let moodSel = {};                                       // person id -> mood picked in "songs by mood"

const moodList = d => d?.moods || [];
const moodOf = (d, id) => moodList(d).find(m => m.id === id) || {id, name: id, emoji: ""};
const topMood = mix => Object.entries(mix || {}).sort((a, b) => b[1] - a[1])[0];

function moodBar(mix, moods, cls = "") {
  const parts = moods.filter(m => mix[m.id] > 0);
  if (!parts.length) return "";
  return `<div class="mood-stack ${cls}">${parts.map(m => `<i style="flex:${mix[m.id]};background:${MOOD_COLORS[m.id]}"
    title="${esc(m.emoji)} ${esc(m.name)} ${pct(mix[m.id])}"></i>`).join("")}</div>`;
}
const moodLegend = moods => `<p class="mood-legend">${moods.map(m => `<span><i style="background:${MOOD_COLORS[m.id]}"></i>${m.emoji} ${esc(m.name)}</span>`).join("")}</p>`;

// one line for another section: "Mood here: 🖤 Darkness 24% (vs 17% overall)" plus a bar
function moodLine(pid, kind, i) {
  const d = typeof ins !== "undefined" ? ins.data?.moods : null;
  const p = d?.people.find(x => x.pid === pid), b = p?.[kind]?.[i];
  if (!b || b.with_mood < 10 || !Object.keys(b.mix).length) return "";
  const [id, v] = moodLift(b.mix, p.mix);
  const m = moodOf(d, id);
  return `<div class="mood-line"><p><span class="muted">Mood here:</span> ${m.emoji} <b>${esc(m.name)}</b> ${pct(v)}
      <span class="muted">(${pct(p.mix[id] || 0)} overall)</span></p>${moodBar(b.mix, moodList(d), "thin")}</div>`;
}
// the mood that's most above its usual share (or simply the biggest one)
function moodLift(mix, base) {
  let best = topMood(mix), bestLift = 0;
  Object.entries(mix).forEach(([id, v]) => {
    const lift = v / Math.max(base[id] || 0, 0.02);
    if (v >= 0.08 && lift > bestLift) { bestLift = lift; best = [id, v]; }
  });
  return best;
}

function moodCoverage(d, p) {
  const pr = d.progress;
  const share = p.plays ? p.with_mood / p.plays : 0;
  return `<p class="muted mood-note">Based on the lyrics of songs making up ${pct(share)} of the plays here
    (English and German lyrics).${pr.running ? ` Still fetching lyrics in the background: ${pr.done.toLocaleString()} of
    ${pr.total.toLocaleString()} songs so far; reopen Insights later for more.` : ""}</p>`;
}

const moodWho = pid => META.people.length > 1 ? `<p class="who-h" style="--c:${color(pid)}"><b>${esc(pname(pid))}</b></p>` : "";
const moodGrid = (list, fn) => `<div class="ins-grid">${list.map(p => `<div>${moodWho(p.pid)}${fn(p)}</div>`).join("")}</div>`;
const moodEmpty = d => `<p class="muted">No song moods yet: they come from lyrics, which are being fetched in the background
  (${d.progress.done.toLocaleString()} of ${d.progress.total.toLocaleString()} songs so far). Start the server without
  <code>--no-lyrics-scan</code> if it’s off.</p>`;

// ---------------------------------------------------------------- the tab --
function renderMoodMix(d) {
  const moods = moodList(d);
  if (!d.people.some(p => Object.keys(p.mix).length)) return `<div><h3>🎭 Your moods</h3>${moodEmpty(d)}</div>`;
  return `<div><h3>🎭 Your moods <span class="muted">what the songs you play are about</span></h3>${moodGrid(d.people, p => {
    if (!Object.keys(p.mix).length) return `<p class="muted">No moods here yet.</p>`;
    const [id, v] = topMood(p.mix), m = moodOf(d, id);
    const sel = moodSel[p.pid] && p.top[moodSel[p.pid]] ? moodSel[p.pid] : id;
    return `<p class="mood-head">${m.emoji} Mostly <b>${esc(m.name.toLowerCase())}</b> (${pct(v)})</p>
      ${moodBar(p.mix, moods, "big")}
      <ul class="mood-shares">${moods.filter(x => p.mix[x.id]).sort((a, b) => p.mix[b.id] - p.mix[a.id]).map(x =>
        `<li><i style="background:${MOOD_COLORS[x.id]}"></i>${x.emoji} ${esc(x.name)} <b>${pctS(p.mix[x.id])}</b></li>`).join("")}</ul>
      ${moodCoverage(d, p)}
      <p class="sub-h">Songs by mood</p>
      <div class="tabs mood-tabs" role="tablist">${moods.filter(x => p.top[x.id]?.length).map(x =>
        `<button type="button" role="tab" data-mood-pick="${x.id}" data-pid="${p.pid}" aria-selected="${x.id === sel}">${x.emoji} ${esc(x.name)}</button>`).join("")}</div>
      <div class="mood-songs" data-mood-songs="${p.pid}">${moodSongs(d, p, sel)}</div>`;
  })}</div>`;
}
function moodSongs(d, p, id) {
  const list = p.top[id] || [];
  return list.length ? moreList(list, 5, s => ttRow(s, plural(s.plays, "play"), `${pct(s.share)} ${esc(moodOf(d, id).name.toLowerCase())}`))
    : `<p class="muted">None.</p>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-mood-pick]");
  if (!b) return;
  const d = ins.data?.moods, pid = +b.dataset.pid, p = d?.people.find(x => x.pid === pid);
  if (!p) return;
  moodSel[pid] = b.dataset.moodPick;
  b.parentElement.querySelectorAll("[data-mood-pick]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  document.querySelector(`[data-mood-songs="${pid}"]`).innerHTML = moodSongs(d, p, moodSel[pid]);
});

// ------------------------------------------------------ moods in other tabs --
function renderMoodClock(d) {
  if (!d.people.some(p => p.parts.some(b => b.with_mood >= 10))) return "";
  const moods = moodList(d);
  return `<div><h3>🎭 Moods around the clock <span class="muted">what you play at each time of day</span></h3>${moodLegend(moods)}
    ${moodGrid(d.people, p => {
      const rows = p.parts.filter(b => b.with_mood >= 10);
      if (!rows.length) return `<p class="muted">Not enough songs with lyrics here.</p>`;
      const callouts = moodCallouts(d, p, rows);
      return `${callouts}<div class="mood-rows">${rows.map(b => `<div class="mood-row"><span>${b.emoji} ${esc(b.name)}</span>
        ${moodBar(b.mix, moods)}</div>`).join("")}</div>`;
    })}</div>`;
}
function renderMoodSeasons(d) {
  if (!d.people.some(p => p.seasons.some(b => b.with_mood >= 10))) return "";
  const moods = moodList(d);
  return `<div><h3>🎭 Moods through the year</h3>${moodLegend(moods)}${moodGrid(d.people, p => {
    const rows = p.seasons.filter(b => b.with_mood >= 10);
    if (!rows.length) return `<p class="muted">Not enough songs with lyrics here.</p>`;
    return `${moodCallouts(d, p, rows)}<div class="mood-rows">${rows.map(b => `<div class="mood-row"><span>${b.emoji} ${esc(b.name)}</span>
      ${moodBar(b.mix, moods)}</div>`).join("")}</div>`;
  })}</div>`;
}
// "Demon hours are your darkest: 🖤 24% (17% overall)", for the moods that stand out most
function moodCallouts(d, p, rows) {
  const out = [];
  moodList(d).forEach(m => {
    const base = p.mix[m.id] || 0;
    if (base < 0.03) return;
    const best = rows.reduce((a, b) => (b.mix[m.id] || 0) > (a.mix[m.id] || 0) ? b : a);
    const v = best.mix[m.id] || 0;
    if (v / base >= 1.2 && v - base >= 0.03) out.push([v / base, `${best.emoji} <b>${esc(best.name)}</b> is your ${m.emoji}
      ${esc(m.name.toLowerCase())} time: ${pct(v)} <span class="muted">(${pct(base)} overall)</span>`]);
  });
  out.sort((a, b) => b[0] - a[0]);
  return out.length ? `<ul class="mood-callouts">${out.slice(0, 3).map(([, t]) => `<li>${t}</li>`).join("")}</ul>` : "";
}

function renderMoodTime(d) {
  if (!d.people.some(p => p.months.length >= 3)) return "";
  const moods = moodList(d);
  return `<div><h3>🎭 Mood over time <span class="muted">month by month</span></h3>${moodLegend(moods)}${moodGrid(d.people, p => {
    const ms = p.months;
    if (ms.length < 3) return `<p class="muted">Not enough months with lyrics here.</p>`;
    const W = 600, H = 120, bw = W / ms.length;
    const cols = ms.map((m, i) => {
      let y = 0;
      return `<g><title>${esc(monthLabel(m.month))}: ${moods.filter(x => m.mix[x.id]).map(x => `${x.name} ${pct(m.mix[x.id])}`).join(", ")}</title>${
        moods.map(x => {
          const h = (m.mix[x.id] || 0) * H;
          const r = h ? `<rect x="${(i * bw).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="${MOOD_COLORS[x.id]}"/>` : "";
          y += h;
          return r;
        }).join("")}</g>`;
    }).join("");
    const years = ms.map((m, i) => m.month.endsWith("-01") || i === 0
      ? `<text x="${(i * bw).toFixed(1)}" y="${H + 13}">${m.month.slice(0, 4)}</text>` : "").join("");
    // the month that leaned hardest into each mood
    const peaks = moods.map(x => {
      const best = ms.reduce((a, b) => (b.mix[x.id] || 0) > (a.mix[x.id] || 0) ? b : a);
      return [(best.mix[x.id] || 0) - (p.mix[x.id] || 0), x, best];
    }).filter(([gap]) => gap >= 0.08).sort((a, b) => b[0] - a[0]).slice(0, 3);
    return `<svg class="mood-time" viewBox="0 0 ${W} ${H + 16}" preserveAspectRatio="none" role="img" aria-label="Mood per month">${cols}${years}</svg>
      ${peaks.length ? `<ul class="mood-callouts">${peaks.map(([, x, b]) => `<li>${x.emoji} Most ${esc(x.name.toLowerCase())}:
        <b>${esc(monthLabel(b.month))}</b> (${pct(b.mix[x.id])})</li>`).join("")}</ul>` : ""}`;
  })}</div>`;
}

// ------------------------------------------------------------ lyric words --
function renderLyricWords(d) {
  if (!d.people.some(p => p.words.length)) return "";
  const langName = l => ({en: "English", de: "German", pl: "Polish", ro: "Romanian", es: "Spanish", fr: "French"})[l] || l;
  return `<div><h3>📝 Words in your lyrics <span class="muted">what the songs you play actually say</span></h3>${moodGrid(d.people, p => {
    if (!p.words.length) return `<p class="muted">No lyrics here yet.</p>`;
    const max = Math.max(1, ...p.words.map(w => w.n));
    const langTot = p.langs.reduce((a, l) => a + l.plays, 0) || 1;
    return `<p>You’ve heard about <b>${compactNum(p.heard)} words</b> of lyrics here, from a vocabulary of at least
        ${p.vocab.toLocaleString()} different words.${p.instrumental ? ` ${pct(p.instrumental / Math.max(1, p.analysed))} of the songs with lyrics info were instrumental.` : ""}</p>
      <p class="muted">${p.langs.slice(0, 4).map(l => `${esc(langName(l.lang))} ${pct(l.plays / langTot)}`).join(" · ")}</p>
      <p class="words lyric-words">${p.words.map(w => `<span style="font-size:${(0.75 + 1.2 * Math.sqrt(w.n / max)).toFixed(2)}em;
        opacity:${(0.5 + 0.5 * w.n / max).toFixed(2)}" title="${w.n.toLocaleString()}">${esc(w.word)}</span>`).join(" ")}</p>
      ${p.wordiest.length ? `<p class="sub-h">📜 Wordiest songs</p>${moreList(p.wordiest, 3, s => ttRow(s, plural(s.words, "word"), ""))}` : ""}
      ${p.repetitive.length ? `<p class="sub-h">🔁 Most repetitive</p>${moreList(p.repetitive, 3, s => ttRow(s,
        `${s.unique} different words`, `out of ${s.words}`))}` : ""}
      ${moodCoverage(d, p)}`;
  })}</div>`;
}
const compactNum = n => n >= 1e6 ? (n / 1e6).toFixed(1) + " million" : n >= 1e4 ? Math.round(n / 1e3) + " thousand" : n.toLocaleString();

// ------------------------------------------------------- song/artist popup --
function moodSection(m) {
  const [id, v] = topMood(m.mix) || [];
  if (!id) return "";
  const mood = m.moods.find(x => x.id === id);
  return `<section><h3>Mood <span class="muted">from the lyrics</span></h3>
    <p>${mood.emoji} Mostly <b>${esc(mood.name.toLowerCase())}</b> (${pct(v)})</p>${moodBar(m.mix, m.moods)}
    <p class="mood-legend small">${m.moods.filter(x => m.mix[x.id] > 0).map(x =>
      `<span><i style="background:${MOOD_COLORS[x.id]}"></i>${x.emoji} ${esc(x.name)} ${pct(m.mix[x.id])}</span>`).join("")}</p></section>`;
}
