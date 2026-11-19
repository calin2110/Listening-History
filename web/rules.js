"use strict";
// 📜 Rules for the games, Hitster and the roulette: a panel that opens over the game (the game stays where
// it was underneath) with a tab per game. The Lyrics Arena has its own rules in arena.js.

const RULES_FX = () => `<h4>Effects and sound</h4>
  <ul><li>Reveals are rated like Hearthstone cards: <b class="r-rare">Rare</b> (blue), <b class="r-epic">Epic</b> (purple)
      and <b class="r-legendary">Legendary</b> (gold, charges up first and explodes with rays and a boom).</li>
    <li>Answers in a row climb the streak tiers: ${FX_TIERS.map(t => `${t.emoji} <b>${t.name}</b> at ${t.at}`).join(", ")}.
      Each new tier gets a callout and a longer fanfare.</li>
    <li>A new best score or a perfect game ends in gold confetti.</li>
    <li>🔊 in the top bar turns the sound effects on and off (the song clips keep playing). With “reduce motion” on in
      your system settings nothing moves: the numbers land at once and only the sounds stay.</li></ul>`;

const GAME_RULES = {
  hilo: {name: "Higher or lower", html: () => `
    <p class="rules-lead">How long can you keep guessing whether the next song was played more or less?</p>
    <h4>Setup</h4>
    <ul><li><b>Whose plays?</b> One person, or everyone selected together (their plays added up). The songs are that
      choice’s top 200 in the time frame you picked on the main page, shuffled.</li></ul>
    <h4>A turn</h4>
    <ol><li>The left card shows a song and how many times it was played. The right card shows another song; its count
        is a face-down tile.</li>
      <li>Guess: <b>▲ More plays</b> or <b>▼ Fewer plays</b> (keys: ↑ and ↓).</li>
      <li>A drumroll, the tile flips and the count rolls up. The meter under the cards shows the left song’s count as a
        mark and the right one’s as a bar, so you see it pass the mark (or stop short).</li>
      <li><b>Right</b>: +1 to your streak, and the right card slides over to become the next left card. Exactly the same
        count also counts as right. <b>Wrong</b>: the streak is over (unless you have a shield).</li></ol>
    <h4>How close was it?</h4>
    <table class="ar-table"><tr><th>The two counts</th><th>Reveal</th></tr>
      <tr><td>more than 15% apart</td><td>Common · about 7 in 10</td></tr>
      <tr><td>within 15%</td><td><b class="r-rare">Rare</b> · about 1 in 5</td></tr>
      <tr><td>within 5%</td><td><b class="r-epic">Epic</b> · “Close call!” (charges up a little) · about 1 in 12</td></tr>
      <tr><td>within 1%, or a tie</td><td><b class="r-legendary">Legendary</b> · “Photo finish!” (charges up, gold explosion) · about 1 in 40</td></tr></table>
    <h4>🛡️ Shields</h4>
    <ul><li>You earn a shield at every ${HILO_SHIELD_EVERY} in a row (${HILO_SHIELD_EVERY}, ${HILO_SHIELD_EVERY * 2}, ${HILO_SHIELD_EVERY * 3}…),
        and one for every <b>photo finish</b> you call right.</li>
      <li>You can hold ${HILO_SHIELD_MAX} at most; the slots are next to your streak.</li>
      <li>A wrong answer with a shield breaks the shield instead of ending the run: your streak doesn’t grow, but it goes
        on with the next song.</li></ul>
    <h4>Score</h4>
    <ul><li>Your score is the number of right answers in the run. The best one is kept in this browser, separately for each
        person (and for everyone together). Beating it calls out “New best!”.</li>
      <li>If you get through all 200 songs, the run is cleared.</li></ul>
    ${RULES_FX()}`},

  tune: {name: "Name that tune", html: () => `
    <p class="rules-lead">Heardle style: name the song from the shortest possible clip.</p>
    <h4>Setup</h4>
    <ul><li><b>Whose songs?</b> One person, or everyone together. <b>From the top</b> 100, 200, 300 or 500 songs of the time
        frame. Songs from your last few games go to the back of the line so they don’t come straight back.</li>
      <li>A game is ${typeof tune !== "undefined" ? tune.rounds : 10} songs. Songs without a preview clip are skipped automatically.</li></ul>
    <h4>A round</h4>
    <ol><li>▶ plays the clip, from the point where the song gets audible (silent intros are skipped). Replay it as often as
        you like.</li>
      <li>The clip grows after every miss or skip: ${TUNE_STAGES.map(s => `${s} s`).join(" → ")}.</li>
      <li>Type the title. Suggestions come from your top 500; typos are forgiven (about one letter in five),
        and “feat. …”, “- Remastered”, “(Live)”, “&amp;”/“and” and a leading “The” don’t matter. “Artist - Title” works too.</li>
      <li>A wrong guess or a skip moves to the next, longer clip and plays it at once. After the ${TUNE_STAGES.at(-1)} s clip, a miss loses the song.</li>
      <li>When the round ends the song is revealed and plays for 30 s.</li></ol>
    <h4>Points</h4>
    <table class="ar-table"><tr><th>Got it at</th>${TUNE_STAGES.map(s => `<th>${s} s</th>`).join("")}</tr>
      <tr><td>Points</td>${TUNE_STAGES.map((_, i) => `<td>${TUNE_STAGES.length - i}</td>`).join("")}</tr>
      <tr><td>Reveal</td>${TUNE_CALLS.map(([l, w]) => `<td class="${l ? `r-${FX_RAR[l]}` : ""}">${w}</td>`).join("")}</tr></table>
    <ul><li>The best possible game is ${(typeof tune !== "undefined" ? tune.rounds : 10) * TUNE_STAGES.length} points. Songs named in a row climb the streak tiers.</li>
      <li>At the end you get a grid to share: 🟩 the clip you got it on, 🟥 the ones before, ⬜ the ones you didn’t need,
        ⬛ a missed song. Your best score is kept per person.</li></ul>
    ${RULES_FX()}`},

  who: {name: "Who played it more?", html: () => `
    <p class="rules-lead">For two or more people: you know each other’s music, right?</p>
    <ul><li>Songs everyone selected has played, from the shared top 200 of the time frame, and only songs with one clear
        winner (no ties). Up to 10 rounds.</li>
      <li>Pick the person who played the song more. Everyone’s count rolls up as a bar in their colour; the winner gets a 👑.</li>
      <li>1 point for every right pick. When the top two counts are within 5% it’s a <b class="r-epic">close call</b>,
        within 1% a <b class="r-legendary">photo finish</b>.</li>
      <li>Right picks in a row climb the streak tiers. 10 out of 10 is perfect. The best score is kept for each group of people.</li></ul>
    ${RULES_FX()}`},

  bracket: {name: "Song bracket", html: () => `
    <p class="rules-lead">Your top songs fight it out, March Madness style. There are no wrong answers.</p>
    <ul><li>The top 16 songs of the time frame (8 or 4 if there are fewer), seeded by rank: 1 v 16, 8 v 9, 5 v 12, 4 v 13…
        so the favourites meet late.</li>
      <li>Tap the song you like more; it goes through, the other one drops out. Rounds: round of 16, quarter-finals,
        semi-finals, final.</li>
      <li><b class="r-epic">Upset!</b> when a song seeded 4 or more places lower knocks out a higher seed.</li>
      <li>The champion charges up and explodes in gold. Each person’s champion is kept in this browser, and the final screen
        shows the others’ (🤝 when two of you crowned the same song).</li></ul>
    ${RULES_FX()}`},

  month: {name: "Guess the month", html: () => `
    <p class="rules-lead">You see a month’s top 5 songs. Which month was it?</p>
    <ul><li>Months come from the time frame on the main page (at least 4 months with listening are needed). With everyone
        together, any month someone listened in.</li>
      <li>4 options, one of them right. 1 point for each right answer, 5 rounds. A wrong answer shows the right month glowing.</li>
      <li>Right answers in a row climb the streak tiers; 5 out of 5 is perfect. The best score is kept per person.</li></ul>
    ${RULES_FX()}`},

  order: {name: "Which came first?", html: () => `
    <p class="rules-lead">Put four songs in the order you first played them.</p>
    <ul><li>Four songs from your top 300 of the time frame, first played at least a month apart from each other.</li>
      <li>Tap them oldest first; each tap stamps a number on the card. <b>Undo</b> takes back the last tap.</li>
      <li>When all four are numbered, the verdicts land one by one in the order you tapped: green in the right place,
        red not, with the date of the first play.</li>
      <li>1 point for every card in the right place, so 4 per round and 20 in a game of 5 rounds. All four right is a
        <b class="r-legendary">Perfect order!</b>; perfect rounds count towards the streak tiers.</li>
      <li>The best score is kept per person.</li></ul>
    ${RULES_FX()}`},

  hitster: {name: "Hitster", html: () => `
    <p class="rules-lead">Hear a song, then place it on your timeline of release years.</p>
    <h4>Setup</h4>
    <ul><li>Songs shared by the people selected on the main page (at least two), with a preview clip. Every song in a game has
        a different release year, and only one song per album can come up.</li>
      <li><b>Solo</b>: build one timeline. <b>2 players</b>: take turns, each with your own timeline.</li>
      <li><b>Cards to win</b>: 2 to 25 (10 by default). Everyone starts with the same starting card, which anchors the
        timeline and doesn’t count.</li></ul>
    <h4>A turn</h4>
    <ol><li>▶ plays the mystery song. No title, artist, cover or year until you place it.</li>
      <li>Tap the gap where it belongs: before, between or after the cards on your timeline.</li>
      <li>A drumroll and the year spins like a slot reel. If it fits the gap (the same year as a neighbour counts), you
        keep the card and it lights up in your timeline. If not, it’s gone, and a ghost card shows where it belonged.</li>
      <li>In 2-player mode the turn then passes, right or wrong.</li></ol>
    <h4>Difficulty</h4>
    <table class="ar-table"><tr><th>Level</th><th>Snippet</th><th>Plays</th><th>Songs</th></tr>
      ${Object.entries(HS_DIFFICULTIES).map(([k, d]) => `<tr><td>${k[0].toUpperCase() + k.slice(1)}</td><td>${d.seconds} s</td>
        <td>${Number.isFinite(d.plays) ? d.plays : "unlimited"}</td><td>${esc(d.hint)}</td></tr>`).join("")}</table>
    <h4>Winning</h4>
    <ul><li>The first to keep the target number of cards wins (solo: you finish the timeline). Placements in a row climb
        the streak tiers; a card from the same year as its neighbour is called out as <b class="r-epic">Same year!</b></li></ul>
    ${RULES_FX()}`},

  roulette: {name: "Rediscover roulette", html: () => `
    <p class="rules-lead">A song you loved and then forgot.</p>
    <ul><li>The wheel only holds songs with 8 or more plays that then went quiet for over a year.</li>
      <li>🎰 spins it: covers fly past and slow down until one lands. The longer it was forgotten, the rarer the landing:
        <b class="r-rare">Rare</b> under 3 years, <b class="r-epic">Long lost</b> from 3 years, <b class="r-legendary">Buried treasure</b>
        from 5 years.</li>
      <li>▶ Preview plays it, Open song shows its full history. Spin as often as you like; there is no score.</li></ul>
    ${RULES_FX()}`},
};

