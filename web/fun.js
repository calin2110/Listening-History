"use strict";
// Fun features: listening personality and eras (in Insights), the recap story, and two games.
// Uses the helpers and state from app.js, which loads first.

const cover = (key, cls = "") =>
  `<img class="${cls}" src="/api/cover?k=${enc(key)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
// eras: [value, picker label, "your top song of each …"]
const ERA_UNITS = [["day", "Per day", "day"], ["month", "Per month", "month"], ["quarter", "Per 3 months", "3 months"],
                   ["half", "Per 6 months", "6 months"], ["year", "Per year", "year"]];
if (!ERA_UNITS.some(([u]) => u === state.era)) state.era = "month";
function eraLabel(start, unit) {
  const d = new Date(start + "T00:00"), mon = m => new Date(2024, m, 1).toLocaleDateString(undefined, {month: "short"});
  if (unit === "day") return d.toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"});
  if (unit === "year") return String(d.getFullYear());
  if (unit === "month") return d.toLocaleDateString(undefined, {month: "short", year: "numeric"});
  const span = unit === "quarter" ? 3 : 6;
  return `${mon(d.getMonth())}–${mon(d.getMonth() + span - 1)} ${d.getFullYear()}`;
}
const funParams = () => new URLSearchParams({...baseParams(), era: state.era});
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------- insights sections --
function renderFunSections(f) {
  if (!f?.people?.length) return [];
  const many = META.people.length > 1;
  const who = p => many ? `<p class="who-h" style="--c:${color(p.pid)}"><b>${esc(pname(p.pid))}</b></p>` : "";
  const personality = `<div><h3>Listening personality</h3><div class="ins-grid">${f.people.map(p => `
    <div>${who(p)}${p.badges.length
      ? `<ul class="badges">${p.badges.map(b => `<li><span class="emoji" aria-hidden="true">${b.emoji}</span>
          <span><b>${esc(b.name)}</b><small>${esc(b.text)}</small></span></li>`).join("")}</ul>`
      : `<p class="muted">No badges in this time frame yet. Try a longer one.</p>`}</div>`).join("")}</div></div>`;
  const eras = `<div><div class="eras-head"><h3>Eras <span class="muted" id="eras-sub">your top song of each
      ${esc(ERA_UNITS.find(([u]) => u === state.era)[2])}</span></h3>
      <select id="era-unit" aria-label="Era length">${ERA_UNITS.map(([u, l]) =>
        `<option value="${u}" ${u === state.era ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div id="eras-body">${renderEraRows(f)}</div></div>`;
  return [personality, eras];
}

// Eras as a grid, like a contribution graph: one square per period with the cover of
// that period's top song. Brighter = more listening; hover for the album and song.
const eraTips = [];
const DAY_MS = 86400000;
const PERIODS = {   // squares per year row, months per square, column labels, square size range (px)
  month: [12, 1, m => new Date(2024, m, 1).toLocaleDateString(undefined, {month: "short"}), 16, 46],
  quarter: [4, 3, null, 36, 84],
  half: [2, 6, null, 56, 120],
};
const pad2 = n => String(n).padStart(2, "0");

function eraCell(e, maxMs, unit, small) {
  if (!e) return `<span class="ec silent" aria-hidden="true"></span>`;   // not "empty": that class is taken
  eraTips.push({e, unit});
  const o = (0.38 + 0.62 * Math.sqrt(e.ms / maxMs)).toFixed(2);
  return `<button type="button" class="ec" style="--o:${o}" data-tip="${eraTips.length - 1}" data-open-key="${esc(e.key)}"
    data-title="${esc(e.title)}" data-sub="${esc(e.sub)}" aria-label="${esc(eraLabel(e.start, unit))}: ${esc(e.title)} by ${esc(e.sub)}">
    <img src="/api/cover?k=${enc(e.cover_key)}${small ? "&s=small" : ""}" alt="" loading="lazy" referrerpolicy="no-referrer"
      onerror="this.remove()"></button>`;
}

function dayGrid(eras, lo, hi) {
  const byDate = new Map(eras.map(e => [e.start, e]));
  const maxMs = Math.max(...eras.map(e => e.ms));
  const years = [...new Set(eras.map(e => +e.start.slice(0, 4)))].sort((a, b) => b - a);
  const blocks = years.map(y => {
    const jan1 = new Date(y, 0, 1), start = new Date(y, 0, 1 - (jan1.getDay() + 6) % 7);   // Monday on or before 1 Jan
    const weeks = Math.ceil((Math.round((new Date(y, 11, 31) - start) / DAY_MS) + 1) / 7);
    let cells = "";
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = isoDay(d);
      cells += d.getFullYear() !== y || k < lo || k > hi ? `<span class="ec out"></span>` : eraCell(byDate.get(k), maxMs, "day", true);
    }
    const months = [...Array(12)].map((_, m) => {
      const col = Math.floor(Math.round((new Date(y, m, 1) - start) / DAY_MS) / 7) + 1;
      return `<span style="grid-column:${col} / span 4">${new Date(y, m, 1).toLocaleDateString(undefined, {month: "short"})}</span>`;
    }).join("");
    const days = [...Array(7)].map((_, i) => i % 2 ? "" : new Date(2024, 0, 1 + i).toLocaleDateString(undefined, {weekday: "short"}));
    const n = eras.filter(e => e.start.startsWith(y + "-")).length;
    return `<div class="eg-year"><p class="eg-ylabel">${y} <span class="muted">${plural(n, "day")} with music</span></p>
      <div class="eg-scroll"><div class="eg-day" style="--weeks:${weeks}">
        <div class="eg-months">${months}</div>
        <div class="eg-wd">${days.map(d => `<span>${esc(d)}</span>`).join("")}</div>
        <div class="eg-cells">${cells}</div></div></div></div>`;
  });
  const shown = 2;
  return blocks.slice(0, shown).join("") + (blocks.length > shown
    ? `<details class="eg-more"><summary>Show ${plural(blocks.length - shown, "older year")}</summary>${blocks.slice(shown).join("")}</details>` : "");
}

