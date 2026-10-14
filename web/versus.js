"use strict";
// Versus: two people, one artist. Who's the bigger fan? Rounds, who owns which song, both timelines.
// Uses helpers from app.js, fun.js and more.js (esc, enc, pname, color, pct, plural, fmt, ttRow, moreList, …).

const vs = {a: 0, b: 1, artist: "", data: null, timer: null, overlap: true};

function openVersus(artist) {
  const ppl = META.people.length;
  if (ppl < 2) return toast("Versus needs at least two people’s listening history.");
  if (state.people.length >= 2) [vs.a, vs.b] = state.people;
  if (vs.a === vs.b || vs.a >= ppl || vs.b >= ppl) [vs.a, vs.b] = [0, 1];
  $("vs-dlg").showModal();
  renderVsControls(artist ?? vs.artist);
  if (artist) runVersus(artist);
  else loadVsSuggestions();
}

function vsParams(extra) {
  return new URLSearchParams({from: state.view === "rediscover" ? "" : state.from,
                              to: state.view === "rediscover" ? "" : state.to, a: vs.a, b: vs.b,
                              overlap: vs.overlap ? 1 : 0, ...extra});
}

function renderVsControls(artist = "") {
  const opts = sel => META.people.map((p, pid) => `<option value="${pid}" ${pid === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  $("vs-controls").innerHTML = `<form id="vs-form" class="vs-form" autocomplete="off">
      <select id="vs-a" aria-label="First person" style="--c:${color(vs.a)}">${opts(vs.a)}</select>
      <span class="vs-x">vs</span>
      <select id="vs-b" aria-label="Second person" style="--c:${color(vs.b)}">${opts(vs.b)}</select>
      <span class="vs-on">on</span>
      <input id="vs-artist" list="vs-artists" placeholder="Pick an artist…" value="${esc(artist)}" required aria-label="Artist">
      <datalist id="vs-artists"></datalist>
      <button type="submit">Fight ⚔️</button>
    </form>
    <p class="muted vs-frame">${esc(cap(frameLabel()))}. Change the time frame on the main page.</p>`;
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

async function loadVsSuggestions() {
  $("vs-body").innerHTML = `<p class="muted">Looking for close fights…</p>`;
  try {
    const d = await cxFetch("/api/versus?" + vsParams({}));
    $("vs-body").innerHTML = d.suggestions.length
      ? `<p class="sub-h">Closest fights <span class="muted">artists you both play, about equally</span></p>
         <div class="vs-sugg">${d.suggestions.map(s => `<button type="button" data-vs-run="${esc(s.artist)}">
           <b>${esc(s.artist)}</b><span><i style="color:${color(vs.a)}">${s.a.toLocaleString()}</i> – <i style="color:${color(vs.b)}">${s.b.toLocaleString()}</i></span></button>`).join("")}</div>`
      : `<p class="muted">${esc(pname(vs.a))} and ${esc(pname(vs.b))} don’t share many artists here. Type any artist above.</p>`;
  } catch (e) {
    $("vs-body").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function runVersus(artist) {
  vs.artist = artist;
  $("vs-body").innerHTML = `<p class="muted">Counting…</p>`;
  try {
    vs.data = await cxFetch("/api/versus?" + vsParams({artist}));
    renderVersus(vs.data);
  } catch (e) {
    $("vs-body").innerHTML = `<p class="muted">${esc(e.message)}.</p>`;
  }
}

function vsValue(r, side) {
  const v = r[side], f = r["f" + side];
  switch (r.id) {
    case "plays": case "lately": case "night": return plural(v, "play");
    case "hours": return v ? fmt(v) : "0 min";
    case "songs": return plural(v, "song");
    case "since": return f ? esc(nice(f)) : "never";
    case "streak": return v ? plural(v, "day") : "–";
    case "day": return v ? `${plural(v, "play")}<small>${esc(nice(f))}</small>` : "–";
    case "loyal": return `${pctS(v)}${f ? `<small>#${f} artist</small>` : ""}`;
  }
  return esc(v);
}

function vsTimeline(d) {
  const t = d.timeline;
  if (t.length < 2) return "";
  const max = Math.max(1, ...t.map(m => Math.max(m.a, m.b)));
  const W = 760, H = 140, mid = H / 2, bw = W / t.length;
  const bars = t.map((m, i) => {
    const ha = m.a / max * (mid - 4), hb = m.b / max * (mid - 4), x = (i * bw).toFixed(1), w = Math.max(1, bw - 1).toFixed(1);
    return `<g><title>${esc(m.month)}: ${esc(pname(d.a))} ${m.a}, ${esc(pname(d.b))} ${m.b}</title>
      ${m.a ? `<rect x="${x}" y="${(mid - ha).toFixed(1)}" width="${w}" height="${ha.toFixed(1)}" fill="${color(d.a)}"/>` : ""}
      ${m.b ? `<rect x="${x}" y="${mid}" width="${w}" height="${hb.toFixed(1)}" fill="${color(d.b)}"/>` : ""}
      <rect x="${x}" y="0" width="${w}" height="${H}" fill="transparent"/></g>`;
  }).join("");
  const years = t.map((m, i) => m.month.endsWith("-01") || i === 0 ? `<text x="${(i * bw).toFixed(1)}" y="${H + 14}">${m.month.slice(0, 4)}</text>` : "").join("");
  return `<section><p class="sub-h">📆 Month by month <span class="muted">${esc(pname(d.a))} up, ${esc(pname(d.b))} down</span></p>
    <svg class="vs-timeline" viewBox="0 0 ${W} ${H + 18}" preserveAspectRatio="none" role="img" aria-label="Plays per month">
      <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="axis"/>${bars}${years}</svg></section>`;
}

function renderVersus(d) {
  const A = d.a, B = d.b, sa = d.score[A], sb = d.score[B];
  const leader = sa === sb ? null : sa > sb ? A : B;
  const verdict = leader === null ? "Dead even. Settle it at the next concert. 🤝"
    : Math.abs(sa - sb) <= 1 ? `${esc(pname(leader))} edges it. Too close to brag about.`
    : `${esc(pname(leader))} is the bigger ${esc(d.artist)} fan. 👑`;
  const rows = d.rounds.map(r => {
    const tot = r.id === "since" ? 0 : (+r.a || 0) + (+r.b || 0);
    const share = tot ? (+r.a || 0) / tot : 0.5;
    const won = side => r.winner === (side === "a" ? A : B);
    return `<div class="vs-round${r.counts ? "" : " extra"}">
      <div class="vs-val ${won("a") ? "won" : ""}" style="--c:${color(A)}">${won("a") ? "👑 " : ""}${vsValue(r, "a")}</div>
      <div class="vs-mid"><span>${esc(r.label)}</span>
        ${tot ? `<div class="vs-bar"><i style="width:${(share * 100).toFixed(1)}%;background:${color(A)}"></i><i style="background:${color(B)}"></i></div>` : ""}
        ${r.note ? `<small>${esc(r.note)}${r.counts ? "" : r.id === "night" ? "" : " · doesn’t count"}</small>` : ""}</div>
      <div class="vs-val right ${won("b") ? "won" : ""}" style="--c:${color(B)}">${won("b") ? "👑 " : ""}${vsValue(r, "b")}</div>
    </div>`;
  }).join("");

  const ownA = d.owned.filter(x => x.plays[0] > x.plays[1]).length, ownB = d.owned.filter(x => x.plays[1] > x.plays[0]).length;
  const owned = d.owned.length ? `<section><p class="sub-h">🎯 Who owns which song <span class="muted">${esc(pname(A))} ${ownA} · ${esc(pname(B))} ${ownB}${
      d.owned.length - ownA - ownB ? ` · ${d.owned.length - ownA - ownB} tied` : ""}</span></p>
    ${moreList(d.owned, 8, x => {
      const tot = x.plays[0] + x.plays[1], w = x.plays[0] / tot * 100;
      return `<li><button type="button" class="vs-song" data-open-key="${esc(x.key)}" data-title="${esc(x.title)}" data-sub="${esc(x.sub)}">
        <b class="${x.plays[0] > x.plays[1] ? "won" : ""}" style="--c:${color(A)}">${x.plays[0]}</b>
        <span><span class="vs-t">${esc(x.title)}</span><span class="vs-bar"><i style="width:${w.toFixed(1)}%;background:${color(A)}"></i><i style="background:${color(B)}"></i></span></span>
        <b class="${x.plays[1] > x.plays[0] ? "won" : ""}" style="--c:${color(B)}">${x.plays[1]}</b></button></li>`;
    }, "vs-songs")}</section>` : "";
  const only = (pid, list) => list.length ? `<div><p class="who-h" style="--c:${color(pid)}"><b>Only ${esc(pname(pid))}</b></p>
    ${moreList(list, 5, x => ttRow(x, plural(x.plays[pid === A ? 0 : 1], "play"), `${esc(pname(pid === A ? B : A))} never played it`))}</div>` : "";
  const favs = [[A, d.fav.a], [B, d.fav.b]].filter(([, f]) => f);

  const fair = d.uneven ? `<label class="vs-fair"><input type="checkbox" data-vs-overlap ${d.overlap ? "checked" : ""}>
      Only count the time both histories cover (${esc(nice(d.both_from))} to ${esc(nice(d.both_to))}), so a longer history isn’t an unfair advantage</label>` : "";
  $("vs-body").innerHTML = `${fair}<div id="vs-card" class="vs-card">
      <div class="vs-hero">
        <div class="vs-name" style="--c:${color(A)}">${esc(pname(A))}<b>${sa}</b></div>
        <div class="vs-artist"><small>⚔️ ${d.overlap && d.uneven ? `${esc(nice(d.both_from))} to ${esc(nice(d.both_to))}` : esc(frameLabel())}</small>${esc(d.artist)}</div>
        <div class="vs-name right" style="--c:${color(B)}"><b>${sb}</b>${esc(pname(B))}</div>
      </div>
      <p class="vs-verdict">${verdict}</p>
      <div class="vs-rounds">${rows}</div>
      ${favs.length ? `<div class="vs-favs">${favs.map(([pid, f]) => `<div style="--c:${color(pid)}">
        ${cover(f.cover_key)}<span><small>${esc(pname(pid))}’s favourite</small><b>${esc(f.title)}</b><span class="muted">${plural(f.plays, "play")}</span></span></div>`).join("")}</div>` : ""}
    </div>
    <div class="g-actions"><button type="button" data-share="#vs-card" data-name="versus-${esc(d.artist)}">Save as image</button>
      <button type="button" class="ghost" data-vs-swap>Swap sides</button></div>
    ${vsTimeline(d)}
    ${owned}
    ${d.only_a.length || d.only_b.length ? `<section><p class="sub-h">🔒 Songs only one of you plays <span class="muted">3+ plays, the other never</span></p>
      <div class="ins-grid">${only(A, d.only_a)}${only(B, d.only_b)}</div></section>` : ""}`;
}

// ------------------------------------------------------------------ events --
$("vs-open").addEventListener("click", () => openVersus());
$("vs-close").addEventListener("click", () => $("vs-dlg").close());
$("vs-controls").addEventListener("submit", e => {
  e.preventDefault();
  vs.a = +$("vs-a").value; vs.b = +$("vs-b").value;
  if (vs.a === vs.b) return toast("Pick two different people.");
  runVersus($("vs-artist").value.trim());
});
$("vs-controls").addEventListener("change", e => {
  if (e.target.id !== "vs-a" && e.target.id !== "vs-b") return;
  const other = e.target.id === "vs-a" ? "vs-b" : "vs-a";
  if (+e.target.value === +$(other).value) {                  // picked the same person: swap them
    $(other).value = String(e.target.id === "vs-a" ? vs.a : vs.b);
  }
  vs.a = +$("vs-a").value; vs.b = +$("vs-b").value;
  renderVsControls($("vs-artist").value);
  if ($("vs-artist").value.trim() && vs.data) runVersus($("vs-artist").value.trim());
  else loadVsSuggestions();
});
$("vs-controls").addEventListener("input", e => {
  if (e.target.id !== "vs-artist") return;
  clearTimeout(vs.timer);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  vs.timer = setTimeout(async () => {
    try {
      const d = await cxFetch("/api/artists?q=" + enc(q));
      $("vs-artists").innerHTML = d.artists.map(a => `<option value="${esc(a.title)}">`).join("");
    } catch { /* suggestions are optional */ }
  }, 200);
});
$("vs-body").addEventListener("change", e => {
  if (!e.target.matches("[data-vs-overlap]")) return;
  vs.overlap = e.target.checked;
  runVersus(vs.artist);
});
$("vs-body").addEventListener("click", e => {
  const run = e.target.closest("[data-vs-run]");
  if (run) { $("vs-artist").value = run.dataset.vsRun; return runVersus(run.dataset.vsRun); }
  if (e.target.closest("[data-vs-swap]")) {
    [vs.a, vs.b] = [vs.b, vs.a];
    renderVsControls(vs.artist);
    return runVersus(vs.artist);
  }
  const song = e.target.closest("[data-open-key]");
  if (song) openDetail({key: song.dataset.openKey, cover_key: song.dataset.openKey, kind: "track",
                        title: song.dataset.title, sub: song.dataset.sub});
});
// from an artist's or song's popup
document.addEventListener("click", e => {
  const b = e.target.closest("[data-vs]");
  if (!b) return;
  if ($("dlg").open) $("dlg").close();
  openVersus(b.dataset.vs);
});
