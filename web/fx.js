"use strict";
// Game effects shared by the games, Hitster and the roulette (the Lyrics Arena has its own in arena.js):
// synthesised sounds, sparks and rings in a rarity's colour, callouts, floating points, count-ups,
// confetti, streak tiers and a shake. With "reduce motion" on in the system settings nothing moves:
// numbers land at once and the sounds still play (unless they're muted with the 🔊 button).

const FX_SOUND_KEY = "music-stats-game-sound";
const fx = {
  sound: (() => { try { return localStorage.getItem(FX_SOUND_KEY) !== "0"; } catch { return true; } })(),
  ctx: null, out: null, noise: null,
};
// the Hearthstone rarities, plus right and wrong
const FX_COLOR = {common: "#ced4da", rare: "#4dabf7", epic: "#cc5de8", legendary: "#ffa94d", good: "#51cf66", bad: "#ff6b6b"};
const FX_RAR = ["common", "rare", "epic", "legendary"];
const fxCalm = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const fxWait = ms => new Promise(res => setTimeout(res, ms));

// ---------------------------------------------------------------- sound --
function fxAudio() {
  if (!fx.sound) return null;
  try {
    if (!fx.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const out = ctx.createGain(), delay = ctx.createDelay(1), feedback = ctx.createGain(), wet = ctx.createGain();
      out.gain.value = 0.5;
      delay.delayTime.value = 0.15;                  // a short echo gives the big moments some room
      feedback.gain.value = 0.25;
      wet.gain.value = 0.28;
      out.connect(ctx.destination);
      out.connect(delay).connect(feedback).connect(delay);
      delay.connect(wet).connect(ctx.destination);
      fx.ctx = ctx;
      fx.out = out;
    }
    if (fx.ctx.state === "suspended") fx.ctx.resume();
    return fx.ctx;
  } catch { return null; }
}
function fxTone(ctx, f, {at = 0, dur = 0.4, type = "sine", vol = 0.1, to = null, attack = 0.008} = {}) {
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(fx.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function fxNoise(ctx, {at = 0, dur = 0.14, vol = 0.05, freq = 2400, q = 0.9} = {}) {
  if (!fx.noise) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    fx.noise = b;
  }
  const t = ctx.currentTime + at, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = fx.noise;
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(freq, t);
  bp.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(fx.out);
  src.start(t, Math.random() * 0.5, dur + 0.02);
}
const FX_ARP = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
const FX_SFX = {
  tick: (ctx, n = 0) => fxTone(ctx, 900 + Math.min(n, 40) * 22, {dur: 0.035, type: "square", vol: 0.018}),
  flip: ctx => fxNoise(ctx, {dur: 0.12, vol: 0.045, freq: 1900}),
  deal: ctx => [0, 0.07, 0.14].forEach(at => fxNoise(ctx, {at, dur: 0.06, vol: 0.028, freq: 3400})),
  whoosh: ctx => fxNoise(ctx, {dur: 0.35, vol: 0.05, freq: 800, q: 0.4}),
  stamp: (ctx, n = 0) => { fxTone(ctx, 180 + n * 40, {dur: 0.14, type: "triangle", vol: 0.14, to: 90}); fxNoise(ctx, {dur: 0.06, vol: 0.04, freq: 1200}); },
  drumroll: (ctx, len = 0.6) => { for (let at = 0; at < len; at += 0.045) fxNoise(ctx, {at, dur: 0.05, vol: 0.012 + at / len * 0.03, freq: 500, q: 0.7}); },
  right: ctx => [659.25, 987.77].forEach((f, i) => fxTone(ctx, f, {at: i * 0.08, dur: 0.45, type: "triangle", vol: 0.08})),
  wrong: ctx => { fxTone(ctx, 196, {dur: 0.32, type: "sawtooth", vol: 0.05, to: 150}); fxTone(ctx, 185, {at: 0.02, dur: 0.32, type: "square", vol: 0.025, to: 140}); },
  coin: ctx => [1318.5, 1975.5].forEach((f, i) => fxTone(ctx, f, {at: i * 0.07, dur: 0.35, type: "square", vol: 0.03})),
  rare: ctx => [1046.5, 1568].forEach((f, i) => fxTone(ctx, f, {at: i * 0.075, dur: 0.6, vol: 0.06})),
  epic: ctx => [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => fxTone(ctx, f, {at: i * 0.07, dur: 0.9, type: "triangle", vol: 0.055})),
  charge: (ctx, len = 0.9) => {
    fxTone(ctx, 140, {dur: len + 0.05, type: "sawtooth", vol: 0.025, to: 620, attack: len * 0.75});
    fxNoise(ctx, {dur: len, vol: 0.02, freq: 700, q: 0.5});
  },
  legendary: ctx => {
    fxTone(ctx, 98, {dur: 1.2, vol: 0.3, to: 41});                       // the boom
    fxNoise(ctx, {dur: 0.5, vol: 0.08, freq: 420, q: 0.6});
    [523.25, 659.25, 783.99, 1046.5].forEach(f => fxTone(ctx, f, {at: 0.05, dur: 1.8, type: "triangle", vol: 0.045, attack: 0.25}));
    [1567.98, 2093, 2637.02, 3135.96, 4186.01].forEach((f, i) => fxTone(ctx, f, {at: 0.25 + i * 0.07, dur: 0.7, vol: 0.03}));
  },
  // a rising run, longer for every streak tier
  streak: (ctx, tier = 1) => FX_ARP.slice(0, 3 + tier).forEach((f, i) => fxTone(ctx, f * (1 + tier * 0.06), {at: i * 0.055, dur: 0.5, type: "triangle", vol: 0.05})),
  shield: ctx => { fxTone(ctx, 1760, {dur: 0.9, vol: 0.05}); fxTone(ctx, 2637, {at: 0.02, dur: 0.7, vol: 0.03}); fxNoise(ctx, {dur: 0.08, vol: 0.05, freq: 5000}); },
  shatter: ctx => { for (let i = 0; i < 7; i++) fxNoise(ctx, {at: i * 0.025, dur: 0.12, vol: 0.06 - i * 0.006, freq: 3000 + Math.random() * 4000, q: 2}); fxTone(ctx, 220, {dur: 0.4, type: "triangle", vol: 0.08, to: 70}); },
  over: ctx => [392, 349.23, 311.13, 261.63].forEach((f, i) => fxTone(ctx, f, {at: i * 0.17, dur: 0.5, type: "triangle", vol: 0.06})),
  fanfare: ctx => {
    [[523.25, 0], [523.25, 0.12], [523.25, 0.24], [698.46, 0.36], [880, 0.62], [1046.5, 0.8]].forEach(([f, at]) =>
      fxTone(ctx, f, {at, dur: at > 0.7 ? 1.2 : 0.22, type: "triangle", vol: 0.07}));
    [261.63, 349.23, 440].forEach(f => fxTone(ctx, f, {at: 0.8, dur: 1.4, type: "sine", vol: 0.04, attack: 0.1}));
  },
  best: ctx => [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => fxTone(ctx, f, {at: i * 0.05, dur: 0.6, vol: 0.035})),
  spin: (ctx, n = 0) => fxTone(ctx, 600 + (n % 6) * 90, {dur: 0.03, type: "square", vol: 0.02}),
};
function fxPlay(name, arg) {
  const ctx = fxAudio();
  if (!ctx || !FX_SFX[name]) return;
  try { FX_SFX[name](ctx, arg); } catch { /* sound is a bonus */ }
}
function fxSoundButtons() {
  document.querySelectorAll("[data-fx-sound]").forEach(b => {
    b.textContent = fx.sound ? "🔊" : "🔇";
    b.setAttribute("aria-pressed", String(fx.sound));
    b.title = fx.sound ? "Sound effects: on" : "Sound effects: off";
  });
}
document.addEventListener("click", e => {
  if (!e.target.closest("[data-fx-sound]")) return;
  fx.sound = !fx.sound;
  try { localStorage.setItem(FX_SOUND_KEY, fx.sound ? "1" : "0"); } catch { /* not kept */ }
  fxSoundButtons();
  if (fx.sound) fxPlay("coin");
});
fxSoundButtons();

// -------------------------------------------------------------- visuals --
// one overlay per dialog: dialogs sit in the top layer, so the sparks must live inside them
function fxLayer(el) {
  const host = el?.closest?.("dialog") || document.body;
  let layer = host.querySelector(":scope > .fx-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "fx-layer";
    host.append(layer);
  }
  return layer;
}
const fxColor = c => FX_COLOR[c] || (typeof c === "number" ? FX_COLOR[FX_RAR[c]] : c) || FX_COLOR.good;
const fxCenter = el => { const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2, r}; };
function fxTemp(layer, node, ms) { layer.append(node); setTimeout(() => node.remove(), ms); return node; }