function periodGrid(eras, unit, lo, hi) {
  const [n, size, label, min, max] = PERIODS[unit];
  const byStart = new Map(eras.map(e => [e.start, e]));
  const maxMs = Math.max(...eras.map(e => e.ms));
  const years = [...new Set(eras.map(e => +e.start.slice(0, 4)))].sort((a, b) => b - a);
  const mon = m => new Date(2024, m, 1).toLocaleDateString(undefined, {month: "short"});
  const heads = [...Array(n)].map((_, i) => label ? label(i) : `${mon(i * size)}–${mon(i * size + size - 1)}`);
  let html = `<span></span>${heads.map(h => `<span class="eg-head">${esc(h)}</span>`).join("")}`;
  for (const y of years) {
    html += `<span class="eg-rowlabel">${y}</span>`;
    for (let i = 0; i < n; i++) {
      const k = `${y}-${pad2(i * size + 1)}-01`;
      const next = i + 1 < n ? `${y}-${pad2((i + 1) * size + 1)}-01` : `${y + 1}-01-01`;
      html += next <= lo || k > hi ? `<span class="ec out"></span>` : eraCell(byStart.get(k), maxMs, unit, unit === "month");
    }
  }
  return `<div class="eg-scroll"><div class="eg-table" style="--n:${n};--min:${min}px;--max:${max}px">${html}</div></div>`;
}

function yearGrid(eras) {
  const maxMs = Math.max(...eras.map(e => e.ms));
  return `<div class="eg-years">${eras.map(e => `<div>${eraCell(e, maxMs, "year", false)}
    <span class="eg-head">${esc(e.start.slice(0, 4))}</span></div>`).join("")}</div>`;
}

function renderEraRows(f) {
  eraTips.length = 0;
  const many = META.people.length > 1;
  const rows = f.people.filter(p => p.eras.length);
  if (!rows.length) return `<p class="muted">Nothing played in this time frame.</p>`;
  const redisc = state.view === "rediscover";
  const words = {day: "day", month: "month", quarter: "quarter", half: "half-year", year: "year"};
  return rows.map(p => {
    const lo = (!redisc && state.from) || p.eras[0].start;
    const hi = (!redisc && state.to) || p.eras[p.eras.length - 1].start;
    const grid = f.era === "day" ? dayGrid(p.eras, lo, hi)
      : f.era === "year" ? yearGrid(p.eras) : periodGrid(p.eras, f.era, lo, hi);
    return `<div class="eg">${many ? `<p class="who-h" style="--c:${color(p.pid)}"><b>${esc(pname(p.pid))}</b>
      <span class="muted">${plural(p.eras.length, words[f.era])}</span></p>` : ""}${grid}</div>`;
  }).join("") + `<p class="muted eg-note">Each square shows the cover of that ${words[f.era]}’s top song; brighter means more listening.</p>`;
}