// which tabs a dialog shows, and which one is open first
const RULES_SETS = {
  game: () => ({tabs: ["hilo", "tune", ...(state.people.length > 1 ? ["who"] : []), "bracket", "month", "order"], cur: game.mode}),
  hitster: () => ({tabs: ["hitster"], cur: "hitster"}),
  roulette: () => ({tabs: ["roulette"], cur: "roulette"}),
};

function rulesHTML(set, cur) {
  const {tabs} = RULES_SETS[set]();
  const r = GAME_RULES[cur];
  return `<div class="rules-panel" data-rules-set="${set}">
    ${tabs.length > 1 ? `<div class="tabs rules-tabs" role="tablist" aria-label="Rules for">${tabs.map(k =>
      `<button type="button" role="tab" data-rules-tab="${k}" aria-selected="${k === cur}">${esc(GAME_RULES[k].name)}</button>`).join("")}</div>` : ""}
    <div class="rules-body"><h3>📜 ${esc(r.name)}</h3>${r.html()}</div>
    <div class="g-actions"><button type="button" data-rules-close>Back to the game</button></div></div>`;
}

function openRules(dlg, set, cur) {
  closeRules(dlg);
  const stage = dlg.querySelector(".game-stage, .hitster-body");
  const wrap = document.createElement("div");
  wrap.innerHTML = rulesHTML(set, cur);
  const panel = wrap.firstElementChild;
  stage.before(panel);
  stage.hidden = true;
  dlg.querySelector("[data-rules]")?.setAttribute("aria-pressed", "true");
  dlg.scrollTop = 0;
}
function closeRules(dlg) {
  const panel = dlg?.querySelector(".rules-panel");
  if (!panel) return false;
  panel.remove();
  dlg.querySelectorAll(".game-stage, .hitster-body").forEach(x => { x.hidden = false; });
  dlg.querySelector("[data-rules]")?.setAttribute("aria-pressed", "false");
  return true;
}

document.addEventListener("click", e => {
  const open = e.target.closest("[data-rules]");
  if (open) {
    const dlg = open.closest("dialog"), set = open.dataset.rules;
    if (!closeRules(dlg)) {
      const {tabs, cur} = RULES_SETS[set]();
      openRules(dlg, set, tabs.includes(cur) ? cur : tabs[0]);
    }
    return;
  }
  const tab = e.target.closest("[data-rules-tab]");
  if (tab) {
    const dlg = tab.closest("dialog"), set = tab.closest(".rules-panel").dataset.rulesSet;
    openRules(dlg, set, tab.dataset.rulesTab);
    return;
  }
  if (e.target.closest("[data-rules-close]")) closeRules(e.target.closest("dialog"));
});
["game", "hitster-dlg", "rl-dlg"].forEach(id => $(id)?.addEventListener("close", () => closeRules($(id))));