// sparks and a ring of light; level 1-3 like rare, epic, legendary (3 adds rays and a flash)
function fxBurst(el, {color = "good", level = 1, small = false} = {}) {
  if (fxCalm() || !el?.isConnected) return;
  const {x, y} = fxCenter(el), layer = fxLayer(el), c = fxColor(color);
  const box = document.createElement("div");
  box.className = "fx-burst";
  box.style.cssText = `left:${x}px;top:${y}px;--c:${c}`;
  const n = small ? 12 : [10, 18, 28, 46][level], reach = small ? 80 : [80, 120, 170, 260][level];
  let html = `<i class="fx-ring"></i>${level >= 2 && !small ? `<i class="fx-ring late"></i>` : ""}${level >= 3 && !small ? `<i class="fx-rays"></i>` : ""}`;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = reach * (0.45 + Math.random() * 0.75);
    html += `<b style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;`
      + `--s:${(3 + Math.random() * (level + 3)).toFixed(1)}px;--d:${(600 + Math.random() * 700).toFixed(0)}ms"></b>`;
  }
  box.innerHTML = html;
  fxTemp(layer, box, 2000);
  if (level >= 3 && !small) {
    const flash = document.createElement("div");
    flash.className = "fx-flash";
    flash.style.cssText = `--x:${x}px;--y:${y}px;--c:${c}`;
    fxTemp(layer, flash, 1000);
  }
}