// one floating tooltip for all squares
const eraTip = Object.assign(document.createElement("div"), {className: "era-tip", role: "tooltip"});
document.body.appendChild(eraTip);
function showEraTip(el) {
  const t = eraTips[+el.dataset.tip];
  if (!t) return;
  const e = t.e;
  eraTip.innerHTML = `<b>${esc(e.album || e.title)}</b><span>${esc(e.title)} · ${esc(e.sub)}</span>
    <small>${esc(eraLabel(e.start, t.unit))} · top song, ${fmt(e.ms)}</small>`;
  eraTip.classList.add("show");
  const r = el.getBoundingClientRect(), w = eraTip.offsetWidth, h = eraTip.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const top = r.top - h - 10 >= 8 ? r.top - h - 10 : r.bottom + 10;
  eraTip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
const hideEraTip = () => eraTip.classList.remove("show");
document.addEventListener("pointerover", e => {
  const el = e.target.closest?.(".ec[data-tip]");
  el ? showEraTip(el) : hideEraTip();
});
document.addEventListener("focusin", e => {
  const el = e.target.closest?.(".ec[data-tip]");
  el ? showEraTip(el) : hideEraTip();
});
document.addEventListener("scroll", hideEraTip, true);

let eraCtrl = null;
document.addEventListener("change", async e => {
  if (e.target.id !== "era-unit") return;
  state.era = e.target.value;
  writeHash();
  $("eras-sub").textContent = "your top song of each " + ERA_UNITS.find(([u]) => u === state.era)[2];
  const body = $("eras-body");
  body.style.opacity = ".5";
  eraCtrl?.abort();
  const mine = eraCtrl = new AbortController();
  try {
    const r = await fetch("/api/fun?" + funParams(), {signal: mine.signal});
    const f = await r.json();
    if (!r.ok) throw new Error(f.error || "HTTP " + r.status);
    body.innerHTML = renderEraRows(f);
  } catch (err) {
    if (err.name !== "AbortError") body.innerHTML = `<p class="muted">Couldn't load eras (${esc(err.message)}).</p>`;
  } finally {
    if (eraCtrl === mine) body.style.opacity = "";
  }
});

// ------------------------------------------------------------------ recap --
// A recap is a list of slides; each is {bg, html, onShow?}. Tap the right side
// (or →) for the next one, the left side (or ←) to go back; they also advance on their own.
const recap = {slides: [], i: 0, timer: null, dur: 6500};

async function openRecap() {
  const dlg = $("recap");
  dlg.showModal();
  if (state.people.length > 1) {
    const mix = `linear-gradient(135deg, ${state.people.map(color).join(", ")})`;
    showRecapSlides([{bg: mix, html: `<div class="slide-center">
      <p class="eyebrow">Whose recap?</p>
      <div class="pick">${state.people.map(pid => `<button type="button" data-recap="${pid}" style="--c:${color(pid)}">${esc(pname(pid))}</button>`).join("")}
        <button type="button" data-recap="together">${esc(listNames(state.people))} together</button></div></div>`}], false);
  } else {
    startRecap(state.people[0]);
  }
}

async function startRecap(which) {
  showRecapSlides([{bg: "var(--accent)", html: `<div class="slide-center"><p class="big-line">Getting your recap ready…</p></div>`}], false);
  try {
    const slides = which === "together" ? await togetherSlides() : await personSlides(+which);
    showRecapSlides(slides, true);
  } catch (e) {
    showRecapSlides([{bg: "var(--accent)", html: `<div class="slide-center"><p class="big-line">Couldn't load the recap (${esc(e.message)}).</p></div>`}], false);
  }
}

async function getJSON(url) {
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

async function personSlides(pid) {
  const p0 = funParams();
  p0.set("people", pid);
  const [f, tt, ck] = await Promise.all([getJSON("/api/fun?" + p0), getJSON("/api/time?" + p0).catch(() => null),
                                         getJSON("/api/clock?" + p0).catch(() => null)]);
  const p = f.people[0], name = pname(pid), c = color(pid);
  const you = META.people.length > 1 ? name : "You";
  const when = state.view === "rediscover" ? "of all time" : frameLabel();
  if (!p || !p.plays) {
    return [{bg: c, html: `<div class="slide-center"><p class="big-line">${esc(you)} didn't play anything ${esc(when)}.</p>
      <p>Pick a wider time frame and try again.</p></div>`}];
  }
  const slides = [];
  const year = /^in (\d{4})$/.exec(when);
  slides.push({bg: c, html: `<div class="slide-center"><p class="eyebrow">${esc(when[0].toUpperCase() + when.slice(1))}</p>
    <p class="huge">${esc(name)}’s<br>${year ? year[1] + " in music" : "recap"}</p></div>`});
  const h = p.ms / 3.6e6;
  slides.push({bg: c, html: `<div class="slide-center"><p class="eyebrow">${esc(you)} listened for</p>
    <p class="huge"><span class="count" data-to="${h >= 10 ? Math.round(h) : h.toFixed(1)}">0</span> hours</p>
    <p>That’s ${Math.round(p.ms / 60000).toLocaleString()} minutes: ${p.plays.toLocaleString()} plays of ${p.songs.toLocaleString()} songs
      by ${p.artists.toLocaleString()} artists, on ${p.days.toLocaleString()} different days.</p></div>`, onShow: countUp});
  const a = p.top_artists[0];
  if (a) slides.push({bg: c, html: `<div class="slide-split">${cover(a.cover_key, "art")}<div>
    <p class="eyebrow">Top artist</p><p class="huge">${esc(a.title)}</p>
    <p>${fmt(a.ms)} together${p.top_artists.length > 1 ? `, ahead of ${esc(p.top_artists[1].title)}` : ""}.</p></div></div>`});
  slides.push({bg: c, html: `<div class="slide-list"><p class="eyebrow">Top songs</p><ol>${p.top_songs.map((s, i) => `
    <li style="--d:${i * 0.12}s">${cover(s.cover_key)}<span><b>${esc(s.title)}</b><small>${esc(s.sub)} · ${fmt(s.ms)}</small></span></li>`).join("")}</ol></div>`});
  if (p.best_day) {
    const bd = p.best_day;
    slides.push({bg: c, html: `<div class="slide-center"><p class="eyebrow">Biggest day</p>
      <p class="huge">${esc(niceDay(bd.date))}</p>
      <p>${fmt(bd.ms)} of music, ${bd.songs.toLocaleString()} different songs${bd.top ? `, most of all ${esc(bd.top.title)} by ${esc(bd.top.sub)}` : ""}.</p></div>`});
  }
  if (p.streak || p.repeat_day) {
    const s = p.streak, r = p.repeat_day;
    slides.push({bg: c, html: `<div class="slide-center"><p class="eyebrow">On repeat</p>
      ${s ? `<p class="huge">×${s.len}</p><p>${esc(s.title)} by ${esc(s.sub)}, back to back. That’s ${esc(you === "You" ? "your" : name + "’s")} longest streak.</p>` : ""}
      ${r && r.plays > 1 ? `<p>And on ${esc(niceDay(r.date))}, ${esc(r.title)} played ${r.plays} times in one day.</p>` : ""}</div>`});
  }
  const cp = ck?.people?.[0];
  if (cp?.plays) {
    const dps = ck.dayparts, best = cp.parts.reduce((a, x, i) => x.share > cp.parts[a].share ? i : a, 0);
    const demon = cp.parts[0], anthem = demon.signature[0] || (demon.top[0]?.plays_here >= 3 ? demon.top[0] : null);
    slides.push({bg: c, html: `<div class="slide-split"><div class="clock-slide">${radialClock(cp.hours, "#fff", best, dps)}</div><div>
      <p class="eyebrow">Around the clock</p><p class="huge">${dps[best].emoji} ${esc(dps[best].name)}</p>
      <p>That’s when ${esc(you === "You" ? "your" : name + "’s")} music peaks: ${pctSmall(cp.parts[best].share)} of all listening,
        ${esc(partRange(dps[best]))}.</p>
      ${anthem ? `<p>😈 Demon-hours anthem: <b>${esc(anthem.title)}</b> by ${esc(anthem.sub)},
        ${plural(anthem.plays_here, "play")} between midnight and 3 am.</p>`
        : `<p>😈 Demon hours: ${demon.share < 0.005 ? "barely ever. Sensible." : pct(demon.share) + " of your listening."}</p>`}</div></div>`});
  }
  const back = tt?.people?.[0]?.comebacks?.[0];
  if (back && back.gap_days >= 90) {
    slides.push({bg: c, html: `<div class="slide-split">${cover(back.cover_key, "art")}<div><p class="eyebrow">The comeback</p>
      <p class="huge">${esc(fmtDays(back.gap_days))}</p>
      <p>That’s how long ${esc(back.title)} by ${esc(back.sub)} went unplayed after ${esc(niceDay(back.left))}.
        Then on ${esc(niceDay(back.back))}, it was back.</p></div></div>`});
  }
  if (p.badges.length) {
    slides.push({bg: c, html: `<div class="slide-list"><p class="eyebrow">${esc(you === "You" ? "Your" : name + "’s")} listening personality</p>
      <ul class="badges big">${p.badges.slice(0, 5).map((b, i) => `<li style="--d:${i * 0.12}s"><span class="emoji" aria-hidden="true">${b.emoji}</span>
        <span><b>${esc(b.name)}</b><small>${esc(b.text)}</small></span></li>`).join("")}</ul></div>`});
  }
  if (p.eras.length > 1) {
    slides.push({bg: c, html: `<div class="slide-list"><p class="eyebrow">${esc(you === "You" ? "Your" : name + "’s")} eras</p>
      <ol class="eras big">${p.eras.slice(-12).map((e, i) => `<li style="--d:${i * 0.08}s">${cover(e.cover_key)}
        <span class="m">${esc(eraLabel(e.start, f.era))}</span><span class="t">${esc(e.title)}</span></li>`).join("")}</ol></div>`});
  }
  slides.push(outro(c));
  return slides;
}

async function togetherSlides() {
  const people = state.people;
  const q = funParams();
  const [ins, list] = await Promise.all([
    getJSON("/api/insights?" + q),
    getJSON("/api/tracks?" + listParams({page: 1, size: 5, q: "", sort: "joint", common: 1, view: "top", level: "track", min: 0})),
  ]);
  const names = listNames(people), bg = `linear-gradient(135deg, ${color(people[0])}, ${color(people[1])})`;
  const best = ins.compat[0];
  const slides = [{bg, html: `<div class="slide-center"><p class="eyebrow">${esc(frameLabel())}</p>
    <p class="huge">${esc(names)}</p><p>How your music lines up.</p></div>`}];
  if (best) {
    slides.push({bg, html: `<div class="slide-center"><p class="eyebrow">${people.length > 2 ? "Your best match" : "Compatibility"}</p>
      ${people.length > 2 ? `<p>${esc(pname(best.a))} & ${esc(pname(best.b))}</p>` : ""}
      <p class="huge"><span class="count" data-to="${Math.round(best.overall * 100)}">0</span>%</p>
      <p class="big-line">${esc(verdict(best.overall))}</p>
      <p>${best.shared_songs.toLocaleString()} songs in common${best.artist ? `, and you both love ${esc(best.artist.title)}` : ""}.</p></div>`,
      onShow: countUp});
  }
  if (best?.anthem) {
    slides.push({bg, html: `<div class="slide-split">${cover(best.anthem.key, "art")}<div>
      <p class="eyebrow">Your shared anthem</p><p class="huge">${esc(best.anthem.title)}</p><p>${esc(best.anthem.sub)}</p></div></div>`});
  }
  if (list.items.length) {
    slides.push({bg, html: `<div class="slide-list"><p class="eyebrow">Your top shared songs</p><ol>${list.items.map((s, i) => `
      <li style="--d:${i * 0.12}s">${cover(s.cover_key)}<span><b>${esc(s.title)}</b>
        <small>${s.per.map((x, j) => `${esc(pname(list.people[j]))} ${x ? x.plays : 0}`).join(" · ")} plays</small></span></li>`).join("")}</ol></div>`});
  }
  slides.push(outro(bg));
  return slides;
}

function outro(bg) {
  return {bg, html: `<div class="slide-center"><p class="huge">That’s a wrap.</p>
    <div class="pick"><button type="button" data-recap-again>Watch again</button><button type="button" data-recap-close>Close</button></div></div>`};
}

function showRecapSlides(slides, auto) {
  clearTimeout(recap.timer);
  recap.slides = slides;
  recap.auto = auto;
  $("recap-bars").innerHTML = slides.length > 1 ? slides.map(() => `<span><i></i></span>`).join("") : "";
  goSlide(0);
}

function goSlide(i) {
  clearTimeout(recap.timer);
  if (i < 0) i = 0;
  if (i >= recap.slides.length) return;
  recap.i = i;
  const s = recap.slides[i], stage = $("recap-stage");
  stage.style.setProperty("--slide", s.bg);
  stage.innerHTML = `<div class="slide">${s.html}</div>`;
  [...$("recap-bars").children].forEach((b, k) => {
    const bar = b.firstElementChild;
    bar.style.transition = "none";
    bar.style.width = k < i ? "100%" : "0";
    if (k === i && recap.auto && i < recap.slides.length - 1) {
      void bar.offsetWidth;
      bar.style.transition = `width ${recap.dur}ms linear`;
      bar.style.width = "100%";
    }
  });
  s.onShow?.(stage);
  if (recap.auto && i < recap.slides.length - 1) recap.timer = setTimeout(() => goSlide(i + 1), recap.dur);
}

function countUp(stage) {
  stage.querySelectorAll(".count").forEach(el => {
    const to = +el.dataset.to, dec = String(el.dataset.to).includes(".") ? 1 : 0;
    if (reduceMotion()) { el.textContent = to.toLocaleString(undefined, {minimumFractionDigits: dec}); return; }
    const t0 = performance.now(), dur = 1400;
    const step = now => {
      const p = Math.min((now - t0) / dur, 1), v = to * (1 - Math.pow(1 - p, 3));
      el.textContent = v.toLocaleString(undefined, {minimumFractionDigits: dec, maximumFractionDigits: dec});
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function closeRecap() { clearTimeout(recap.timer); $("recap").close(); }

$("recap-open").addEventListener("click", openRecap);
$("recap-close").addEventListener("click", closeRecap);
$("recap").addEventListener("close", () => clearTimeout(recap.timer));
// on document: the button that was clicked may be gone, taking keyboard focus with it
document.addEventListener("keydown", e => {
  if (!$("recap").open) return;
  if (e.key === "ArrowRight") { e.preventDefault(); goSlide(recap.i + 1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); goSlide(recap.i - 1); }
});
$("recap-stage").addEventListener("click", e => {
  const pick = e.target.closest("[data-recap]");
  if (pick) return startRecap(pick.dataset.recap);
  if (e.target.closest("[data-recap-again]")) return goSlide(0);
  if (e.target.closest("[data-recap-close]")) return closeRecap();
  if (recap.slides.length < 2) return;
  const box = $("recap-stage").getBoundingClientRect();
  goSlide(recap.i + (e.clientX - box.left < box.width / 3 ? -1 : 1));
});

// ------------------------------------------------------------------ games --
const game = {mode: "hilo", pool: [], a: null, b: null, score: 0, round: 0, busy: false, pid: null};
const BEST_KEY = "music-stats-best";
function bestScore(key) { try { return +(JSON.parse(localStorage.getItem(BEST_KEY) || "{}")[key] || 0); } catch { return 0; } }
function saveBest(key, v) {
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) || "{}");
    if (v > (all[key] || 0)) { all[key] = v; localStorage.setItem(BEST_KEY, JSON.stringify(all)); }
  } catch { /* storage unavailable: best scores just aren't kept */ }
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = () => game.pool.splice(Math.floor(Math.random() * game.pool.length), 1)[0];

function openGame() {
  const modes = [["hilo", "Higher or lower"]];
  if (state.people.length > 1) modes.push(["who", "Who played it more?"]);
  if (!modes.some(([m]) => m === game.mode)) game.mode = "hilo";
  $("game-modes").innerHTML = modes.map(([m, l]) =>
    `<button type="button" role="tab" data-mode="${m}" aria-selected="${m === game.mode}">${l}</button>`).join("");
  $("game").showModal();
  newGame();
}

async function newGame() {
  const box = $("game-stage");
  box.innerHTML = `<p class="muted">Shuffling songs…</p>`;
  game.score = 0; game.round = 0; game.busy = false;
  try {
    if (game.mode === "hilo") {
      game.pid = state.people.includes(game.pid) ? game.pid : state.people[0];
      const d = await getJSON("/api/tracks?" + listParams({people: game.pid, page: 1, size: 200, q: "", sort: "plays",
        view: "top", level: "track", min: 0, common: 0}));
      game.pool = shuffle(d.items.filter(i => i.plays > 0));
      if (game.pool.length < 2) throw new Error("not enough songs in this time frame; pick a wider one");
      game.a = pick(); game.b = pick();
      renderHilo();
    } else {
      const d = await getJSON("/api/tracks?" + listParams({page: 1, size: 200, q: "", sort: "joint", view: "top",
        level: "track", min: 0, common: 1, by: "plays"}));
      game.people = d.people;
      // only songs with a clear winner
      game.pool = shuffle(d.items.filter(i => {
        const v = i.per.map(x => x ? x.plays : 0), m = Math.max(...v);
        return v.filter(x => x === m).length === 1;
      }));
      if (game.pool.length < 3) throw new Error("not enough songs in common in this time frame; pick a wider one");
      game.total = Math.min(10, game.pool.length);
      game.a = pick();
      renderWho();
    }
  } catch (e) {
    box.innerHTML = `<p class="muted">Can't start the game: ${esc(e.message)}.</p>`;
  }
}

function songCard(s, reveal, label) {
  return `<div class="g-song">${cover(s.cover_key)}<p class="g-title">${esc(s.title)}</p><p class="muted">${esc(s.sub)}</p>
    ${label ? `<p class="g-count">${label}</p>` : ""}${reveal ?? ""}</div>`;
}

function renderHilo(result) {
  const key = "hilo:" + pname(game.pid);
  const ppl = state.people.length > 1
    ? `<label class="g-who">Whose plays? <select id="g-person">${state.people.map(p =>
        `<option value="${p}" ${p === game.pid ? "selected" : ""}>${esc(pname(p))}</option>`).join("")}</select></label>` : "";
  const bPlays = result ? `<p class="g-count reveal">${game.b.plays.toLocaleString()} plays</p>` : "";
  $("game-stage").innerHTML = `${ppl}
    <p class="g-q">${state.people.length > 1 ? esc(pname(game.pid)) + " played" : "You played"} <b>${esc(game.a.title)}</b>
      ${game.a.plays.toLocaleString()} times ${esc(frameLabel())}. And this one?</p>
    <div class="g-pair">${songCard(game.a, "", `${game.a.plays.toLocaleString()} plays`)}
      <span class="g-vs">vs</span>${songCard(game.b, bPlays)}</div>
    <div class="g-actions">${result
      ? `<p class="g-result ${result.ok ? "ok" : "bad"}">${result.ok ? "Right!" : "Not quite."}</p>
         ${result.ok ? `<button type="button" data-g="next">Next song</button>` : `<button type="button" data-g="again">Play again</button>`}`
      : `<button type="button" data-g="higher">▲ More plays</button><button type="button" data-g="lower">▼ Fewer plays</button>`}</div>
    <p class="g-score">Score ${game.score} · Best ${Math.max(bestScore(key), game.score)}</p>`;
}

function answerHilo(higher) {
  const a = game.a.plays, b = game.b.plays;
  const ok = a === b || (higher ? b > a : b < a);
  if (ok) game.score++;
  else saveBest("hilo:" + pname(game.pid), game.score);
  renderHilo({ok});
  if (ok && !game.pool.length) {
    saveBest("hilo:" + pname(game.pid), game.score);
    $("game-stage").querySelector(".g-actions").innerHTML = `<p class="g-result ok">You got through every song!</p><button type="button" data-g="again">Play again</button>`;
  }
}

function renderWho(revealed) {
  const s = game.a, plays = s.per.map(x => x ? x.plays : 0), max = Math.max(...plays);
  const buttons = game.people.map((pid, j) => {
    const cls = revealed ? (plays[j] === max ? "win" : revealed.pick === pid ? "lose" : "") : "";
    return `<button type="button" data-who="${pid}" class="${cls}" style="--c:${color(pid)}" ${revealed ? "disabled" : ""}>
      ${esc(pname(pid))}${revealed ? `<small>${plays[j].toLocaleString()} plays</small>` : ""}</button>`;
  }).join("");
  const last = game.round + 1 >= game.total;
  $("game-stage").innerHTML = `<p class="g-q">Round ${game.round + 1} of ${game.total}: who played this more ${esc(frameLabel())}?</p>
    <div class="g-pair">${songCard(s)}</div>
    <div class="g-who-buttons">${buttons}</div>
    <div class="g-actions">${revealed
      ? `<p class="g-result ${revealed.ok ? "ok" : "bad"}">${revealed.ok ? "Right!" : "Nope."}</p>
         <button type="button" data-g="${last ? "done" : "next"}">${last ? "See your score" : "Next song"}</button>` : ""}</div>
    <p class="g-score">Score ${game.score} / ${game.round + (revealed ? 1 : 0)}</p>`;
}

function answerWho(pid) {
  const s = game.a, j = game.people.indexOf(pid), plays = s.per.map(x => x ? x.plays : 0);
  const ok = plays[j] === Math.max(...plays);
  if (ok) game.score++;
  renderWho({pick: pid, ok});
}

function finishWho() {
  const key = "who:" + game.people.map(pname).join("+");
  saveBest(key, game.score);
  const msg = game.score === game.total ? "Perfect. You know each other’s music by heart."
    : game.score >= game.total * 0.7 ? "Impressive. You pay attention."
    : game.score >= game.total * 0.4 ? "Not bad. Some surprises in there."
    : "You might want to listen to each other more.";
  $("game-stage").innerHTML = `<div class="g-final"><p class="huge">${game.score} / ${game.total}</p><p class="big-line">${esc(msg)}</p>
    <p class="g-score">Best ${bestScore(key)} / ${game.total}</p><div class="g-actions"><button type="button" data-g="again">Play again</button></div></div>`;
}

$("game-open").addEventListener("click", openGame);
$("game-close").addEventListener("click", () => $("game").close());
$("game-modes").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]");
  if (!b || b.dataset.mode === game.mode) return;
  game.mode = b.dataset.mode;
  $("game-modes").querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  newGame();
});
$("game-stage").addEventListener("change", e => {
  if (e.target.id === "g-person") { game.pid = +e.target.value; newGame(); }
});
$("game-stage").addEventListener("click", e => {
  const g = e.target.closest("[data-g]")?.dataset.g, who = e.target.closest("[data-who]");
  if (who && !who.disabled) return answerWho(+who.dataset.who);
  if (g === "higher" || g === "lower") return answerHilo(g === "higher");
  if (g === "again") return newGame();
  if (g === "done") return finishWho();
  if (g === "next") {
    if (game.mode === "hilo") { game.a = game.b; game.b = pick(); renderHilo(); }
    else { game.round++; game.a = pick(); renderWho(); }
  }
});

// ------------------------------------------------------------ time travel --
const TT_TABS = [["comebacks", "Comebacks"], ["steady", "Ever-present"], ["flings", "Flings"],
                 ["slow", "Slow burners"], ["otd", "On this day"], ["found", "Found it first"]];
let ttTab = "comebacks", ttData = null;
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
function fmtMonths(m) {
  const y = Math.floor(m / 12), r = m % 12;
  return y ? plural(y, "year") + (r ? " " + plural(r, "month") : "") : plural(r, "month");
}
function fmtDays(d) {
  if (d >= 60) return fmtMonths(Math.round(d / 30.44));
  return plural(d, "day");
}
const monthLabel = m => new Date(m + "-01T00:00").toLocaleDateString(undefined, {month: "short", year: "numeric"});

function renderTimeTravel(t) {
  if (!t?.people?.length) return "";
  ttData = t;
  const tabs = TT_TABS.filter(([k]) => k !== "found" || t.found.length);
  if (!tabs.some(([k]) => k === ttTab)) ttTab = "comebacks";
  return `<div><h3>Time travel <span class="muted">how songs move through your years</span></h3>
    <div class="tabs tt-tabs" role="tablist" aria-label="Time travel">${tabs.map(([k, l]) =>
      `<button type="button" role="tab" data-tt="${k}" aria-selected="${k === ttTab}">${l}</button>`).join("")}</div>
    <div id="tt-body">${ttBody()}</div></div>`;
}

const TT_INTRO = {
  comebacks: "Songs you played, left alone for a long time, then came back to.",
  steady: "Songs that kept coming back, month after month.",
  flings: "Intense, short obsessions: most plays within 30 days, then nothing for at least 6 months.",
  slow: "Songs that took a while: their busiest month came long after you first heard them.",
};

function ttRow(s, stat, detail) {
  return `<li><button type="button" data-open-key="${esc(s.key)}" data-title="${esc(s.title)}" data-sub="${esc(s.sub)}">
    ${cover(s.cover_key)}<span><b>${esc(s.title)}</b> <span class="muted">${esc(s.sub)}</span>
    <strong>${stat}</strong><small>${detail}</small></span></button></li>`;
}

function ttBody() {
  const t = ttData, many = META.people.length > 1;
  const who = pid => many ? `<p class="who-h" style="--c:${color(pid)}"><b>${esc(pname(pid))}</b></p>` : "";
  const scope = state.view === "rediscover" ? "over the whole history" : frameLabel();
  if (ttTab === "found") {
    return t.found.map(f => {
      const A = pname(f.a), B = pname(f.b), wa = f.wins[f.a] || 0, wb = f.wins[f.b] || 0;
      const lead = wa === wb ? "It’s a tie" : `${esc(wa > wb ? A : B)} is the trendsetter`;
      return `<p class="tt-summary">${lead}: of the songs you both play, ${esc(A)} found ${plural(wa, "song")} first and
        ${esc(B)} found ${plural(wb, "song")} first${f.wins.tie ? ` (${f.wins.tie} on the same day)` : ""}.</p>
        <p class="muted tt-intro">Counted from ${esc(niceDay(f.since))}, once both histories had started, so neither of you
        gets credit for songs the other knew before their data begins.</p>
        ${f.songs.length ? `<ol class="tt-list">${f.songs.map(s => ttRow(s,
          `${esc(pname(s.first))}, ${fmtDays(s.lead_days)} earlier`,
          `First played ${esc(niceDay(s.found))}; ${esc(pname(s.second))} followed on ${esc(niceDay(s.followed))} ·
           ${esc(A)} ${s.plays[0]} plays, ${esc(B)} ${s.plays[1]}`)).join("")}</ol>`
          : `<p class="muted">No shared songs that you both played at least 3 times ${esc(scope)}.</p>`}`;
    }).join("");
  }
  if (ttTab === "otd") {
    const today = new Date(t.today + "T00:00").toLocaleDateString(undefined, {day: "numeric", month: "long"});
    return `<p class="muted tt-intro">What you played on ${esc(today)} in earlier years, from your whole history.</p>
      <div class="ins-grid">${t.people.map(p => `<div>${who(p.pid)}${p.on_this_day.length
        ? `<ol class="tt-list">${p.on_this_day.map(o => ttRow(o.top, esc(o.date.slice(0, 4)),
            `${plural(o.plays, "play")} of ${plural(o.songs, "song")} · ${fmt(o.ms)} · this was the most played`)).join("")}</ol>`
        : `<p class="muted">Nothing played on ${esc(today)} in earlier years.</p>`}</div>`).join("")}</div>`;
  }
  const rows = {
    comebacks: s => ttRow(s, `${fmtDays(s.gap_days)} away`,
      `Last played ${esc(niceDay(s.left))}, back on ${esc(niceDay(s.back))} · ${s.before} plays before, ${s.after} since`),
    steady: s => ttRow(s, `${plural(s.months, "month")}`,
      `Played in ${s.months} of the ${s.span} months from ${esc(niceDay(s.first))} to ${esc(niceDay(s.last))} · ${s.plays.toLocaleString()} plays`),
    flings: s => ttRow(s, `${s.window} plays in 30 days`,
      `From ${esc(niceDay(s.start))}${s.window < s.plays ? ` (${s.plays} in total)` : ""}; last played ${esc(niceDay(s.last))}`),
    slow: s => ttRow(s, `${fmtMonths(s.delay_months)} to peak`,
      `First played ${esc(niceDay(s.first))}, busiest in ${esc(monthLabel(s.peak))} with ${s.peak_plays} plays`),
  }[ttTab];
  const empty = {
    comebacks: "No song had a break of 2+ months with plays on both sides here. Try a longer time frame.",
    steady: "No song played in several different months here yet.",
    flings: "No flings: nothing was played this intensely and then dropped.",
    slow: "No slow burners here. Try a longer time frame.",
  }[ttTab];
  return `<p class="muted tt-intro">${TT_INTRO[ttTab]} ${esc(scope[0].toUpperCase() + scope.slice(1))}.</p>
    <div class="ins-grid">${t.people.map(p => `<div>${who(p.pid)}${p[ttTab].length
      ? `<ol class="tt-list">${p[ttTab].slice(0, 8).map(rows).join("")}</ol>` : `<p class="muted">${empty}</p>`}</div>`).join("")}</div>`;
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-tt]");
  if (!b || !ttData) return;
  ttTab = b.dataset.tt;
  b.parentElement.querySelectorAll("[data-tt]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  $("tt-body").innerHTML = ttBody();
});


