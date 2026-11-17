# 🏟️ Lyrics Arena

"Guess the lyrics", drafted like an arena run.

The original game: one person picks a song and shows a line of its lyrics, the other has to name the exact
song. Every extra line is a hint, and at the end you sing it. The hard part was always picking the songs: the
rankings only show fixed time frames, and memory pulls you towards whatever you played last month. The
Lyrics Arena does the picking with you. It offers themed packs of songs from your whole history, and you
draft a deck one pick at a time, the way Hearthstone's Arena drafts a deck card by card. Roguelike pieces
(a blessing to start, floors in a hidden random order, rarities, refreshes, treasure, events, a boss pack,
power-ups you keep in your hand and click to use) make the draft a game of its own, and packs
open like Hearthstone packs: face down, turning over one by one, with rare, epic and legendary cards bursting
open in their colours. With every pick you also choose the lyric lines the guesser will get, and at the end
each deck becomes a **lyric sheet** to write on paper. Playing on the screen instead is optional.

It's a game for two, so every song is one you have **both** played at least 3 times: the guesser can name
it, and the drafter can present it and sing along. Within that, everything is seen from the **guesser's**
side: how hard and how rare a song is, its story and the year it belongs to all come from the guesser's
history.

Open it with the **🏟️ Lyrics Arena** button above Insights. It needs two people's histories.
The **📜 Rules** button in the game shows the same rules as this page.