// a word that slams in and floats away ("ON FIRE!", "UPSET!")
function fxCallout(el, text, color = "legendary", {at = "center", size = 1} = {}) {
  if (fxCalm() || !el?.isConnected) return;
  const {x, y, r} = fxCenter(el), layer = fxLayer(el);
  const node = document.createElement("div");
  node.className = "fx-callout";
  node.textContent = text;
  const top = at === "top" ? r.top + Math.min(60, r.height / 3) : y;
  node.style.cssText = `left:${x}px;top:${top}px;--c:${fxColor(color)};--k:${size}`;
  fxTemp(layer, node, 1800);
  const half = node.offsetWidth * 0.6 + 6;                 // keep it on screen, even at its biggest (×1.2)
  if (half * 2 > innerWidth) {
    node.style.setProperty("--k", String(size * innerWidth / (half * 2 + 12)));
    node.style.left = `${innerWidth / 2}px`;
  }
  else node.style.left = `${Math.max(half, Math.min(innerWidth - half, x))}px`;
}

// "+1" rising from an element
function fxFloat(el, text, color = "good") {
  if (fxCalm() || !el?.isConnected) return;
  const {x, r} = fxCenter(el), layer = fxLayer(el);
  const node = document.createElement("div");
  node.className = "fx-float";
  node.textContent = text;
  node.style.cssText = `left:${x}px;top:${r.top}px;--c:${fxColor(color)}`;
  fxTemp(layer, node, 1300);
}

