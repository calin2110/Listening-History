"use strict";
// More insights (sessions, calendar, chosen vs served, devices, trips, love-hate, milestones,
// genres & decades, awards), three more games, and saving cards as images.
// Uses helpers and state from app.js and fun.js, which load first.

const who = pid => META.people.length > 1 ? `<p class="who-h" style="--c:${color(pid)}"><b>${esc(pname(pid))}</b></p>` : "";
const yourOf = pid => META.people.length > 1 ? pname(pid) + "’s" : "your";
const grid = (people, fn) => `<div class="ins-grid">${people.map(p => `<div>${who(p.pid)}${fn(p)}</div>`).join("")}</div>`;
const nice = s => s ? niceDay(s) : "";
const dateTime = ts => new Date(ts * 1000).toLocaleString(undefined, {day: "numeric", month: "short", year: "numeric",
                                                                         hour: "numeric", minute: "2-digit"});
const pctS = x => x > 0 && x < 0.005 ? "<1%" : pct(x);

// ---------------------------------------------------------------- sessions --
function renderSessions(m) {
  return `<div><h3>Sessions <span class="muted">a 30-minute break starts a new one</span></h3>${grid(m.people, p => {
    const s = p.sessions;
    if (!s.count) return `<p class="muted">No listening here.</p>`;
    const L = s.longest;
    const list = (xs, verb) => xs.length ? `<ol class="tt-list">${xs.slice(0, 3).map(x => ttRow(x,
      `${verb} ${plural(x.times, "session")}`, `${pct(x.times / x.of)} of ${yourOf(p.pid)} sessions`)).join("")}</ol>`
      : `<p class="muted">No clear favorite yet.</p>`;
    return `<p class="big-stat">${plural(s.count, "session")}</p>
      <p class="muted">Usually ${fmt(s.median_ms)} long, ${s.avg_songs} songs on average.</p>
      ${L ? `<p>Longest: <b>${fmt(L.ms)}</b> and ${plural(L.songs, "song")}, from ${esc(dateTime(L.start_ts))}
        to ${esc(dateTime(L.end_ts))}, mostly ${esc(L.top.title)}.</p>` : ""}
      <p class="sub-h">🎬 Go-to openers</p>${list(s.openers, "Opened")}
      <p class="sub-h">🎞️ Go-to closers</p>${list(s.closers, "Closed")}`;
  })}</div>`;
}

// ---------------------------------------------------- seasons and weekdays --
const calSel = {seasons: null, weekdays: 4};
function bucketBlock(kind, p, i) {
  const b = p[kind][i];
  if (!b) return "";
  const list = b.signature.length
    ? `<ol class="tt-list">${b.signature.slice(0, 5).map(s => ttRow(s, `${pct(s.own)} of its plays`,
        `${s.plays_here} of ${plural(s.plays, "play")} are on ${kind === "weekdays" ? esc(b.name) + "s" : "in " + esc(b.name.toLowerCase())}`)).join("")}</ol>`
    : b.top.length ? `<p class="muted tt-intro">No standouts; most played:</p><ol class="tt-list">${b.top.slice(0, 3).map(s =>
        ttRow(s, plural(s.plays_here, "play"), "")).join("")}</ol>` : `<p class="muted">Nothing played.</p>`;
  return `<p><b>${pctS(b.share)}</b> of ${esc(yourOf(p.pid))} listening${b.artist ? ` · top artist ${esc(b.artist)}` : ""}</p>${list}`;
}
function renderCalendar(m) {
  moreData = m;
  const p0 = m.people[0];
  if (calSel.seasons === null) {                                         // start with the current season
    calSel.seasons = Math.floor((new Date().getMonth() + 1) % 12 / 3);
  }
  const tabs = (kind, items) => `<div class="tabs cal-tabs" role="tablist">${items.map((b, i) =>
    `<button type="button" role="tab" data-cal="${kind}" data-i="${i}" aria-selected="${i === calSel[kind]}">${b.emoji} ${esc(b.name)}</button>`).join("")}</div>`;
  const xmas = m.people.some(p => p.christmas.length) ? `<p class="sub-h">🎄 When Christmas music starts</p>${grid(m.people, p => {
    if (!p.christmas.length) return `<p class="muted">No Christmas music found.</p>`;
    const md = p.christmas.map(x => x.first.slice(5)).sort();
    const usual = md[Math.floor(md.length / 2)];
    return `<p>Usually around <b>${new Date("2024-" + usual + "T00:00").toLocaleDateString(undefined, {day: "numeric", month: "long"})}</b>.</p>
      <ol class="tt-list">${p.christmas.slice().reverse().slice(0, 5).map(x => ttRow(x.top, `${x.year}: from ${esc(nice(x.first))}`,
        `${plural(x.plays, "Christmas play")}, mostly ${esc(x.top.title)}`)).join("")}</ol>`;
  })}` : "";
  const friday = `<p class="sub-h">🎉 Friday night anthem <span class="muted">Friday 6 pm to Saturday 4 am</span></p>${grid(m.people, p =>
    p.friday.length ? `<ol class="tt-list">${p.friday.slice(0, 3).map(s => ttRow(s,
      s.own ? `${pct(s.own)} of its plays` : plural(s.plays_here, "play"),
      s.own ? `${s.plays_here} of ${plural(s.plays, "play")} are on Friday nights` : "on Friday nights")).join("")}</ol>`
      : `<p class="muted">No Friday nights here.</p>`)}`;
  return `<div id="cal-box"><h3>Seasons and weekdays</h3>
    ${tabs("seasons", p0.seasons)}<div id="cal-seasons">${grid(m.people, p => bucketBlock("seasons", p, calSel.seasons))}</div>
    ${xmas}
    <div class="cal-gap"></div>${tabs("weekdays", p0.weekdays)}<div id="cal-weekdays">${grid(m.people, p => bucketBlock("weekdays", p, calSel.weekdays))}</div>
    ${friday}</div>`;
}
let moreData = null;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-cal]");
  if (!b || !moreData) return;
  const kind = b.dataset.cal;
  calSel[kind] = +b.dataset.i;
  b.parentElement.querySelectorAll("[data-cal]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  $("cal-" + kind).innerHTML = grid(moreData.people, p => bucketBlock(kind, p, calSel[kind]));
});