- [Quick start](#quick-start)
- [Setting up a run](#setting-up-a-run)
- [The draft](#the-draft)
- [Choosing the lyric](#choosing-the-lyric)
- [The lyric sheet](#the-lyric-sheet)
- [The reveal: animations and sounds](#the-reveal-animations-and-sounds)
- [Difficulty tiers](#difficulty-tiers)
- [Rarity](#rarity)
- [Pack themes](#pack-themes)
- [How packs are chosen, and recency bias](#how-packs-are-chosen-and-recency-bias)
- [Lyrics and languages](#lyrics-and-languages)
- [Power-ups](#power-ups)
- [The game](#the-game)
- [Points](#points)
- [Saving, hall of fame and files](#saving-hall-of-fame-and-files)
- [Speed](#speed)
- [Tuning](#tuning)

## Quick start

1. Start the server as usual and leave it running for a while the first time. The Arena only offers songs
   whose lyrics are known to be in English, and lyrics are fetched in the background from lrclib.net (one
   song every 1.5 s, most-played songs first, saved in `lyrics_cache.json`). The Arena asks for its songs to
   be checked first. Once the page has loaded, the server also prepares the Arena in the background, so the
   draft starts without a wait (see [Speed](#speed)).
2. Click **🏟️ Lyrics Arena**, choose **Duel**, **10 songs per floor**, **5 refreshes**, and start.
3. The first drafter chooses a blessing, then drafts while the other one looks away, choosing the lyric for
   every song they pick. Then the second drafter does the same.
4. Write each deck's lyric sheet on paper (or copy or print it) and play away from the screen. Or tap
   **▶ Play on this screen** and play here.

## Setting up a run

| Option | What it does |
| --- | --- |
| **Who plays** | The two people. Defaults to the people selected at the top of the page. |
| **Duel** | Both draft a deck for the other. Then you alternate: A presents to B, B presents to A. Most points wins. |
| **One deck** | Only one person drafts, the other only guesses. The drafter collects the guessing power-ups for the guesser. |
| **Songs per floor** | 3, 5 or 10. With 10 you get the classic 40 songs: 10 Easy, 10 Medium, 10 Hard, 10 Impossible. |
| **Refreshes** | 3, 5 (default) or 8 pack refreshes per draft. |
| **English lyrics only** | On by default. Songs in another language give the band away. Off allows any language (still no instrumentals). |
| **Sing-it bonus** | +1 point for singing the next line after a correct guess (on screen; on paper it's a house rule). |

## The draft

The device goes to the drafter. The guesser must not see the screen, since the packs show the songs they'll
have to guess.

**🌅 A blessing to start.** Like Neow in Slay the Spire, before the first pack you choose one of three blessings,
one of them with a price:

| | Blessing | Effect |
| --- | --- | --- |
| 🎁 | Treasure trove | Choose a draft power-up and a guessing power-up, from three each. |
| 🔄 | Spare refreshes | +3 refreshes. |
| ✨ | Legendary opener | Your first pack is the rarest one there is. |
| 🧰 | Bag of tricks | Two random draft power-ups. |
| 🤝 | Helping hand | Two random guessing power-ups. |
| 🔮 | Second sight | Your first 10 packs show which floor they're for. |
| 🎰 | Gambler's bargain | **Lose 2 refreshes**: two random draft and two random guessing power-ups. |
| 🍀 | Born lucky | **Lose 1 refresh**: epic and legendary packs come up twice as often, all draft long. |
| 👑 | Dragon's hoard | **No refreshes at all**: three treasure picks right away. |

**Floors, in a hidden random order.** Your deck still gets the chosen number of songs on each floor (🌱 Easy,
🔥 Medium, 💀 Hard, 👹 Impossible), but the order of the floors is shuffled at the start and you don't see it.
A pack is always for one floor ("🎲 floor hidden" in its corner). You find out which one once you've picked: the
lyric step opens with "It's a Hard song" and its floor's rule for the line, and the song shows up under its floor
in the deck. The 🔭 Spyglass, the 🧭 Compass and Second sight show a pack's floor in advance. The floor tracker
shows how full each floor is, and the status bar shows the pick number, your refreshes and when the next
treasure comes. (The cards still show the guesser's plays, so a careful drafter can guess.)

**Packs.** Every pick shows a **pack**: a theme (for example "💭 Dominik's forgotten favourites" or "📅 2017 vibes")
and 3 to 5 songs for the current floor. Click a song to put it in your deck and the pack is gone. Pack size
depends on the pack's rarity: common and rare packs show 3 songs, epic and legendary packs 4, the Wildcard 5.
A song is offered at most twice per draft. A deck holds at most 3 songs by the same artist. When the songs
of one band are what a pack is about (a whole album, one band only), the songs can share an artist.

Each card shows:
- the song, artist and release year (titles without "- 2012 Remaster", "(feat. …)", "- Live at …" and the like);
- its rarity (the coloured frame and gem);
- the story that put it in this pack, e.g. "Dominik played it 94×, last in Feb 2025";
- the guesser's plays first, with when they last played it and the year they played it most ("peak"), then
  the drafter's plays: "Dominik 99×, last Sep 2026 · peak 2023 · Calin 0×";
- 🕒 **lately** when the guesser played it in the last two months of their history;
- **lyrics unchecked** when its lyrics haven't been fetched yet (see [Lyrics and languages](#lyrics-and-languages)).

**🔄 Refresh.** Swaps the whole pack for a new one, as long as you haven't taken a song from it. You start with
the number chosen in the setup. The pack you refreshed away is unlikely to come straight back, because the
same kind of pack is rare twice in a row.

**🚫 Not for the lyrics game.** Under every card. Choose "Not this song" or "Not <artist>": it's left out of
this and every future draft, for both of you, saved in `arena_blocklist.json`. Use it for German lyrics that
slipped through, an instrumental, a song with no findable lyrics, or anything else. The card is replaced
straight away from the same theme, and it doesn't cost a refresh. The start screen lists everything blocked,
with an undo for each.

**🎁 Treasure.** After every fifth of the draft (after picks 8, 16, 24 and 32 of 40), you take **one draft
power-up and one guessing power-up**, each from three. Together with a blessing that's about five of each by
the end of the draft. Rarely, a 🧰 chest on the way offers the same.

**🎒 Your hand.** Power-ups wait as little round icons under the floors: blue for the draft, gold for guessing.
Click a draft one to use it. Most act on the pack in front of you and only work before you've picked from it
(an icon is greyed out when it can't be used right now; hover it for what it does). Guessing ones can't be
clicked in the draft: they're for the game. In a duel the drafter keeps them for their own turns as guesser;
with one deck the drafter collects them for the guesser. They're listed on the lyric sheet with a box to tick.

**Events.** At most one between two treasures, by chance:
- 🎴 **A face-down card**: a song, Rare or better, that you take blind and only see (with its floor) once it's
  in your deck. Or leave it and get a normal pack.
- 🧳 **A travelling trader**: offers a random power-up for one refresh.

**👑 The boss pack.** The very last pick of the draft. It's an Epic or Legendary pack whenever one is available,
and the song you pick from it is worth double in the game.

**Swaps.**
- ♻️ The **Mulligan** power-up: click it, then click ♻️ next to a song in your deck to throw it out and draft
  a replacement for its floor (click the Mulligan again to keep it for later).
- When a picked song's lyrics turn out not to be English (or not to exist), the lyric step says so and you can
  pick another song. If you keep it anyway, the deck marks it ⚠️ and offers **swap it (free)**.

When the deck is complete, the drafter sees a summary and their lyric sheet, then hands over: in a duel to the
second drafter, otherwise to the end of the draft.

## Choosing the lyric

Right after you pick a song (from a pack or a face-down card), its lyrics open. A starting line is already
selected, following the floor's rule (see [The game](#the-game)): the chorus on Easy, the first half on Medium,
no chorus or title line on Hard, the same from the second half on Impossible.

- Tap any line to start there instead, or 🎲 for another suggestion.
- **Give − / +**: how many lines the guesser gets (1–4). Easy and Medium start with two, Hard and Impossible
  with one. Near the end of the song the selection moves up so all its lines fit.
- ✍️ **Keep** saves the lines with the song, and the draft goes on (the next pack, treasure or event).
- ↩ **Pick another song** puts the song back: into the same pack, or, for a face-down card, you get a normal
  pack for that floor.
- No lyrics found: keep the song and write a line from memory, or pick another one.

The deck panel shows the start of the chosen line under each song.

## The lyric sheet

A finished deck becomes a list to copy onto paper, floor by floor, with the points per star for each floor.
For every song:

- the chosen lines, in bold;
- **Hints**: up to three more lines, the ones that come next (at the end of the song, the ones before). Every
  hint costs the same as on screen;
- → the answer: title, artist and year, its rarity with the bonus (Rare +1, Epic +2, Legendary +3), and 👑 ×2
  for the boss song.

The guesser's power-ups for guessing are listed below it. 📋 **Copy as text** puts a plain-text version on
the clipboard, and 🖨️ **Print** opens it as a clean black-on-white page (allow pop-ups for the page).

Each drafter sees their sheet when their deck is done. After the last draft, **📝 Finish the draft** opens
the end screen. Each deck's sheet is behind its own button, so the guesser can look away while the drafter
opens theirs. From there:

- **▶ Play on this screen** (optional) runs the game below. Each turn starts with the lines chosen in the
  draft already selected, and the presenter can still change them.
- **🏟️ New run** ends this one. Copy or print the sheets first.

The end screen is saved like the rest of the run, so **Continue the run** brings the sheets back.

## The reveal: animations and sounds

Packs open the way Hearthstone packs do:

1. The cards are dealt **face down**. Each back glows in the colour of the card's rarity: nothing for Common,
   blue for Rare, purple for Epic, orange for Legendary. You see at once whether the pack holds something good.
2. They turn over one by one, Common first and the rarest last:
   - **Rare**: the card bursts open in blue, with a chime.
   - **Epic**: it swells for a moment, then bursts in purple: sparks, two rings of light, "EPIC!" and a bigger chime.
   - **Legendary**: it shakes and charges up, glowing brighter and brighter, then explodes in gold: light
     rays, a flash over the screen, the screen shakes, "LEGENDARY!" and a fanfare. On a phone the card is
     scrolled into view first.
3. Face up, rare cards get a sheen that sweeps over them now and then, epic cards pulse in purple, and
   legendary cards a turning golden frame and sparkles.

Tap a face-down card to turn it over at once (no need to wait for the others). A picked card flies into the
deck, where its line lights up, and the others drop away. Epic and Legendary pack banners shimmer, and the
boss pack drops in with drums. The 🎴 face-down card shows its song big in the middle of the screen as it
turns over. A treasure opens with a sparkle and its three power-ups are dealt in. In the game, the revealed
song turns in with its rarity's burst and the stars you earned pop in one by one.

The sounds are made in the browser (no sound files). **🔊** at the top of the Arena switches them off and on,
and the choice is remembered. With "reduce motion" switched on in your system settings, cards appear face up
right away and nothing moves; the sounds still play unless they're off.

## Difficulty tiers

The floors are tuned to how well the **guesser** knows each song:

```
familiarity = log2(1 + guesser's plays) / (1 + years since the guesser last played it / 4)
```

Plays count only from 30 seconds on. "Years since" is measured from the end of the guesser's own history, so
an export that stops in 2025 isn't treated as two years of silence. The four-year fade means a song you
played to death a while ago still counts as known: halved after four years, a third after eight.

| Floor | Familiarity | Roughly (played lately) | Median plays here (Calin for Dominik) |
| --- | --- | --- | --- |
| 🌱 Easy | 6.5 or more | 90+ plays | Dominik 171, Calin 71 |
| 🔥 Medium | 5 to 6.5 | 30–90 plays | Dominik 64, Calin 59 |
| 💀 Hard | 3.5 to 5 | 10–30 plays | Dominik 30, Calin 57 |
| 👹 Impossible | 2 to 3.5 | 3–10 plays, or more long ago | Dominik 10, Calin 54 |

Below 2 the guesser barely knows the song, and it isn't offered. Songs either of you played fewer than 3
times aren't offered either. That leaves about 850 songs per direction with your histories, 110–320 per
floor: plenty for 10 picks a floor.

## Rarity

Rarity says how special a song is **in the guesser's own history**. It is shown in Hearthstone colours:
**Common** (grey), **Rare** (blue), **Epic** (purple), **Legendary** (orange). A song gets the highest rarity
any of these rules gives it:

**Legendary**
- 🔮 Telepathy: both of you put it on within an hour of each other, after neither had played it for 30+ days.
- One of the guesser's 10 biggest one-day binges (see below).
- The guesser's #1 song of a year at least three years back, followed by two years without it.
- One of the first 100 songs in *both* your histories.

**Epic**
- The guesser's next 20 biggest binges.
- The guesser's top 10 of a year at least three years back.
- A forgotten favourite with 100+ plays: the guesser played it 100+ times, but not in the last year.
- A one-season fling: 75% of the guesser's plays of it (at least 8) within two months, at least a year ago.

**Rare**
- The guesser's next 50 biggest binges.
- Any other entry in the guesser's top 30 of a past year.
- One of the first 100 songs in the guesser's history.
- A forgotten favourite with 40+ plays.
- A comeback: the guesser went back to it after 2+ years away (3+ plays after).
- A one-hit wonder: 20+ plays, 90% of the guesser's plays of that artist.
- A night-owl song: 70% of the guesser's 8+ plays between midnight and 4 am.

**Common**: everything else.

**Binges** are ranked against the guesser's own habits, among the songs the Arena can offer: a binge is
5+ plays of a song in one day, at least a year before the end of their history, and the 10 biggest are
legendary. That's fair to both kinds of listener: Calin's biggest are 66–128 plays in a day, Dominik's
English ones 7–12. The story says how many plays it was and when.

With your histories this comes to about 69% Common, 23% Rare, 6% Epic and 2% Legendary for Dominik as the
guesser (close to a Hearthstone pack), and 56% / 33% / 9% / 2% for Calin, whose special songs are more often
ones you both know. Rare songs gather on the Easy floor, since a special song is usually a well-known one.

Rarity matters in the game: guessing a Rare/Epic/Legendary song earns a bonus, and missing it hands the bonus
to the presenter (see [Points](#points)).

## Pack themes

A pack's rarity sets its frame and how often it comes up. The songs inside have their own rarity. Unless a
theme says otherwise, its songs are ranked by the guesser's plays.

| Theme | Rarity | Songs in it |
| --- | --- | --- |
| 💭 **{guesser}'s forgotten favourites** | Epic | The guesser played it 15+ times but not in the last year of their history; the drafter has played it too. |
| 🏆 **{guesser}'s all-time favourites** | Common | The guesser's 200 most played songs (20+ plays). |
| 🗓️ **{guesser}'s {year}** | Rare (Epic 4+ years back) | The guesser's 80 most played songs of a past year (4+ plays that year). Not the current year. |
| 🧳 **{drafter}'s old favourites** | Rare | The drafter played it 15+ times but not in the last year. |
| 📼 **{drafter}'s {year}** | Rare | The drafter's most played songs of a past year. |
| 📅 **{year} vibes** | Common | Released in that year (Apple Music catalogue), 8+ such songs. |
| 📻 **{decade}s throwbacks** | Common | Released in that decade, never the current one. |
| 🎛️ **{genre}** | Common | Apple Music genre with 30+ songs. |
| 🤝 **Shared anthems** | Common | 10+ plays each. |
| 🎸 **The hits of bands you share** | Common | The five songs the guesser plays most by each artist you both played 30+ times. |
| 💎 **Deep cuts** | Rare | Songs of those artists outside those five. |
| 🎁 **More {guesser}'s than {drafter}'s** | Common | The guesser played it at least three times as often as the drafter. |
| 🌞 **{guesser}'s one-season flings** | Epic | 75% of the guesser's plays (8+) within two months, at least a year ago. |
| 🔁 **{guesser} on repeat** | Epic | The guesser's 150 biggest one-day binges (see [Rarity](#rarity)). |
| 🐣 **{guesser}'s first discoveries** | Epic | Among the first 300 songs in the guesser's history. |
| 🥚 **{drafter}'s first discoveries** | Rare | The same for the drafter. |
| 🔙 **{guesser}'s comebacks** | Rare | The guesser went back to it after more than a year (2+ plays after). |
| 🔮 **Telepathy** | Legendary | See [Rarity](#rarity). |
| ✨ **Legends** | Legendary | Only Legendary songs. |
| 🧬 **{a} got {b} into these** | Rare | 5+ plays each; {a} played it first, {b} 30+ days later. |
| 🦄 **One-hit wonders** | Rare | 10+ plays and 90% of the guesser's plays of that artist. |
| 🌙 **{guesser}'s demon hours** | Rare | Half of the guesser's plays between midnight and 4 am (5+ of them). |
| ☀️ **{guesser}'s summer songs** / ❄️ **winter songs** | Common | 60% of the guesser's 6+ plays in June–August / December–February. |
| 💿 **{album}** | Rare | 4+ songs from one album the guesser played 30+ times in all: guess *which* track. |
| 🎤 **All {artist}** | Common | 5+ songs by an artist the guesser played 15+ times. |
| 💔😡🖤❤️🎉🌅💪 **{mood} songs** | Common | The song's lyrics are 45%+ that mood (the moods from Insights). |
| 🎲 **Wildcard** | Common | Anything; shows 5 songs. |

Themes about the drafter (old favourites, years, first discoveries) have a lower base weight (0.5–0.6) than
the guesser's (0.8–1). A theme only appears when at least 3 of its songs are available on the current floor.

## How packs are chosen, and recency bias

1. **Theme.** Every theme with at least 3 available songs on the current floor can come up. Its chance is
   its base weight × a rarity factor (Common 1, Rare 0.85, Epic 0.6, Legendary 0.35), with these changes:
   - ×0.1 if the same kind of theme was one of the last three packs;
   - lower when most of its songs were played lately by the guesser (×0.3 when all of them were);
   - lower on the easy floors when the drafter knows its songs less well (see step 3);
   - ×2 for Epic and Legendary themes with the 🍀 Lucky charm.
2. **Variant.** For themes that come in many versions (a year, a decade, an album, a band), one version is
   chosen. Year themes favour older years: a year counts 1 + half the number of years it is before the newest
   one, so ten years back is six times as likely as last year. Other themes favour versions with fewer recent
   songs.
3. **Songs.** For each slot, one of the *years* the available songs come from is picked first, every year
   equally likely. A song's year is the year the **guesser** played it most. Only then is a song from that
   year chosen. Within a year, songs near the top of the theme's list are more likely, songs the guesser
   played in the last two months are four times less likely, and Rare-or-better songs are 1.3 times as likely
   as common ones. The drafter presents the song and sings along, so on the easy floors their favourites count
   more: by the drafter's plays (3–9 / 10–29 / 30+) a song counts ×0.4 / 0.8 / 1 on Easy, ×0.6 / 0.9 / 1 on
   Medium, ×0.8 / 1 / 1 on Hard and the same on Impossible. A pack avoids two songs by the same artist unless
   it's an album or one-band pack, or there aren't three different artists.

**Against recency bias.** Step 3 is what flattens the timeline. On the Hard floor of Calin's deck for Dominik,
68% of the songs are ones Dominik played most in 2025 or 2026, but 39% of the songs offered are, and songs he
played in the last two months go from 57% of the floor to 19% of what's offered. In Dominik's deck for Calin,
every year from 2018 to 2026 gets 7–19% of the Medium songs offered.

The songs you both know are mostly from the last few years, so the easy floors stay recent: on Easy and
Medium of Calin's deck for Dominik, 80% and 66% of the songs offered are ones Dominik still plays. By
definition those floors hold songs the guesser knows very well, and what you know very well is mostly what
you're playing now. For older songs, play the Hard and Impossible floors, or pick year packs.

## Lyrics and languages

The Arena reads the lyrics cache. For every song it decides:

- **English**: the Arena knows about 300 very common English words ("the", "you", "love", "never"…), and in
  your English songs they make up 53–75% of all words (median 65%). A song counts as English when those make up
  at least 15% of its words, clearly more than any other language's common words, and there are almost no
  letters like ä, ö, ł, ș, å, é that English doesn't use. Very clearly English songs (40%+) pass even with a few
  accents (names).
- **Another language**: German, Finnish, Swedish, Norwegian, Dutch, Polish, Romanian, Spanish, French,
  Italian, Portuguese, Czech, Hungarian and Croatian are recognised by their own common words. Other
  alphabets (Cyrillic, Japanese, Korean, Chinese, Hebrew, Arabic) are recognised too.
- **Mixed**: English with a lot of another language (Rammstein's Amerika, Volbeat's For Evigt). Left out with
  "English only".
- **Instrumental**: lrclib.net marks it instrumental, or the text is just "[Instrumental]".
- **No usable lyrics**: nothing found, a placeholder such as "Artist: TOOL / Album: … / Title: …", or fewer
  than 25 words.

Lyrics written as "original / translation" are judged by the original. On your current cache, about 5,150
songs are English, 580 German, 156 Polish, 85 Finnish (mostly Turmion Katilot), 77 Romanian and 217
instrumental.

Songs whose lyrics haven't been fetched yet can still appear, marked **lyrics unchecked**, when the same
artist has at least 2 checked songs and 80%+ of them are English. They're left out when that artist is mostly
instrumental (Polyphia), or Apple Music files them under Soundtrack, Video Game, Instrumental, New Age,
Classical, Ambient or Score. When you pick an unchecked song, its lyrics are fetched on the spot for the
lyric step. If they fail the check, the lyric step says so and you can pick another song.

With English-only off, unchecked songs from artists with no checked songs at all can appear too.

## Power-ups

You get them from the blessing, the treasures, chests and the trader, and keep them in your hand until you
click them.

**For the draft** (blue icons, click to use; "this pack" means the pack in front of you, before you pick from it):

| | Power-up | Effect |
| --- | --- | --- |
| 🔄 | Second wind | +2 refreshes. |
| 🃏 | Wide pack | Two more songs in this pack (up to 5), from its theme. |
| 🍒 | Cherry-pick | Swap this pack for a theme you choose, from three (same floor). |
| ⏳ | Time machine | Swap this pack for "{year} vibes", a release year you choose (same floor). |
| 👯 | Two for one | Take two songs from this pack (when the floor has two picks left, and not on the boss pick). |
| 🍀 | Lucky charm | Epic and legendary packs come up twice as often for the rest of the draft. |
| ♻️ | Mulligan | Throw one song out of your deck and draft a new one for its floor. |
| 🔭 | Spyglass | See which floor this pack is for. |
| 🧭 | Compass | Choose the floor of this pick: the pack is swapped for one from that floor. |
| 💎 | Polished gem | Swap this pack for an Epic or Legendary one (Rare if there's none). |

**For guessing** (gold icons). In a duel the drafter keeps these for their own turns as the guesser; with one
deck they're the guesser's. On screen, click them during a guess. On paper, tick them off on the sheet and the
presenter does what they say.

| | Power-up | Effect |
| --- | --- | --- |
| 🎤 | Who sings? | Reveal the artist. |
| 📅 | Calendar | Reveal the release year (or the peak year if unknown). |
| 💿 | Liner notes | Reveal the album. |
| 🔤 | Initials | Reveal the first letter of every title word, e.g. `T__ D____ o_ P____ o_ M___`. |
| 🎶 | Chorus | Reveal the chorus line (the most repeated one) for free. On screen, kept if the song has none. |
| 🎵 | Hum it | Play 3 seconds of the song (from where the preview gets audible). On paper: the presenter hums it. |
| ⚖️ | Fifty-fifty | Two titles, one of them right; picking the wrong one is a wrong guess. On screen the wrong one is another song in your decks, by the same band when there is one. |
| 🛡️ | Shield | The next wrong guess costs nothing. |
| 🩹 | Second chance | Take back one hint or wrong guess (a wrong guess first). The lines already shown stay. |
| ✖️ | Double down | Before the first hint or wrong guess: the floor points ×2 if guessed with at most one; otherwise no floor points for this song. |
| 🙅 | Veto | Send the song back: the presenter plays another one of the same floor from their deck instead (if none is left, this one is dropped). |

Power-ups never cost points. Each one is used once.

## The game

**On paper**: the drafter reads (or sings) the lines from their sheet, each hint is the next line on it, and
you count stars and points as below.

**On screen** (optional): songs come floor by floor (all Easy songs first, then Medium…). In a duel the
presenters alternate. A turn:

1. **Look away.** The guesser looks away and the presenter taps "show me the song".
2. **Choose the line.** The presenter sees the song, its story and its lyrics, with the lines chosen in the
   draft already selected; they can tap another line to change them. The 🎲 button suggests a line following
   the floor's rule. These are the floor rules, the same ones the draft uses for its suggestion:

   | Floor | Where to start | Starting lines |
   | --- | --- | --- |
   | 🌱 Easy | the chorus or the line everybody knows (a repeated line) | 2 |
   | 🔥 Medium | any line from the first half | 2 |
   | 💀 Hard | any line that isn't repeated (chorus) and doesn't contain the title | 1 |
   | 👹 Impossible | the same, from the second half | 1 |

   The presenter can change the number of starting lines (1–4). If no lyrics were found, present the song
   from memory: read or sing a line yourself, and count every extra line as a hint. The list leaves out
   section labels like "[Chorus]", "x2", and bits of web pages that sneak into crowd-sourced lyrics ("You
   might also like", a "Resumen / Letras / Videos…" header). Titles drop "- 2012 Remaster", "(feat. …)",
   "- Live at …" and the like, so the initials power-up and the guess are about the song's real name.
3. **👀 Show.** The guesser sees only the lines, plus the song's rarity and the points at stake. They guess
   out loud; the presenter judges whether it's the exact song (right title and band).
   - ➕ **Next line** shows the next line. At the end of the song it shows the line before the excerpt.
   - ❌ **Wrong guess** counts like a hint (unless 🛡️).
   - ✅ **Got it** or 🏳️ **Give up** ends the turn.
   - Stars: 0 hints or wrong guesses → ★★★, 1–2 → ★★, 3–5 → ★. At 6 the song is lost.
4. **Reveal.** The cover, title, band and story appear and the preview plays. With the sing-it bonus on: did
   the guesser sing the line that comes next? ✔ is +1.

## Points

| Floor | Points per star | ★★★ |
| --- | --- | --- |
| 🌱 Easy | 1 | 3 |
| 🔥 Medium | 2 | 6 |
| 💀 Hard | 3 | 9 |
| 👹 Impossible | 4 | 12 |

- **Rarity bonus**: Rare +1, Epic +2, Legendary +3. If the guesser gets the song, the bonus is theirs; if
  not, the presenter **steals** it. Rare picks are a gamble for the drafter.
- 👑 **Boss song**: the floor points ×2 (not the rarity bonus).
- ✖️ **Double down**: the floor points ×2 with at most one hint or wrong guess, otherwise no floor points.
  The rarity bonus works as usual (the guesser's if they got it, the presenter's if not).
- 🎤 **Sing it**: +1.
- 🎁 **Legendary loot**: guessing a Legendary song with ★★★ gives the guesser a random game power-up.

In a duel the highest score after the last song wins. The results show both scores, how many songs each of
you guessed per floor and on the first try, and the five biggest moments.

**House rules worth agreeing on before you start:**
- Does a live or remastered version count as the same song?
- Is the band name needed, or is the title enough?
- Is there a time limit per guess?
- Can the guesser blurt out several titles? (Each one is a wrong guess.)

## Saving, hall of fame and files

- The run is saved in the browser (`localStorage`, key `music-stats-arena-v1`) after every step: close the
  page and **Continue the run** from the start screen. **Abandon it** throws it away.
- Runs played on screen go into the 🏆 **hall of fame** on the start screen (`music-stats-arena-hof`, last 30 runs).
- The 🔊 sound setting is remembered in `music-stats-arena-sound`.
- `arena_blocklist.json`, next to the server: blocked songs and artists (`--arena-blocklist` to move it).
- API:
  - `/api/arena?drafter=<id>&guesser=<id>[&english=0]`: the pool.
  - `/api/arena/lyrics?k=<song key>`: lyrics and their language.
  - `/api/arena/block?song=<key>|artist=<name>[&undo=1]`: the blocklist.

## Speed

Working out the songs for a draft means going through every play of both of you (about 555,000 here) and
checking the language of every cached lyric (about 6,500). Three things keep that out of your way:

- **The server gets ready in the background.** Ten seconds after it starts, it waits until the page has
  loaded its own stats (no request for 3 seconds), then checks the language of every cached lyric and
  works out the first two people's songs. It prints "Lyrics Arena ready" if that took more than 5 seconds.
- **The plays are read once per pair.** Both directions of a duel share that pass, and it's kept until the
  server stops. When new lyrics come in, only the lyrics part is redone (about 0.3 s).
- **The page asks early.** Opening the Arena starts loading both directions while you're on the setup screen.

On this test machine the first draft used to take about 4 s to load and the second about 2 s. Now it's 0.04 s
when the server has warmed up and nothing changed, and about 0.3–0.5 s otherwise. The language check is twice
as fast as before (same results).

If the Arena is opened while the page is still loading its stats right after a server start, the songs wait
for those first, since the server shares one processor core between requests.

## Tuning

| What | Where | Default |
| --- | --- | --- |
| Floor thresholds | `ARENA_TIER_MIN` in `server.py` | 6.5, 5, 3.5, 2 |
| Plays each of you needs on a song | `ARENA_MIN_PLAYS` in `server.py` | 3 |
| Memory fade | `familiarity()` in `arena_pool` | halves after 4 years |
| Pack sizes by rarity | `AR_PACK_SIZE` in `web/arena.js` | 3, 3, 4, 4 (Wildcard 5) |
| How often each rarity of pack comes up | `AR_FAMILY_WEIGHT` | 1, 0.85, 0.6, 0.35 |
| Event chances per pick | `AR_EVENT_CHANCE` | chest 3%, face-down card 3%, trader 2% |
| Treasures per draft | `AR_TREASURES` | 4 (after each fifth) |
| Blessings | `AR_BLESSINGS` | see [The draft](#the-draft) |
| Songs per artist per deck | `AR_ARTIST_CAP` | 3 |
| How likely songs the drafter knows less are, per floor | `AR_DRAFTER_KNOWS` | see [How packs are chosen](#how-packs-are-chosen-and-recency-bias) |
| Binges that are legendary / epic / rare | `binge_level` in `arena_pool` | top 10 / next 20 / next 50 |
| Forgotten favourites that are rare / epic | `rarity_of` in `arena_pool` | 40+ / 100+ plays |
| Hints + wrong guesses before a song is lost | `AR_MAX_PENALTY` | 6 |
| Floor points and starting lines | `AR_TIERS` | 1/2/3/4 points, 2/2/1/1 lines |
| Power-ups | `AR_POWERUPS` | see above |