// restart a one-shot CSS animation class
function fxPulse(el, cls, ms = 600) {
  if (fxCalm() || !el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}
const fxShake = (el, hard = false) => fxPulse(el, hard ? "fx-shake-hard" : "fx-shake", 520);

// paper confetti falling over the dialog
function fxConfetti(el, {n = 110, colors = ["#ffa94d", "#cc5de8", "#4dabf7", "#51cf66", "#ff6b6b", "#ffd43b"]} = {}) {
  if (fxCalm() || !el?.isConnected) return;
  const layer = fxLayer(el), box = document.createElement("div");
  box.className = "fx-confetti";
  let html = "";
  for (let i = 0; i < n; i++) {
    html += `<i style="left:${(Math.random() * 100).toFixed(1)}%;--c:${colors[i % colors.length]};--d:${(1600 + Math.random() * 1600).toFixed(0)}ms;`
      + `--w:${(Math.random() * 600).toFixed(0)}ms;--x:${(Math.random() * 160 - 80).toFixed(0)}px;--r:${(Math.random() * 1080 - 540).toFixed(0)}deg"></i>`;
  }
  box.innerHTML = html;
  fxTemp(layer, box, 3800);
}

// a number that rolls up to its value, ticking as it goes (slower near the end, like a slot machine)
function fxCountUp(el, to, {from = 0, dur = 900, fmt = n => Math.round(n).toLocaleString(), sound = true, gen = null} = {}) {
  if (!el) return Promise.resolve();
  if (fxCalm() || to === from) { el.textContent = fmt(to); return Promise.resolve(); }
  return new Promise(res => {
    const t0 = performance.now();
    let ticks = 0, last = -1;
    const step = now => {
      if (!el.isConnected || (gen && !gen())) return res();
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      const v = from + (to - from) * e;
      el.textContent = fmt(v);
      const slot = Math.floor(p * 18);
      if (sound && slot !== last) { last = slot; fxPlay("tick", ticks++); }
      if (p < 1) requestAnimationFrame(step);
      else { el.textContent = fmt(to); res(); }
    };
    requestAnimationFrame(step);
  });
}

// years spinning like a slot reel before they land on the right one (Hitster)
function fxRoll(el, final, {spins = 14, pick = () => final, dur = 700, gen = null} = {}) {
  if (!el) return Promise.resolve();
  if (fxCalm()) { el.textContent = final; return Promise.resolve(); }
  return new Promise(res => {
    let n = 0;
    const step = () => {
      if (!el.isConnected || (gen && !gen())) return res();
      n++;
      if (n >= spins) { el.textContent = final; fxPulse(el, "fx-land", 500); return res(); }
      el.textContent = pick(n);
      fxPlay("spin", n);
      setTimeout(step, dur / spins * (0.5 + n / spins));
    };
    step();
  });
}

// streak tiers, shared by every game that counts answers in a row
const FX_TIERS = [
  {at: 3, name: "On fire", emoji: "🔥", color: "rare"},
  {at: 5, name: "Unstoppable", emoji: "⚡", color: "epic"},
  {at: 8, name: "Legendary", emoji: "👑", color: "legendary"},
  {at: 12, name: "Godlike", emoji: "🌌", color: "#ff6bd6"},
];
const fxTier = n => FX_TIERS.reduce((t, x, i) => n >= x.at ? i + 1 : t, 0);     // 0 = none yet, 1..4
const fxTierInfo = n => FX_TIERS[fxTier(n) - 1] || null;
// call after a streak grows: a new tier gets a callout, sparks and a longer run of notes
function fxStreak(el, n) {
  const i = FX_TIERS.findIndex(x => x.at === n);
  if (i < 0) {
    if (n >= 2) fxPlay("streak", 0);
    return false;
  }
  const t = FX_TIERS[i];
  fxPlay("streak", i + 1);
  if (i >= 2) setTimeout(() => fxPlay("legendary"), 120);
  fxBurst(el, {color: t.color, level: Math.min(3, i + 1)});
  fxCallout(el, `${t.emoji} ${t.name}!`, t.color);
  return true;
}
// the little streak badge used by several games
function fxStreakBadge(n, label = "in a row") {
  const t = fxTierInfo(n);
  return `<span class="fx-streak tier-${fxTier(n)}" title="${FX_TIERS.map(x => `${x.at}: ${x.emoji} ${x.name}`).join(" · ")}">
    ${t ? t.emoji : "✨"} <b>${n}</b> ${label}${t ? ` · ${t.name}` : ""}</span>`;
}

// how close two numbers are, as a rarity: the closer, the rarer (Higher or lower, Who played it more).
// Between two random songs of a top 200: about 1 in 40 is Legendary (1% apart or a tie), 1 in 12 Epic (5%),
// 1 in 5 Rare (15%), the rest Common.
function fxCloseness(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const r = hi ? lo / hi : 1;
  return r >= 0.99 ? 3 : r >= 0.95 ? 2 : r >= 0.85 ? 1 : 0;
}
const FX_CLOSE_NAME = ["", "Close", "Close call!", "Photo finish!"];

// a finished game: the score counts up, a new best gets gold confetti
async function fxFinal(box, {score, newBest = false, perfect = false, gen = null} = {}) {
  const n = box.querySelector("[data-fx-score]");
  if (n && !fxCalm()) n.textContent = "0";                 // the page shows the real score; the roll starts from 0
  await fxWait(150);
  await fxCountUp(n, score, {dur: Math.min(1400, 400 + score * 90), gen});
  if (!box.isConnected) return;
  if (perfect || newBest) {
    fxPlay("fanfare");
    fxConfetti(box);
    fxBurst(n, {color: "legendary", level: 3});
    if (newBest && !perfect) fxCallout(n, "New best!", "legendary", {at: "top"});
    if (perfect) fxCallout(n, "Perfect!", "legendary", {at: "top"});
  } else if (score > 0) {
    fxPlay("right");
    fxBurst(n, {color: "rare", level: 1});
  } else fxPlay("over");
}