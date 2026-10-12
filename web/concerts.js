"use strict";
// Prepare for the concert: your upcoming shows, and for each one the songs to brush up on:
// their popular songs, favourites you forgot, songs to learn. Never setlists: no spoilers.
// Uses helpers from app.js, fun.js and more.js (esc, enc, pname, color, pct, plural, moreList, …).

const cx = {list: null, cur: null, audio: null, playing: null, timer: null};

function cxWhen(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return days < 60 ? `in ${days} days` : `in ${Math.round(days / 30.4)} months`;
  const a = -days;
  return a < 60 ? `${a} days ago` : a < 730 ? `${Math.round(a / 30.4)} months ago` : `${Math.round(a / 365)} years ago`;
}
const cxDate = s => new Date(s + "T00:00").toLocaleDateString(undefined, {weekday: "short", day: "numeric", month: "long", year: "numeric"});

async function cxFetch(url) {
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

function openConcerts() {
  $("cx-dlg").showModal();
  cx.cur = null;
  loadConcerts();
}

async function loadConcerts(params = "") {
  $("cx-body").innerHTML = `<p class="muted cx-pad">Loading…</p>`;
  try {
    cx.list = await cxFetch("/api/concerts" + params);
    renderConcertList();
  } catch (e) {
    $("cx-body").innerHTML = `<p class="muted cx-pad">Couldn't load your concerts: ${esc(e.message)}</p>`;
  }
}

function cxPeopleStats(c) {
  return c.stats.map(s => `<span class="cx-chip${s.plays ? "" : " zero"}" style="--c:${color(s.pid)}">
    ${META.people.length > 1 ? `<b>${esc(pname(s.pid))}</b> ` : ""}${s.plays ? `${plural(s.plays, "play")} · ${plural(s.songs, "song")}` : "new to you"}</span>`).join("");
}

function cxCard(c) {
  const d = new Date(c.date + "T00:00");
  return `<li><button type="button" class="cx-card${c.past ? " past" : ""}" data-cx-open="${esc(c.id)}">
    <span class="cx-cal"><small>${esc(d.toLocaleDateString(undefined, {month: "short"}))}</small><b>${d.getDate()}</b></span>
    <span class="cx-info"><b>${esc(c.artist)}</b>
      <span class="muted">${esc(cxWhen(c.days))}${c.city ? " · " + esc(c.city) : ""}</span>
      <span class="cx-chips">${cxPeopleStats(c)}</span></span>
    <span class="cx-go" aria-hidden="true">›</span></button></li>`;
}

function renderConcertList() {
  const L = cx.list, up = L.concerts.filter(c => !c.past), past = L.concerts.filter(c => c.past).reverse();
  const many = META.people.length > 1;
  $("cx-body").innerHTML = `<div class="cx-pad">
    ${up.length ? `<ul class="cx-cards">${up.map(cxCard).join("")}</ul>`
      : `<p class="muted">No upcoming concerts yet. Add one below and you’ll get a list of songs to prepare.</p>`}
    <form class="cx-add" id="cx-add" autocomplete="off">
      <h3>Add a concert</h3>
      <div class="cx-fields">
        <label>Artist<input id="cx-artist" list="cx-artists" required placeholder="Who are you seeing?"></label>
        <datalist id="cx-artists"></datalist>
        <label>Date<input id="cx-date" type="date" required></label>
        <label><span>City <small>(optional)</small></span><input id="cx-city" placeholder="e.g. Berlin"></label>
      </div>
      ${many ? `<div class="cx-who"><span class="muted">Who’s going?</span>${META.people.map((p, pid) =>
        `<label class="cx-person" style="--c:${color(pid)}"><input type="checkbox" value="${pid}" ${state.people.includes(pid) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div>` : ""}
      <button type="submit">Add concert</button>
    </form>
    ${past.length ? `<details class="cx-past"><summary>Been there (${past.length})</summary><ul class="cx-cards">${past.map(cxCard).join("")}</ul></details>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- one show --
async function openConcert(id) {
  cx.cur = id;
  cxStop();
  $("cx-body").innerHTML = `<p class="muted cx-pad">Getting their popular songs and checking your history…</p>`;
  try {
    const d = await cxFetch("/api/concert?id=" + enc(id));
    if (cx.cur === id) renderConcert(d);
  } catch (e) {
    $("cx-body").innerHTML = `<div class="cx-pad"><button type="button" class="ghost" data-cx-back>‹ All concerts</button>
      <p class="muted">Couldn't prepare this one: ${esc(e.message)}</p></div>`;
  }
}

function cxChips(d, x) {
  return d.people.map((pid, j) => `<span class="cx-chip${x.plays[j] ? "" : " zero"}" style="--c:${color(pid)}">${
    d.people.length > 1 || META.people.length > 1 ? `<b>${esc(pname(pid))}</b> ` : ""}${x.plays[j] ? plural(x.plays[j], "play") : "never played"}</span>`).join("");
}

function cxRow(d, x, stat, detail = "") {
  const src = x.key ? `/api/cover?k=${enc(x.key)}` : x.cover;
  const prev = x.preview || (x.key ? `/api/preview?audio=1&k=${enc(x.key)}` : "");
  return `<li class="cx-row">
    <button type="button" class="cx-song" ${x.key ? `data-open-key="${esc(x.key)}"` : "disabled"} data-title="${esc(x.title)}" data-sub="${esc(d.artist)}">
      ${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<span class="cx-noimg">♪</span>`}
      <span><b>${esc(x.title)}</b> <strong>${stat}</strong>${detail ? `<small>${detail}</small>` : ""}<span class="cx-chips">${cxChips(d, x)}</span></span>
    </button>
    ${prev ? `<button type="button" class="cx-play" data-cxp="${esc(prev)}" aria-label="Play a preview of ${esc(x.title)}">▶</button>` : ""}
  </li>`;
}

function cxReady(d, p) {
  const r = p.ready, share = r.of ? r.known / r.of : 0;
  const what = "most popular songs";
  const verdict = !r.of ? "" : share >= 0.9 ? "Ready to sing along. 🎤" : share >= 0.6 ? "Nearly there." :
    share >= 0.3 ? "Some homework to do." : "Lots of homework. 📚";
  return r.of ? `<div class="cx-ready" style="--c:${color(p.pid)}">
      <p>${d.people.length > 1 ? `<b>${esc(pname(p.pid))}</b> knows` : "You know"} <b>${r.known} of the ${r.of}</b> ${what}. ${verdict}</p>
      <div class="cx-meter"><i style="width:${Math.round(share * 100)}%"></i></div></div>` : "";
}

function cxHistory(d, p) {
  const who = d.people.length > 1 ? esc(pname(p.pid)) : "You";
  if (!p.plays) return `<p>${who} ${d.people.length > 1 ? "hasn’t" : "haven’t"} played ${esc(d.artist)} yet: everything below is new.</p>`;
  return `<p>${p.rank ? `<b>#${p.rank}</b> artist for ${d.people.length > 1 ? esc(pname(p.pid)) : "you"} · ` : ""}
    ${who} played <b>${plural(p.plays, "time")}</b> (${fmt(p.ms)}) across ${plural(p.songs, "song")},
    from ${esc(nice(p.first))} to ${esc(nice(p.last))}.</p>`;
}

function renderConcert(d) {
  cx.data = d;
  const many = d.people.length > 1;
  const sec = (title, note, list, n, row) => list.length
    ? `<section class="cx-sec"><h3>${title} ${note ? `<span class="muted">${note}</span>` : ""}</h3>${moreList(list, n, row, "cx-list")}</section>` : "";
  const perPerson = (fn) => `<div class="ins-grid">${d.people.map((pid, j) => {
    const html = fn(j);
    return html ? `<div>${many ? `<p class="who-h" style="--c:${color(pid)}"><b>${esc(pname(pid))}</b></p>` : ""}${html}</div>` : "";
  }).join("")}</div>`;
  const info = d.people_full;

  const popular = sec("🔥 Their most popular songs", d.popular_source ? `from ${esc(d.popular_source)}` : "", d.popular, 10,
    x => cxRow(d, x, `#${x.rank}`));

  const learnNote = "their popular songs you barely know";
  const personal = perPerson(j => {
    const p = info[j];
    return cxHistory(d, p) + cxReady(d, p)
      + sec("📚 Learn these", learnNote, p.learn, 5, x => cxRow(d, x, `#${x.rank} popular`))
      + sec("💭 Forgotten favourites", "loved once, not played in months", p.forgotten, 5,
          x => cxRow(d, x, plural(x.plays[j], "play"), `last played ${esc(cxAgo(x.days_since))}`))
      + sec("🔁 On repeat lately", "the last 3 months", p.repeat, 4, x => cxRow(d, x, `${plural(x.recent, "play")} lately`))
      + sec("💎 Your deep cuts", "loved, but not their hits: fingers crossed", p.deep, 4, x => cxRow(d, x, plural(x.plays[j], "play")));
  });
  const shared = many ? sec("🤝 You all love these", "sing these together", d.shared, 6, x => cxRow(d, x, "")) : "";

  const after = d.after ? `<div class="cx-after">${d.people.map((pid, j) => {
    const a = d.after[j];
    if (!a.has_data) return `<p><b>${esc(pname(pid))}</b>: the listening data stops before a month after the show.</p>`;
    if (!a.before && !a.after) return `<p>${many ? `<b>${esc(pname(pid))}</b>: ` : ""}No plays in the month before or after the show.</p>`;
    const verdict = a.after > a.before * 1.5 ? "The show made it stick. 🔥" : a.after < a.before * 0.6 ? "Back to normal after." : "About the same.";
    return `<p>${many ? `<b>${esc(pname(pid))}</b>: ` : ""}${plural(a.before, "play")} in the month before → <b>${plural(a.after, "play")}</b> in the month after. ${verdict}</p>`;
  }).join("")}</div>` : "";

  $("cx-body").innerHTML = `<div class="cx-pad">
    <div class="cx-top">
      <button type="button" class="ghost" data-cx-back>‹ All concerts</button>
      <button type="button" class="ghost cx-del" data-cx-del="${esc(d.id)}">Remove concert</button>
    </div>
    <div class="cx-hero">
      ${d.picture ? `<img src="${esc(d.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="cx-noimg big">🎤</span>`}
      <div><h2>${esc(d.artist)}</h2>
        <p>${esc(cxDate(d.date))} · <b>${esc(cxWhen(d.days))}</b>${d.city ? " · " + esc(d.city) : ""}</p>
        ${d.errors.popular && !d.popular.length ? `<p class="muted">Couldn't get their popular songs (${esc(d.errors.popular)}); showing your own history only.</p>` : ""}
      </div>
    </div>
    ${after}
    ${personal}
    ${popular}${shared}
    <div class="g-actions"><button type="button" data-cx-copy>Copy prep playlist</button></div>
  </div>`;
}
const cxAgo = days => days < 60 ? `${days} days ago` : days < 730 ? `${Math.round(days / 30.4)} months ago` : `${Math.round(days / 365)} years ago`;

// the songs to practise, in order: popular first, then forgotten favourites
async function cxCopy(btn) {
  const d = cx.data, seen = new Set(), lines = [];
  const add = x => {
    const k = x.title.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    lines.push(x.spotify || `${x.title} — ${d.artist}`);
  };
  d.popular.slice(0, 15).forEach(add);
  d.people_full.forEach(p => p.forgotten.slice(0, 10).forEach(add));
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    const links = lines.filter(l => l.startsWith("https://")).length;
    toast(`Copied ${plural(lines.length, "song")}${links ? ` (${links} as Spotify links; paste them into a Spotify playlist)` : ""}.`);
  } catch {
    toast("Couldn't copy to the clipboard.");
  }
}

// ---------------------------------------------------------------- previews --
function cxStop() {
  if (cx.audio) cx.audio.pause();
  if (cx.playing) cx.playing.textContent = "▶";
  cx.playing = null;
}
function cxPlay(btn) {
  if (cx.playing === btn) return cxStop();
  cxStop();
  cx.audio ??= new Audio();
  cx.audio.src = btn.dataset.cxp;
  cx.audio.onended = cxStop;
  cx.audio.play().then(() => { cx.playing = btn; btn.textContent = "⏸"; })
    .catch(() => { btn.textContent = "✕"; btn.disabled = true; btn.title = "No preview available"; });
}

// ------------------------------------------------------------------ events --
$("cx-open").addEventListener("click", openConcerts);
$("cx-close").addEventListener("click", () => $("cx-dlg").close());
$("cx-dlg").addEventListener("close", cxStop);
$("cx-body").addEventListener("click", async e => {
  const t = e.target;
  const o = t.closest("[data-cx-open]");
  if (o) return openConcert(o.dataset.cxOpen);
  if (t.closest("[data-cx-back]")) { cxStop(); cx.cur = null; return loadConcerts(); }
  const del = t.closest("[data-cx-del]");
  if (del) {
    if (!confirm("Remove this concert?")) return;
    cxStop(); cx.cur = null;
    return loadConcerts("?remove=" + enc(del.dataset.cxDel));
  }
  const p = t.closest("[data-cxp]");
  if (p) return cxPlay(p);
  if (t.closest("[data-cx-copy]")) return cxCopy(t);
  const song = t.closest("[data-open-key]");
  if (song) openDetail({key: song.dataset.openKey, cover_key: song.dataset.openKey, kind: "track",
                        title: song.dataset.title, sub: song.dataset.sub});
});
$("cx-body").addEventListener("submit", e => {
  if (e.target.id !== "cx-add") return;
  e.preventDefault();
  const people = [...e.target.querySelectorAll(".cx-who input:checked")].map(i => i.value);
  const q = new URLSearchParams({add: 1, artist: $("cx-artist").value.trim(), date: $("cx-date").value,
                                 city: $("cx-city").value.trim(), people: people.join(",")});
  loadConcerts("?" + q);
});
$("cx-body").addEventListener("input", e => {
  if (e.target.id !== "cx-artist") return;
  clearTimeout(cx.timer);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  cx.timer = setTimeout(async () => {
    try {
      const d = await cxFetch("/api/artists?q=" + enc(q));
      $("cx-artists").innerHTML = d.artists.map(a => `<option value="${esc(a.title)}">`).join("");
    } catch { /* suggestions are optional */ }
  }, 200);
});