// -------------------------------------------------------- chosen vs served --
const MODE_INFO = {picked: ["👆", "You picked it", "#2f9e44"], flow: ["💿", "Album / playlist flow", "#5c7cfa"],
                   shuffle: ["🔀", "Shuffle", "#f59f00"], autoplay: ["📻", "Autoplay & radio", "#d6336c"]};
function stackBar(items) {
  return `<div class="stack">${items.filter(x => x.v > 0).map(x =>
    `<i style="flex:${x.v};background:${x.c}" title="${esc(x.l)} ${pct(x.v)}"></i>`).join("")}</div>
    <ul class="stack-legend">${items.filter(x => x.v > 0).map(x =>
      `<li><span style="background:${x.c}"></span>${x.e} ${esc(x.l)} <b>${pctS(x.v)}</b></li>`).join("")}</ul>`;
}
function renderModes(m) {
  if (!m.people.some(p => p.modes.known)) return "";
  return `<div><h3>Chosen or served? <span class="muted">how songs started playing</span></h3>${grid(m.people, p => {
    const md = p.modes;
    if (!md.known) return `<p class="muted">This export doesn’t say how songs started (Tidal doesn’t record it).</p>`;
    const bar = stackBar(m.modes.map(k => ({v: md.share[k] || 0, c: MODE_INFO[k][2], e: MODE_INFO[k][0], l: MODE_INFO[k][1]})));
    const auto = (md.share.shuffle || 0) + (md.share.autoplay || 0);
    const verdict = md.has_picked
      ? `You picked <b>${pct(md.share.picked || 0)}</b> of your listening yourself; ${pct(auto)} was shuffle or autoplay.`
      : `${pct(auto)} of this was shuffle or autoplay. (Apple Music doesn’t record which songs you started yourself.)`;
    return `<p>${verdict}</p>${bar}
      ${md.picked.length ? `<p class="sub-h">👆 Songs you choose on purpose</p><ol class="tt-list">${md.picked.slice(0, 4).map(s =>
        ttRow(s, `picked ${pct(s.own)} of the time`, `${s.plays_here} of ${plural(s.plays, "play")} started by you`)).join("")}</ol>` : ""}
      ${md.served.length ? `<p class="sub-h">🎲 Songs that just come on</p><ol class="tt-list">${md.served.slice(0, 4).map(s =>
        ttRow(s, `${pct(s.own)} served`, `${s.plays_here} of ${plural(s.plays, "play")} came from shuffle, autoplay or the queue`)).join("")}</ol>` : ""}`;
  })}</div>`;
}

// ----------------------------------------------------------------- devices --
const DEV_INFO = {phone: ["📱", "Phone", "#0c8599"], computer: ["💻", "Computer", "#7048e8"], tv: ["📺", "TV, console & speakers", "#e8590c"]};
function renderDevices(m) {
  if (!m.people.some(p => p.devices.length)) return "";
  return `<div><h3>Phone or laptop? <span class="muted">where the music plays</span></h3>${grid(m.people, p => {
    if (!p.devices.length) return `<p class="muted">No device information in this export.</p>`;
    const top = p.devices.slice().sort((a, b) => b.share - a.share)[0];
    return `<p>Mostly a <b>${DEV_INFO[top.id][0]} ${esc(DEV_INFO[top.id][1].toLowerCase())}</b> listener: ${pct(top.share)}.</p>
      ${stackBar(p.devices.map(d => ({v: d.share, c: DEV_INFO[d.id][2], e: DEV_INFO[d.id][0], l: DEV_INFO[d.id][1]})))}
      ${p.devices.filter(d => d.signature.length).map(d => `<p class="sub-h">${DEV_INFO[d.id][0]} ${esc(DEV_INFO[d.id][1])} songs</p>
        <ol class="tt-list">${d.signature.slice(0, 3).map(s => ttRow(s, `${pct(s.own)} of its plays`,
          `${s.plays_here} of ${plural(s.plays, "play")}`)).join("")}</ol>`).join("")}`;
  })}</div>`;
}

// ------------------------------------------------------------------- trips --
function renderTrips(m) {
  const blocks = m.people.map(p => {
    const merged = new Map();
    p.places.forEach(x => {
      const name = placeName(x.place), y = merged.get(name);
      if (!y) return merged.set(name, {...x, name});
      y.ms += x.ms; y.plays += x.plays; y.days += x.days;
      y.first = y.first < x.first ? y.first : x.first; y.last = y.last > x.last ? y.last : x.last;
      if (x.top[0] && (!y.top[0] || x.top[0].ms > y.top[0].ms)) y.top = x.top;
    });
    const all = [...merged.values()].sort((a, b) => b.ms - a.ms);
    return {pid: p.pid, home: all[0], trips: all.slice(1).filter(x => x.ms >= 600000)};
  });
  if (!blocks.some(b => b.trips.length)) return "";
  return `<div><h3>Vacation soundtracks <span class="muted">what you played away from home</span></h3>${grid(blocks, b => {
    if (!b.trips.length) return `<p class="muted">Everything was played in ${esc(b.home?.name || "one place")}.</p>`;
    return `<p class="muted">Home: ${esc(b.home.name)}</p>${b.trips.slice(0, 6).map(t => `<div class="trip">
      <p><b>✈️ ${esc(t.name)}</b> <span class="muted">${plural(t.days, "day")} · ${hours(t.ms)} ·
        ${t.first === t.last ? esc(nice(t.first)) : esc(nice(t.first)) + " to " + esc(nice(t.last))}</span></p>
      <div class="trip-covers">${t.top.slice(0, 5).map(s => `<button type="button" data-open-key="${esc(s.key)}"
        data-title="${esc(s.title)}" data-sub="${esc(s.sub)}" title="${esc(s.title)} by ${esc(s.sub)}, ${fmt(s.ms)}">${cover(s.cover_key)}</button>`).join("")}</div>
      </div>`).join("")}`;
  })}</div>`;
}