// ------------------------------------------------------- around the clock --
let clockPart = 0, clockData = null;
const hourName = h => new Date(2024, 0, 1, h % 24).toLocaleTimeString(undefined, {hour: "numeric"});
const partRange = dp => `${hourName(dp.from)}–${hourName(dp.to)}`;
const pctSmall = x => x > 0 && x < 0.005 ? "<1%" : pct(x);

// 24 wedges, one per hour, length = listening that hour; the chosen 3-hour block is highlighted
function radialClock(hours, col, sel, dps) {
  const cx = 110, cy = 110, r0 = 34, r1 = 92, max = Math.max(1, ...hours);
  const pt = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  let svg = `<svg class="radial" viewBox="0 0 220 220" role="img" aria-label="Listening by hour of the day">
    <circle cx="${cx}" cy="${cy}" r="${r1}" class="rc-guide"/><circle cx="${cx}" cy="${cy}" r="${r0}" class="rc-guide"/>`;
  hours.forEach((v, h) => {
    const a0 = h / 24 * 2 * Math.PI - Math.PI / 2 + 0.018, a1 = (h + 1) / 24 * 2 * Math.PI - Math.PI / 2 - 0.018;
    const r = r0 + (r1 - r0) * Math.sqrt(v / max);
    const on = Math.floor(h / 3) === sel;
    svg += `<path d="M${pt(r0, a0)} L${pt(r, a0)} A${r} ${r} 0 0 1 ${pt(r, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 0 0 ${pt(r0, a0)} Z"
      fill="${col}" opacity="${on ? 1 : 0.3}" data-part="${Math.floor(h / 3)}"><title>${hourName(h)}–${hourName(h + 1)}: ${fmt(v)}</title></path>`;
  });
  dps.forEach((dp, b) => {
    const a = (b * 3 + 1.5) / 24 * 2 * Math.PI - Math.PI / 2;
    svg += `<text x="${(cx + 104 * Math.cos(a)).toFixed(1)}" y="${(cy + 104 * Math.sin(a) + 5).toFixed(1)}" text-anchor="middle"
      class="rc-emoji${b === sel ? " on" : ""}" data-part="${b}">${dp.emoji}<title>${esc(dp.name)}</title></text>`;
  });
  [0, 6, 12, 18].forEach(h => {
    const a = h / 24 * 2 * Math.PI - Math.PI / 2;
    svg += `<text x="${(cx + 22 * Math.cos(a)).toFixed(1)}" y="${(cy + 22 * Math.sin(a) + 3.5).toFixed(1)}" text-anchor="middle" class="rc-hour">${h}</text>`;
  });
  return svg + `</svg>`;
}