// --------------------------------------------------------------- love-hate --
function renderLoveHate(m) {
  return `<div><h3>Love–hate songs <span class="muted">skipped a lot, played anyway</span></h3>${grid(m.people, p =>
    p.lovehate.length ? `<ol class="tt-list">${p.lovehate.slice(0, 6).map(s => ttRow(s, `skipped ${pct(s.rate)} of the time`,
      `${s.skips} skips in ${s.skip_n} starts, still played ${plural(s.plays, "time")} over ${plural(s.months, "month")}`)).join("")}</ol>`
      : `<p class="muted">No love–hate songs: you either let them play or never come back.</p>`)}</div>`;
}

// -------------------------------------------------------------- milestones --
function renderMilestones(m) {
  if (!m.people.some(p => p.milestones.length)) return "";
  const label = x => x.kind === "play" ? (x.n === 1 ? "Your very first play" : `Play #${x.n.toLocaleString()}`)
    : `${plural(x.n, "hour")} of music`;
  return `<div><h3>Milestones <span class="muted">over the whole history</span></h3>${grid(m.people, p =>
    `<ol class="tt-list">${p.milestones.slice().reverse().map(x => ttRow(x.song, esc(label(x)),
      `${esc(nice(x.date))} · ${esc(x.song.title)} by ${esc(x.song.sub)}`)).join("")}</ol>`)}</div>`;
}

// ---------------------------------------------------------- genres & decades --
const GENRE_COLORS = ["#e8590c", "#7048e8", "#0c8599", "#d6336c", "#f59f00", "#2f9e44", "#5c7cfa", "#868e96"];
function renderMusic(mu) {
  const prog = mu.progress;
  const note = prog.total && prog.looked_up < prog.total
    ? `Music info found so far covers what you see here; ${(prog.total - prog.looked_up).toLocaleString()} songs are still being
       looked up in the background (about 20 a minute). Reopen Insights later for more.`
    : "";
  const body = grid(mu.people, p => {
    if (!p.genres.length && !p.decades.length) return `<p class="muted">No music info yet for this listening. It’s being looked up
      in the background; check back in a few minutes.</p>`;
    const gmax = p.genres[0]?.share || 1;
    const genres = p.genres.slice(0, 8).map((g, i) => `<li><span>${esc(g.genre)}</span><span class="muted">${pctS(g.share)}</span>
      <div class="bars"><i style="width:${g.share / gmax * 100}%;background:${GENRE_COLORS[i % 8]}"></i></div></li>`).join("");
    const topG = p.genres.slice(0, 6).map(g => g.genre);
    const years = p.genre_years.length > 1 ? `<p class="sub-h">Genres by year</p><div class="gyears">${p.genre_years.map(y => `
      <div class="gy"><span class="muted">${y.year}</span><div class="stack">${topG.map((g, i) => y.shares[g]
        ? `<i style="flex:${y.shares[g]};background:${GENRE_COLORS[i]}" title="${esc(g)} ${pct(y.shares[g])}"></i>` : "").join("")}</div>
        <span class="gy-top">${esc(y.top)}</span></div>`).join("")}</div>` : "";
    const dmax = Math.max(...p.decades.map(d => d.share), 0.0001);
    const decades = p.decades.length ? `<p class="sub-h">Decades</p><div class="decades">${p.decades.map(d => `
      <div title="${d.decade}s: ${pct(d.share)}"><i style="height:${Math.max(2, d.share / dmax * 100)}%"></i><span>${String(d.decade).slice(2)}s</span></div>`).join("")}</div>` : "";
    const age = p.avg_age !== null ? `<p>Your songs are on average <b>${p.avg_age} years old</b> when you play them
      (released around ${p.avg_year}); <b>${pct(p.old_share)}</b> of your listening is songs 10+ years old.
      ${p.old_share >= 0.5 ? "Certified nostalgic. 🕰️" : p.old_share <= 0.2 ? "Always on the new stuff. 🆕" : ""}</p>
      ${p.oldest ? `<p class="muted">Oldest regular: ${esc(p.oldest.title)} by ${esc(p.oldest.sub)} (${p.oldest.year}).
        Newest: ${esc(p.newest.title)} by ${esc(p.newest.sub)} (${p.newest.year}).</p>` : ""}` : "";
    const len = p.patience !== null ? `<p class="sub-h">Song length</p>
      <p>Average song: <b>${fmt(p.avg_len_ms)}</b>. Patience score: <b>${pct(p.patience)}</b> of plays heard to the end.</p>
      ${p.longest_finished.length ? `<ol class="tt-list">${p.longest_finished.slice(0, 3).map(s => ttRow(s,
        `${fmt(s.duration_ms)}, heard to the end`, plural(s.plays, "play"))).join("")}</ol>` : ""}` : "";
    return `${p.genres.length ? `<p class="sub-h">Top genres</p><ul class="places">${genres}</ul>` : ""}${years}${decades}${age}${len}
      <p class="muted cov">Based on ${pct(p.coverage_genre)} of this listening with known genre.</p>`;
  });
  return `<div><h3>Genres and decades</h3>${note ? `<p class="muted tt-intro">${esc(note)}</p>` : ""}${body}</div>`;
}