function renderClock(c) {
  if (!c?.people?.some(p => p.plays)) return "";
  clockData = c;
  return `<div><h3>Around the clock <span class="muted">when you listen, and what you play at each hour</span></h3>
    <div class="tabs dp-tabs" role="tablist" aria-label="Time of day">${c.dayparts.map((dp, b) =>
      `<button type="button" role="tab" data-part="${b}" aria-selected="${b === clockPart}">${dp.emoji} ${esc(dp.name)}</button>`).join("")}</div>
    <div id="clock-body">${clockBody()}</div></div>`;
}

function clockBody() {
  const c = clockData, dp = c.dayparts[clockPart], many = META.people.length > 1;
  return `<div class="ins-grid">${c.people.map(p => {
    const part = p.parts[clockPart], your = many ? pname(p.pid) + "’s" : "your";
    const list = part.signature.length
      ? `<p class="muted tt-intro">Signature songs: played here far more than ${esc(your)} usual.</p>
         <ol class="tt-list">${part.signature.slice(0, 6).map(s => ttRow(s, `${pct(s.own)} of its plays`,
           `${s.plays_here} of ${plural(s.plays, "play")} are during ${esc(dp.name.toLowerCase())}`)).join("")}</ol>`
      : part.top.length
        ? `<p class="muted tt-intro">Most played during ${esc(dp.name.toLowerCase())}:</p>
           <ol class="tt-list">${part.top.slice(0, 5).map(s => ttRow(s, plural(s.plays_here, "play"), "")).join("")}</ol>`
        : `<p class="muted">${dp.id === "demon" ? "No demon hours here. Respect." : "Nothing played at this time of day."}</p>`;
    return `<div class="clock-card">${many ? `<p class="who-h" style="--c:${color(p.pid)}"><b>${esc(pname(p.pid))}</b></p>` : ""}
      <div class="clock-top">${radialClock(p.hours, color(p.pid), clockPart, c.dayparts)}
        <div><p class="clock-name">${dp.emoji} ${esc(dp.name)}</p>
          <p class="muted">${esc(partRange(dp))}</p>
          <p><b>${pctSmall(part.share)}</b> of ${esc(your)} listening · ${plural(part.plays, "play")}</p>
          ${part.artist ? `<p class="muted">Top artist: ${esc(part.artist)}</p>` : ""}</div></div>${list}</div>`;
  }).join("")}</div>`;
}