// ------------------------------------------------------------------ awards --
function computeAwards({f, t, c, m, mu}) {
  const ppl = state.people;
  const fp = pid => f?.people.find(p => p.pid === pid);
  const mp = pid => m?.people.find(p => p.pid === pid);
  const mup = pid => mu?.people.find(p => p.pid === pid);
  const countries = pid => new Set((mp(pid)?.places || []).map(x => placeName(x.place))).size;
  const trend = pid => (t?.found || []).reduce((a, x) => a + (x.wins[pid] || 0), 0);
  const defs = [
    ["🎧", "Most dedicated", "Listened the most", pid => fp(pid)?.ms, v => hours(v)],
    ["😈", "Demon of the night", "Most listening between midnight and 3 am", pid => fp(pid)?.stats.demon, pct],
    ["🌅", "Early bird", "Most listening between 5 and 9 am", pid => fp(pid)?.stats.morning, pct],
    ["💍", "Most loyal", "Top 10 songs take the biggest share", pid => fp(pid)?.stats.top10, pct],
    ["🧭", "Explorer", "The most different songs", pid => fp(pid)?.songs, v => plural(v, "song")],
    ["🔁", "Repeat offender", "Longest same-song streak", pid => fp(pid)?.stats.streak, v => "×" + v],
    ["🏃", "Marathoner", "Biggest single day of music", pid => fp(pid)?.stats.best_day_ms, fmt],
    ["🎬", "Session champion", "Longest listening session", pid => mp(pid)?.sessions.longest?.ms, fmt],
    ["⏭️", "Restless thumb", "Skips the most", pid => fp(pid)?.stats.skip_n >= 50 ? fp(pid).stats.skip_rate : null, pct],
    ["🧘", "Most patient", "Hears the most songs to the end", pid => mup(pid)?.len_n >= 30 ? mup(pid).patience : null, pct],
    ["🕰️", "Time traveler", "Plays the oldest music", pid => mup(pid)?.avg_age, v => v + " years"],
    ["🔮", "Trendsetter", "Found your shared songs first", pid => t?.found?.length ? trend(pid) : null, v => plural(v, "song")],
    ["✈️", "Globetrotter", "Listened in the most countries", pid => m ? countries(pid) : null, v => v === 1 ? "1 country" : `${v} countries`],
  ];
  const awards = [];
  for (const [emoji, title, desc, get, show] of defs) {
    const vals = ppl.map(pid => ({pid, v: get(pid)})).filter(x => typeof x.v === "number" && x.v > 0);
    if (vals.length < 2) continue;
    vals.sort((a, b) => b.v - a.v);
    if (vals[0].v === vals[1].v) continue;                         // no award for a tie
    awards.push({emoji, title, desc, winner: vals[0].pid, vals: vals.map(x => ({pid: x.pid, text: show(x.v)}))});
  }
  return awards;
}
let lastAwards = [];
function renderAwards(all) {
  const awards = lastAwards = computeAwards(all);
  if (!awards.length) return "";
  const tally = {};
  awards.forEach(a => { tally[a.winner] = (tally[a.winner] || 0) + 1; });
  return `<div id="awards-box"><div class="share-row"><h3>🏆 Awards night</h3>
      <button type="button" class="ghost small" data-share="#awards-box" data-name="awards">Save image</button></div>
    <p class="tt-intro">${state.people.map(pid => `<b style="color:${color(pid)}">${esc(pname(pid))}</b> ${plural(tally[pid] || 0, "trophy")}`.replace("trophys", "trophies")).join(" · ")}</p>
    <div class="awards">${awards.map(a => `<div class="award" style="--c:${color(a.winner)}">
      <span class="trophy" aria-hidden="true">${a.emoji}</span><p class="aw-title">${esc(a.title)}</p>
      <p class="aw-winner">${esc(pname(a.winner))}</p><p class="muted aw-desc">${esc(a.desc)}</p>
      <p class="aw-vals">${a.vals.map(v => `<span>${esc(pname(v.pid))}: ${esc(v.text)}</span>`).join("")}</p></div>`).join("")}</div></div>`;
}


// =================================================================== games ==
const EXTRA_GAMES = {tune: startTune, bracket: startBracket, month: startMonth};
const gameBox = () => $("game-stage");
const pickPerson = label => state.people.length > 1
  ? `<label class="g-who">${label} <select data-x="person">${state.people.map(p =>
      `<option value="${p}" ${p === game.pid ? "selected" : ""}>${esc(pname(p))}</option>`).join("")}</select></label>` : "";
const choose = (arr, n) => shuffle(arr.slice()).slice(0, n);
async function poolFor(pid, size = 60) {
  const d = await getJSON("/api/tracks?" + listParams({people: pid, page: 1, size, q: "", sort: "plays",
                                                         view: "top", level: "track", min: 0, common: 0}));
  return d.items.filter(i => i.plays > 0);
}

// -------------------------------------------------------- name that tune --
// Heardle style: 0.1 s of the song, then 0.2, 0.5, 1, 2 and 5 s after each miss or skip.
// You type the title; suggestions come from your own songs. The clip is decoded with
// the Web Audio API so even 0.1 s is cut exactly. Clips for the whole game download in
// the background (3 at a time) as soon as it starts, so there's no wait between songs.
const TUNE_STAGES = [0.1, 0.2, 0.5, 1, 2, 5];
const tune = {rounds: 10, round: 0, score: 0, pool: [], names: [], cur: null, stage: 0, guesses: [], done: false,
              results: [], ctx: null, buf: null, src: null};
stopTune = () => { try { tune.src?.stop(); } catch { /* already stopped */ } tune.src = null; };
$("game").addEventListener("close", () => { tune.gen = (tune.gen || 0) + 1; });   // stop background downloads

const secs = s => `${s} s`;
function normSong(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s*[\(\[](feat|ft|with|featuring)\.?\s[^\)\]]*[\)\]]/g, "")
    .replace(/\s+-\s+.*(remaster|version|edit|live|mix).*$/g, "").replace(/\s*[\(\[][^\)\]]*(remaster|version|edit)[^\)\]]*[\)\]]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9Ѐ-ӿĀ-ɏ ]+/g, " ").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
}
function lev(a, b) {
  const d = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
function isRight(guess, song) {
  const g0 = String(guess).split(" — ")[0];                  // a picked suggestion reads "Title — Artist"
  const want = normSong(song.title);
  const tries = [g0, g0.includes(" - ") ? g0.split(" - ").slice(1).join(" - ") : null].filter(Boolean).map(normSong);
  return tries.some(g => g && (g === want || lev(g, want) <= Math.max(1, Math.floor(want.length * 0.2))));
}

async function startTune() {
  stopTune();
  game.pid = state.people.includes(game.pid) ? game.pid : state.people[0];
  gameBox().innerHTML = `<p class="muted">Picking songs…</p>`;
  try {
    const all = await poolFor(game.pid, 500);                // suggestions: your top 500 (the server's maximum page)
    tune.names = [...new Map(all.map(s => [normSong(s.title) + "|" + s.sub, `${s.title} — ${s.sub}`])).values()];
    tune.pool = all.slice(0, tunePoolSize());                // answers: your top 100-500, picked in the game
    if (tune.pool.length < 4) throw new Error("not enough songs in this time frame; pick a wider one");
    tune.round = 0; tune.score = 0; tune.results = []; tune.cur = null;
    tune.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    startLoader();
    nextTune();
  } catch (e) {
    gameBox().innerHTML = `${tuneHeader()}<p class="muted">Can't start the game: ${esc(e.message)}.</p>`;
  }
}

// pool size (top 100-500 songs) and recently asked songs, remembered in this browser
const TUNE_POOLS = [100, 200, 300, 500];
function tunePoolSize() {
  let n = 200;
  try { n = +localStorage.getItem("music-stats-tune-pool") || 200; } catch { /* no storage */ }
  return TUNE_POOLS.includes(n) ? n : 200;
}
function tuneRecent() {
  try { return JSON.parse(localStorage.getItem("music-stats-tune-recent") || "[]"); } catch { return []; }
}
function rememberTune(key) {
  const keep = Math.floor(tune.pool.length * 0.6);            // forget the oldest once most of the pool has had a turn
  const list = [key, ...tuneRecent().filter(k => k !== key)].slice(0, Math.max(keep, 10));
  try { localStorage.setItem("music-stats-tune-recent", JSON.stringify(list)); } catch { /* no storage */ }
}
function tuneHeader() {
  const n = tunePoolSize();
  return `<div class="g-head-row">${pickPerson("Whose songs?")}
    <label class="g-who">From the top <select data-x="pool">${TUNE_POOLS.map(v =>
      `<option value="${v}" ${v === n ? "selected" : ""}>${v}</option>`).join("")}</select> songs</label></div>`;
}

// background loader: 3 downloads at a time until the game has all its clips;
// songs without a preview are replaced by the next candidate. Clips stay compressed
// until their round starts (decoded audio is ~10 MB per song).
function startLoader() {
  const gen = tune.gen = (tune.gen || 0) + 1;              // a new game cancels the old loader
  // songs from your last few games go to the back of the line, so they don't come straight back
  const recent = new Set(tuneRecent());
  const cands = shuffle(tune.pool.slice());
  cands.sort((a, b) => recent.has(a.key) - recent.has(b.key));
  Object.assign(tune, {cands, ready: [], waiters: [], loaded: 0, inflight: 0});
  const wake = () => tune.waiters.splice(0).forEach(fn => fn());
  const worker = async () => {
    while (gen === tune.gen && tune.loaded + tune.inflight < tune.rounds && tune.cands.length) {
      const song = tune.cands.shift();
      tune.inflight++;
      let data = null;
      try {
        const r = await fetch("/api/preview?audio=1&k=" + enc(song.key));
        if (r.ok) data = await r.arrayBuffer();
      } catch { /* no clip for this one */ }
      tune.inflight--;
      if (gen !== tune.gen) return;
      if (data && data.byteLength > 1000) {
        tune.loaded++;
        tune.ready.push({song, data});
      }
      wake();
    }
    wake();                                                  // let a waiting round see that we're out of songs
  };
  for (let i = 0; i < 3; i++) worker();
}
function nextClip() {
  return new Promise(function check(resolve) {
    if (tune.ready.length) return resolve(tune.ready.shift());
    if (!tune.cands.length && !tune.inflight) return resolve(null);
    tune.waiters.push(() => check(resolve));
  });
}

async function nextTune() {
  stopTune();
  Object.assign(tune, {stage: 0, guesses: [], done: false, buf: null});
  if (!tune.ready.length) gameBox().innerHTML = `${tuneHeader()}<p class="muted">Loading the first clips…</p>`;
  const gen = tune.gen;
  while (true) {
    const clip = await nextClip();
    if (gen !== tune.gen) return;
    if (!clip) break;
    try {
      tune.buf = await tune.ctx.decodeAudioData(clip.data);
      tune.cur = clip.song;
      renderTune();
      return;
    } catch { /* couldn't decode: take the next one */ }
  }
  gameBox().innerHTML = `${tuneHeader()}<p class="muted">Couldn't get ${tune.round ? "more " : ""}preview clips from Apple's
    music search right now. Check your internet connection, or try again in a minute (it limits how often it can be asked).</p>
    <div class="g-actions">${tune.round ? `<button type="button" data-x="tune-done">See your score</button>` : ""}
    <button type="button" data-g="again">Try again</button></div>`;
}

function playClip(seconds) {
  if (!tune.buf) return;
  stopTune();
  if (tune.ctx.state === "suspended") tune.ctx.resume();
  const len = Math.min(seconds ?? TUNE_STAGES[tune.stage], tune.buf.duration);
  const src = tune.ctx.createBufferSource(), gain = tune.ctx.createGain(), t = tune.ctx.currentTime;
  src.buffer = tune.buf;
  src.connect(gain).connect(tune.ctx.destination);
  // tiny fades so even 0.1 s doesn't click
  const fade = Math.min(0.012, len / 4);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.9, t + fade);
  gain.gain.setValueAtTime(0.9, t + len - fade);
  gain.gain.linearRampToValueAtTime(0, t + len);
  src.start(t, 0, len);
  tune.src = src;
  const bar = gameBox().querySelector(".tune-progress i");
  if (bar && !tune.done) {
    bar.style.transition = "none"; bar.style.width = "0";
    void bar.offsetWidth;
    bar.style.transition = `width ${len}s linear`;
    bar.style.width = (len / TUNE_STAGES[TUNE_STAGES.length - 1] * 100) + "%";
  }
}