document.addEventListener("click", e => {
  const el = e.target.closest("#insights-body [data-part]");
  if (!el || !clockData) return;
  clockPart = +el.dataset.part;
  document.querySelectorAll(".dp-tabs [data-part]").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.part === clockPart)));
  $("clock-body").innerHTML = clockBody();
});

// song popup: what time of day it gets played
const DP_NAMES = [["😈", "Demon hours"], ["👻", "Ghost hours"], ["🌅", "Sunrise"], ["☕", "Coffee hours"],
                  ["🍜", "Lunch break"], ["🌤️", "Afternoon drift"], ["🌇", "Golden hour"], ["🌙", "Night drive"]];
function hoursSection(d) {
  const h = d.hours || [], total = h.reduce((a, b) => a + b, 0);
  if (total < 3) return "";
  const blocks = DP_NAMES.map((_, b) => h[3 * b] + h[3 * b + 1] + h[3 * b + 2]);
  const best = blocks.indexOf(Math.max(...blocks)), share = blocks[best] / total;
  const [emoji, name] = DP_NAMES[best];
  const range = `${hourName(best * 3)}–${hourName(best * 3 + 3)}`;
  const max = Math.max(...h), W = 600, H = 90, bw = W / 24;
  const bars = h.map((v, i) => `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${(H - 18 - (H - 24) * v / max).toFixed(1)}"
    width="${(bw - 3).toFixed(1)}" height="${((H - 24) * v / max).toFixed(1)}" rx="2"
    class="${Math.floor(i / 3) === best ? "hb on" : "hb"}"><title>${hourName(i)}: ${plural(v, "play")}</title></rect>`).join("");
  const ticks = [0, 6, 12, 18].map(i => `<text x="${(i * bw + 2).toFixed(1)}" y="${H - 3}">${hourName(i)}</text>`).join("");
  const kind = d.kind === "track" ? "song" : d.kind;
  return `<section class="hours"><h3>When it gets played</h3>
    <p>${share >= 0.3 ? `Mostly a <b>${emoji} ${esc(name)}</b> ${kind}` : `Played all day, most during <b>${emoji} ${esc(name)}</b>`}:
      ${pct(share)} of plays are ${esc(range)}.</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plays by hour of the day">${bars}${ticks}</svg></section>`;
}