function renderTune() {
  const s = tune.stage, cur = tune.cur, last = tune.round + 1 >= tune.rounds;
  const lost = tune.done && !tune.guesses.some(g => g.ok);
  const stages = TUNE_STAGES.map((len, i) => `<span class="${i < s || (lost && i === s) ? "used" : i === s && !tune.done ? "now" : ""}"
    style="flex:${i ? len - TUNE_STAGES[i - 1] : len}">${len} s</span>`).join("");
  const history = tune.guesses.map(g => `<li class="${g.ok ? "ok" : ""}">${g.ok ? "✅" : g.skip ? "⏭️" : "❌"}
    ${g.skip ? `Skipped at ${secs(g.len)}` : esc(g.text)}</li>`).join("");
  const won = tune.guesses.some(g => g.ok);
  const nextLen = TUNE_STAGES[s + 1];
  gameBox().innerHTML = `${tuneHeader()}
    <p class="g-q">Round ${tune.round + 1} of ${tune.rounds}: name this song.</p>
    <div class="tune-stages">${stages}</div>
    <div class="tune-progress"><i></i></div>
    ${tune.done ? `<div class="tune-reveal">${cover(cur.cover_key)}<div><p class="g-title">${esc(cur.title)}</p>
        <p class="muted">${esc(cur.sub)}</p></div></div>
      <p class="g-result ${won ? "ok" : "bad"}">${won ? `🎉 Got it in ${secs(TUNE_STAGES[tune.guesses.length - 1])}! +${TUNE_STAGES.length - (tune.guesses.length - 1)} points`
        : "Not this time."}</p>
      <div class="g-actions"><button type="button" data-x="tune-full">▶ Play 30 s</button>
        <button type="button" data-x="${last ? "tune-done" : "tune-next"}">${last ? "See your score" : "Next song"}</button></div>`
    : `<div class="g-actions"><button type="button" class="tune-play" data-x="tune-play">▶ Play ${secs(TUNE_STAGES[s])}</button></div>
      <form class="tune-form" data-x="tune-form" autocomplete="off">
        <input id="tune-guess" list="tune-names" placeholder="Type the song title…" aria-label="Your guess" autofocus>
        <datalist id="tune-names">${tune.names.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
        <button type="submit">Guess</button>
        <button type="button" class="ghost" data-x="tune-skip">${nextLen ? `Skip (+${secs(+(nextLen - TUNE_STAGES[s]).toFixed(1))})` : "Give up"}</button>
      </form>`}
    ${history ? `<ol class="tune-history">${history}</ol>` : ""}
    <p class="g-score">Score ${tune.score} · ${TUNE_STAGES.length} points for 0.1 s, down to 1 for 5 s</p>`;
  if (!tune.done) gameBox().querySelector("#tune-guess")?.focus();
}

function tuneGuess(text, skip) {
  if (tune.done) return;
  const len = TUNE_STAGES[tune.stage];
  if (!skip && !text.trim()) return;
  const ok = !skip && isRight(text, tune.cur);
  tune.guesses.push({text, skip, ok, len});
  if (ok) {
    tune.score += TUNE_STAGES.length - tune.stage;
    tune.done = true;
  } else if (tune.stage + 1 < TUNE_STAGES.length) {
    tune.stage++;
  } else {
    tune.done = true;
  }
  if (tune.done) {
    tune.results.push({key: tune.cur.key, title: tune.cur.title, stage: ok ? tune.stage : -1});
    rememberTune(tune.cur.key);
  }
  renderTune();
  if (tune.done) playClip(30);
  else playClip();                                           // a miss plays the longer clip straight away
}

function finishTune() {
  stopTune();
  const key = "tune6:" + pname(game.pid), max = tune.rounds * TUNE_STAGES.length;   // new scale: own best score
  saveBest(key, tune.score);
  const grid = tune.results.map(r => r.stage < 0 ? "⬛".repeat(TUNE_STAGES.length) :
    TUNE_STAGES.map((_, i) => i < r.stage ? "🟥" : i === r.stage ? "🟩" : "⬜").join("")).join("\n");
  const msg = tune.score >= max * 0.75 ? "Golden ears. 👂✨" : tune.score >= max * 0.45 ? "You know your music."
    : tune.score >= max * 0.2 ? "Some of these sounded familiar…" : "Did you even listen to these? 😄";
  tune.share = `Name that tune · ${pname(game.pid)}’s top ${tunePoolSize()} · ${tune.score}/${max}\n${grid}`;
  gameBox().innerHTML = `<div class="g-final"><p class="huge">${tune.score} / ${max}</p><p class="big-line">${msg}</p>
    <pre class="tune-grid">${esc(grid)}</pre>
    <p class="g-score">Best ${bestScore(key)} / ${max}</p>
    <div class="g-actions"><button type="button" data-x="tune-copy">Copy result</button><button type="button" data-g="again">Play again</button></div></div>`;
}

// ------------------------------------------------------------ song bracket --
const bracket = {round: [], next: [], i: 0, names: ["Round of 16", "Quarter-finals", "Semi-finals", "Final"], stage: 0};

async function startBracket() {
  game.pid = state.people.includes(game.pid) ? game.pid : state.people[0];
  gameBox().innerHTML = `<p class="muted">Seeding the bracket…</p>`;
  try {
    const pool = (await poolFor(game.pid, 16)).slice(0, 16);
    if (pool.length < 4) throw new Error("not enough songs in this time frame; pick a wider one");
    const size = pool.length >= 16 ? 16 : pool.length >= 8 ? 8 : 4;
    const seeds = pool.slice(0, size).map((s, i) => ({...s, seed: i + 1}));
    // classic seeding: 1 v 16, 8 v 9, 5 v 12, 4 v 13, ...
    const order = size === 16 ? [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15] : size === 8 ? [1, 8, 4, 5, 3, 6, 2, 7] : [1, 4, 2, 3];
    bracket.round = order.map(n => seeds[n - 1]);
    bracket.next = []; bracket.i = 0;
    bracket.stage = 4 - Math.log2(size);
    renderMatch();
  } catch (e) {
    gameBox().innerHTML = `${pickPerson("Whose top songs?")}<p class="muted">Can't start the bracket: ${esc(e.message)}.</p>`;
  }
}

function renderMatch() {
  const a = bracket.round[bracket.i], b = bracket.round[bracket.i + 1];
  const matches = bracket.round.length / 2;
  gameBox().innerHTML = `${pickPerson("Whose top songs?")}
    <p class="g-q"><b>${bracket.names[bracket.stage]}</b>${matches > 1 ? `, match ${bracket.i / 2 + 1} of ${matches}` : ""}: which one do you like more?</p>
    <div class="g-pair bracket-pair">${[a, b].map(s => `<button type="button" class="g-song pick" data-x="win" data-k="${esc(s.key)}">
      ${cover(s.cover_key)}<p class="g-title">${esc(s.title)}</p><p class="muted">${esc(s.sub)} · seed ${s.seed}</p></button>`).join(`<span class="g-vs">vs</span>`)}</div>
    <p class="g-score">${bracket.round.length - bracket.i / 2} songs still in</p>`;
}

function pickWinner(key) {
  const a = bracket.round[bracket.i], b = bracket.round[bracket.i + 1];
  bracket.next.push(a.key === key ? a : b);
  bracket.i += 2;
  if (bracket.i < bracket.round.length) return renderMatch();
  if (bracket.next.length === 1) return finishBracket(bracket.next[0]);
  bracket.round = bracket.next; bracket.next = []; bracket.i = 0; bracket.stage++;
  renderMatch();
}

function finishBracket(champ) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("music-stats-brackets") || "{}"); } catch { /* no storage */ }
  saved[pname(game.pid)] = {title: champ.title, sub: champ.sub, key: champ.key, seed: champ.seed};
  try { localStorage.setItem("music-stats-brackets", JSON.stringify(saved)); } catch { /* no storage */ }
  const others = Object.entries(saved).filter(([n]) => n !== pname(game.pid) && state.people.some(p => pname(p) === n));
  const note = champ.seed > 4 ? `A #${champ.seed} seed going all the way: the people’s champion.`
    : champ.seed === 1 ? "The favorite held on." : "";
  gameBox().innerHTML = `<div class="g-final"><p class="sub-h">🏆 ${esc(pname(game.pid))}’s champion</p>
    <div class="g-pair"><div class="g-song">${cover(champ.cover_key)}<p class="g-title">${esc(champ.title)}</p><p class="muted">${esc(champ.sub)}</p></div></div>
    <p>${esc(note)}</p>
    ${others.length ? `<p class="sub-h">Other champions</p>${others.map(([n, c]) => `<p><b>${esc(n)}</b>: ${esc(c.title)} by ${esc(c.sub)}
      ${c.key === champ.key ? " · the same champion! 🤝" : ""}</p>`).join("")}`
      : state.people.length > 1 ? `<p class="muted">Now let the others fill in theirs: pick their name above and play again.</p>` : ""}
    <div class="g-actions"><button type="button" data-g="again">Play again</button></div></div>`;
}

// --------------------------------------------------------- guess the month --
const gm = {months: [], round: 0, rounds: 5, score: 0, cur: null, opts: [], songs: []};

async function startMonth() {
  game.pid = state.people.includes(game.pid) ? game.pid : state.people[0];
  gameBox().innerHTML = `<p class="muted">Flipping through your calendar…</p>`;
  try {
    const q = new URLSearchParams({...baseParams(), people: game.pid, era: "month"});
    const f = await getJSON("/api/fun?" + q);
    gm.months = (f.people[0]?.eras || []).map(e => e.start.slice(0, 7));
    if (gm.months.length < 4) throw new Error("you need at least 4 months of listening in this time frame");
    gm.round = 0; gm.score = 0;
    await nextMonth();
  } catch (e) {
    gameBox().innerHTML = `${pickPerson("Whose months?")}<p class="muted">Can't start the game: ${esc(e.message)}.</p>`;
  }
}

async function nextMonth() {
  const m = gm.months[Math.floor(Math.random() * gm.months.length)];
  gm.cur = m;
  gm.opts = shuffle([m, ...choose(gm.months.filter(x => x !== m), 3)]);
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  gameBox().innerHTML = `${pickPerson("Whose months?")}<p class="muted">Loading…</p>`;
  const d = await getJSON("/api/tracks?" + listParams({people: game.pid, from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}`,
    page: 1, size: 5, q: "", sort: "total", view: "top", level: "track", min: 0, common: 0}));
  gm.songs = d.items;
  renderMonth();
}

function renderMonth(picked) {
  gameBox().innerHTML = `${pickPerson("Whose months?")}
    <p class="g-q">Round ${gm.round + 1} of ${gm.rounds}: these were the top songs. Which month was it?</p>
    <ol class="gm-songs">${gm.songs.map(s => `<li>${cover(s.cover_key)}<span><b>${esc(s.title)}</b><small>${esc(s.sub)}</small></span></li>`).join("")}</ol>
    <div class="tune-opts">${gm.opts.map(o => `<button type="button" data-x="month" data-m="${o}" ${picked ? "disabled" : ""}
      class="${picked ? (o === gm.cur ? "win" : o === picked ? "lose" : "") : ""}"><b>${esc(monthLabel(o))}</b></button>`).join("")}</div>
    <div class="g-actions">${picked ? `<p class="g-result ${picked === gm.cur ? "ok" : "bad"}">${picked === gm.cur ? "Right!" : "It was " + esc(monthLabel(gm.cur)) + "."}</p>
      <button type="button" data-x="${gm.round + 1 >= gm.rounds ? "month-done" : "month-next"}">${gm.round + 1 >= gm.rounds ? "See your score" : "Next month"}</button>` : ""}</div>
    <p class="g-score">Score ${gm.score} / ${gm.round + (picked ? 1 : 0)}</p>`;
}

function finishMonth() {
  const key = "month:" + pname(game.pid);
  saveBest(key, gm.score);
  gameBox().innerHTML = `<div class="g-final"><p class="huge">${gm.score} / ${gm.rounds}</p>
    <p class="big-line">${gm.score === gm.rounds ? "You remember everything. 📅" : gm.score >= 3 ? "Good memory." : "Time flies, huh?"}</p>
    <p class="g-score">Best ${bestScore(key)} / ${gm.rounds}</p><div class="g-actions"><button type="button" data-g="again">Play again</button></div></div>`;
}

$("game-stage").addEventListener("change", e => {
  if (e.target.dataset.x === "person") { game.pid = +e.target.value; newGame(); }
  if (e.target.dataset.x === "pool") {
    try { localStorage.setItem("music-stats-tune-pool", e.target.value); } catch { /* no storage */ }
    newGame();
  }
});
$("game-stage").addEventListener("submit", e => {
  if (!e.target.matches("[data-x='tune-form']")) return;
  e.preventDefault();
  tuneGuess(e.target.querySelector("input").value, false);
});
$("game-stage").addEventListener("click", e => {
  const b = e.target.closest("[data-x]");
  if (!b || b.disabled || b.tagName === "SELECT") return;
  const x = b.dataset.x;
  if (x === "tune-play") return playClip();
  if (x === "tune-full") return playClip(30);
  if (x === "tune-skip") return tuneGuess("", true);
  if (x === "tune-next") { tune.round++; return nextTune(); }
  if (x === "tune-done") return finishTune();
  if (x === "tune-copy") {
    navigator.clipboard.writeText(tune.share).then(() => toast("Copied your result."), () => toast("Couldn't copy."));
    return;
  }
  if (x === "win") return pickWinner(b.dataset.k);
  if (x === "month") { if (b.dataset.m === gm.cur) gm.score++; return renderMonth(b.dataset.m); }
  if (x === "month-next") { gm.round++; return nextMonth().catch(err => { gameBox().innerHTML = `<p class="muted">${esc(err.message)}</p>`; }); }
  if (x === "month-done") return finishMonth();
});

// ======================================================== saving as image ==
// Covers come from other sites, which browsers won't let a page turn into an image,
// so they're swapped for same-site copies (/api/cover?…&proxy=1) first.
let h2i = null;
function loadH2I() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  return h2i ??= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement("script"),
      {src: "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js", onload: () => ok(window.htmlToImage),
       onerror: () => { h2i = null; fail(new Error("couldn't load the image library (are you online?)")); }});
    document.head.appendChild(s);
  });
}
async function saveImage(node, name) {
  try {
    const lib = await loadH2I();
    await Promise.all([...node.querySelectorAll("img")].map(img => {
      if (!img.src.includes("/api/cover") || img.src.includes("proxy=1")) return null;
      img.src = img.src + "&proxy=1";
      return img.decode().catch(() => { img.style.visibility = "hidden"; });
    }));
    const bg = getComputedStyle(node).backgroundColor;
    const url = await lib.toPng(node, {pixelRatio: 2, skipFonts: true,
      backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.body).backgroundColor,
      filter: el => !(el.nodeType === 1 && el.matches("[data-share], .replay, .recap-x, .share-skip"))});
    const a = Object.assign(document.createElement("a"), {href: url, download: `music-${name}.png`});
    document.body.appendChild(a); a.click(); a.remove();
    toast("Saved the image to your downloads.");
  } catch (e) {
    toast(`Couldn't save the image: ${e.message}.`);
  }
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-share]");
  if (!b) return;
  const target = b.dataset.share === "compat" ? b.closest(".compat") : document.querySelector(b.dataset.share);
  if (target) saveImage(target, b.dataset.name || "card");
});
