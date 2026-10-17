#!/usr/bin/env python3
"""
Local server for merged Spotify, Tidal and Apple Music listening history, for one or more people.

    python server.py --spotify ./spotify_export --tidal ./tidal_export
    python server.py --person Alice ./alice --person Bob ./bob_spotify ./bob_tidal.csv --open

Then open http://127.0.0.1:8000 in your browser.

Each --person takes a name and any mix of files and folders (folders are
searched recursively). Exports are recognized by name and contents:
  Spotify      streaming history .json files
  Tidal        the streaming .csv (artist_name, track_title, ...)
  Apple Music  "Apple Music Play Activity.csv", plus "Apple Music Library
               Tracks.json" and "Apple Music - Play History Daily
               Tracks.csv" from the same export to look up artists
--spotify / --tidal still work for a single person (named by --name).
Only the standard library is used.

API (all GET, JSON unless noted). Common parameters:
  from, to      YYYY-MM-DD (inclusive), empty = open
  people        person ids to include, e.g. 0,1 (default: everyone)
  by            plays|minutes|score: the per-person value used for joint scores
  half          decay half-life in days (0 = off)
  minplay       ignore plays shorter than this many seconds (e.g. 30)

  /api/meta       date range, years, people, counts
  /api/tracks     ranked list. Extra: q, sort, page, size, min (minutes),
                  level=track|artist|album, view=top|rediscover|d<person id>,
                  gap (days, for rediscover), w (weights), common (0/1),
                  formula=entropy|logsum|harmonic, norm (0/1)
                  sort: total|score|joint|spotify|tidal|apple|plays|last|artist|title|
                        p<id>|climb|skip_hi|skip_lo
  /api/detail     ?k=<key>: timeline, per-person stats and (for artists and
                  albums) top tracks of one item
  /api/insights   taste match, streaks, listening clock, places
  /api/fun        per person: badges, top songs/artists, biggest day, longest
                  streak and the top song of each period ("eras"); era=day|month|
                  quarter|half|year (default month)
  /api/clock      per person: listening per hour of the day; per 3-hour block
                  (Demon hours, Ghost hours, ...) its share, top artist and the
                  songs played unusually often in it
  /api/more       per person: sessions (openers, closers), seasons, weekdays,
                  Christmas, chosen vs served, devices, places, love-hate songs,
                  milestones
  /api/time       per person: comebacks, ever-present songs, flings, slow
                  burners, on this day; per pair: who found shared songs first
  /api/cover      ?k=<key>: the cover image, downloaded once and then served from the covers/
                  folder; s=small for a thumbnail
  /api/albums     album habits (start to finish, complete, one-song, deep cuts) and, for 2+
                  people, plot twists: songs/albums whose top listener isn't the artist's biggest fan
  /api/hidden     artists left out of all stats; add=<artist key> / remove=<key> / clear=1;
                  focus on some artists only: only=<key> / only_remove=<key> / only_clear=1
  /api/artists    ?q=<name>: artists matching a name, for the "Hide artists" picker
  /api/music      genres, decades, nostalgia, song lengths (from music info looked up so far)
  /api/preview    ?k=<track key>: {"url": 30-second preview} from the iTunes Search API;
                  audio=1 returns the clip itself
  /api/lyrics     ?k=<track key>: {"text": "..."} or {"text": null} (cached)
  /api/extras     part=taste|sync|unusual (default: all). per person: A–Z of artists, title words (dark vs light), one-hit wonders;
                  per pair: telepathy (same song within an hour, out of nowhere), most in-sync day
  /api/roulette   ?people=<id>: random songs you loved but haven't played in over a year
  /api/versus     ?a=&b=&artist=: two people, one artist: rounds, who owns which song, timelines;
                  without artist: suggested close fights
  /api/concerts   your concerts with quick stats; add=1&artist=&date=&city=&people= / remove=<id>
  /api/concert    ?id=<concert id>: songs to prepare: popular songs (Deezer/iTunes), forgotten
                  favourites, songs to learn, deep cuts (setlists are never fetched: no spoilers)
"""

import argparse
import array
import bisect
import csv
import glob
import hashlib
import io
import json
import math
import mimetypes
import os
import random
import re
import sys
import threading
import time
import traceback
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from zoneinfo import ZoneInfo
except ImportError:                                    # Python < 3.9
    ZoneInfo = None

UA = "Mozilla/5.0 (music-stats local server)"
HERE = os.path.dirname(os.path.abspath(__file__))
DAY = 86400

# ---------------------------------------------------------------- matching --

def _base_norm(s):
    s = unicodedata.normalize("NFKC", s or "").casefold()
    s = s.replace("’", "'").replace("‘", "'").replace("`", "'")
    return re.sub(r"\s+", " ", s).strip()


def _strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_title(s, fuzzy):
    s = _base_norm(s)
    if fuzzy:
        s = _strip_accents(s)
        s = re.sub(r"\s*[\(\[](feat\.?|ft\.?|with|featuring)\s[^\)\]]*[\)\]]", "", s)
        s = re.sub(r"\s+-\s+[^-]*remaster[^-]*$", "", s)
        s = re.sub(r"\s*[\(\[][^\)\]]*remaster[^\)\]]*[\)\]]", "", s)
    return s.strip()


def norm_artist(s, fuzzy):
    s = _base_norm(s)
    if fuzzy:
        s = _strip_accents(s)
        s = re.split(r",|;| & | feat\.? | ft\.? | featuring ", s)[0]
    return s.strip()


def norm_album(s, fuzzy):
    s = _base_norm(s)
    if fuzzy:
        s = _strip_accents(s)
        s = re.sub(r"\s*[\(\[][^\)\]]*(deluxe|remaster|edition|expanded|anniversary|bonus)[^\)\]]*[\)\]]", "", s)
        s = re.sub(r"\s+-\s+[^-]*(deluxe|remaster|edition)[^-]*$", "", s)
    return s.strip()


def search_text(s):
    return _strip_accents(_base_norm(s))


# -------------------------------------------------------------- timestamps --

_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
            "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M:%S", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d")


def parse_ts(s):
    """Return a UTC epoch (float) or None. Naive times are treated as UTC."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s) if s > 0 else None
    s = str(s).strip()
    if not s:
        return None
    if s.isdigit():                                   # epoch seconds / ms
        n = int(s)
        return n / 1000 if n > 1e11 else float(n)
    d = None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        base = re.sub(r"(\.\d+)?\s*(UTC|GMT|Z|[+-]\d\d:?\d\d)?$", "", s)
        for fmt in _FORMATS:
            try:
                d = datetime.strptime(base, fmt)
                break
            except ValueError:
                pass
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def iso_day(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d") if ts else None


def day_to_ts(s, end=False):
    if not s:
        return None
    d = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    return d + DAY if end else d                     # "to" is inclusive


# ------------------------------------------------------------ scoring bits --

# Streaming services. A play's source is its index here, and also the slot of
# its milliseconds in a record, so adding a service only means adding a name.
SOURCES = ("spotify", "tidal", "apple")
SPOTIFY, TIDAL, APPLE = range(3)
NSRC = len(SOURCES)

# The day in 3-hour blocks: (id, name, emoji); block = local hour // 3
DAYPARTS = (("demon", "Demon hours", "😈"), ("ghost", "Ghost hours", "👻"), ("sunrise", "Sunrise", "🌅"),
            ("coffee", "Coffee hours", "☕"), ("lunch", "Lunch break", "🍜"), ("drift", "Afternoon drift", "🌤️"),
            ("golden", "Golden hour", "🌇"), ("night", "Night drive", "🌙"))

# per-person record: [ms per source..., plays, score_ms, first_ts, last_ts, skips, plays_with_skip_info]
PLAYS, SCORE, FIRST, LAST, SKIPS, SKIP_N = range(NSRC, NSRC + 6)


def new_rec():
    return [0] * NSRC + [0, 0.0, math.inf, 0.0, 0, 0]


def rec_ms(r):
    """Total milliseconds of a record, across all services."""
    return sum(r[:NSRC])


def merge_rec(dst, src):
    if dst is None:
        return list(src)
    for i in (*range(NSRC), PLAYS, SCORE, SKIPS, SKIP_N):
        dst[i] += src[i]
    dst[FIRST] = min(dst[FIRST], src[FIRST])
    dst[LAST] = max(dst[LAST], src[LAST])
    return dst


MEASURES = {                                       # the per-person value joint scores use
    "plays": lambda r: r[PLAYS],
    "minutes": lambda r: rec_ms(r) / 60000,
    "score": lambda r: r[SCORE] / 60000,           # decayed minutes ("points")
}


# Joint score formulas. v = each included person's value (plays, minutes or
# points, possibly normalized), w = their weights. All give 0 when nobody played.

def joint_entropy(v, w):
    """Shared listening: sum of w_i * v_i * log(1 / P_i), P_i = v_i / sum(v).

    Each person's listening times the log of how much the song's total exceeds
    their own part; a person who barely shares the song adds almost nothing.
    """
    total = sum(v)
    if total <= 0:
        return 0.0
    return sum(wi * vi * math.log(total / vi) for vi, wi in zip(v, w) if vi > 0)


def joint_logsum(v, w):
    """Sum of w_i * log(1 + v_i): lenient, one person can carry a song."""
    return sum(wi * math.log1p(vi) for vi, wi in zip(v, w))


def joint_harmonic(v, w):
    """Weighted harmonic mean: sum(w) / sum(w_i / v_i); strict, follows the smallest side."""
    used = [(vi, wi) for vi, wi in zip(v, w) if wi > 0]
    if not used or any(vi <= 0 for vi, _ in used):
        return 0.0
    return sum(wi for _, wi in used) / sum(wi / vi for vi, wi in used)


FORMULAS = {"entropy": joint_entropy, "logsum": joint_logsum, "harmonic": joint_harmonic}
RANKABLE = {"total", "score", "joint", "plays", *SOURCES}


def cosine(a, b):
    """Cosine similarity of two sparse vectors (dicts)."""
    if not a or not b:
        return 0.0
    dot = sum(v * b[k] for k, v in a.items() if k in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


# ----------------------------------------------------------------- library --

class Level:
    """One way of grouping plays: by track, artist or album."""

    def __init__(self, name):
        self.name = name
        self.keys, self.title, self.sub, self.hay = [], [], [], []
        self.sort_a, self.sort_t, self.members = [], [], []
        self.of_track = []                             # track id -> group id (or -1)


class Library:
    def __init__(self, fuzzy=True, tz=None, tidal_local=False):
        self.fuzzy = fuzzy
        self.tz = tz                                   # ZoneInfo, or None = this computer's time zone
        self.tidal_local = tidal_local
        self.people = []                               # names, index = person id
        self.key_to_id = {}
        self.keys, self.names, self.uris, self.albums, self.apple_ids = [], [], [], [], []
        # (ts, track_id, person_id, source, ms, skipped (1/0/None), place, time zone name)
        self.raw = []
        self.extra = []                                # per play: (how it started, device), parallel to raw
        self.meta_seed = {}                            # track key -> genre/year/duration from the exports
        self.undated = 0

    def person(self, name):
        if name not in self.people:
            self.people.append(name)
        return self.people.index(name)

    def _track(self, artist, title):
        key = (norm_artist(artist, self.fuzzy), norm_title(title, self.fuzzy))
        tid = self.key_to_id.get(key)
        if tid is None:
            tid = self.key_to_id[key] = len(self.keys)
            self.keys.append("\t".join(key))
            self.names.append(Counter())
            self.uris.append(None)
            self.albums.append(Counter())
            self.apple_ids.append(None)
        return tid

    def add(self, pid, ts, artist, title, ms, source, uri=None, album=None, skipped=None, place=None,
            tzname=None, apple_id=None, mode=None, device=None):
        tid = self._track(artist, title)
        self.names[tid][(artist, title)] += ms + 1
        if uri and not self.uris[tid]:
            self.uris[tid] = uri
        if apple_id and not self.apple_ids[tid]:
            self.apple_ids[tid] = apple_id
        if album:
            self.albums[tid][album] += ms + 1
        t = parse_ts(ts)
        if t is None:
            self.undated += 1
            t = 0.0                                    # only shows up in "all time"
        self.raw.append((t, tid, pid, source, ms, skipped, place, tzname))
        self.extra.append((mode, device))
        return tid

    # ------------------------------------------------------------ indexing --
    def finalize(self, hidden=()):
        order = sorted(range(len(self.raw)), key=lambda i: self.raw[i][0])
        self.raw = [self.raw[i] for i in order]
        self.extra = [self.extra[i] for i in order]
        self.ts = [p[0] for p in self.raw]
        n = len(self.keys)
        self.display = [c.most_common(1)[0][0] for c in self.names]
        self.album_name = [c.most_common(1)[0][0] if c else None for c in self.albums]

        # tracks
        tr = Level("track")
        for tid in range(n):
            a, t = self.display[tid]
            tr.keys.append(self.keys[tid])
            tr.title.append(t)
            tr.sub.append(a)
            tr.hay.append(search_text(f"{a} {t} {self.album_name[tid] or ''}"))
            tr.sort_a.append(search_text(a))
            tr.sort_t.append(search_text(t))
            tr.members.append([tid])
            tr.of_track.append(tid)

        # artists: grouped by the normalized artist part of the track key
        ar = Level("artist")
        art_ids, art_names = {}, []
        for tid in range(n):
            akey = self.keys[tid].split("\t")[0]
            gid = art_ids.get(akey)
            if gid is None:
                gid = art_ids[akey] = len(ar.keys)
                ar.keys.append("a:" + akey)
                ar.members.append([])
                art_names.append(Counter())
            ar.members[gid].append(tid)
            ar.of_track.append(gid)
            for (a, _), c in self.names[tid].items():
                art_names[gid][a] += c
        for gid, c in enumerate(art_names):
            name = c.most_common(1)[0][0]
            ar.title.append(name)
            ar.sub.append("")
            ar.hay.append(search_text(name))
            ar.sort_a.append(search_text(name))
            ar.sort_t.append(search_text(name))

        # albums: only tracks whose album is known (Spotify data has it, Tidal doesn't)
        al = Level("album")
        alb_ids = {}
        for tid in range(n):
            name = self.album_name[tid]
            if not name:
                al.of_track.append(-1)
                continue
            akey = self.keys[tid].split("\t")[0] + "\t" + norm_album(name, self.fuzzy)
            gid = alb_ids.get(akey)
            if gid is None:
                gid = alb_ids[akey] = len(al.keys)
                al.keys.append("b:" + akey)
                al.members.append([])
                artist = ar.title[ar.of_track[tid]]
                al.title.append(name)
                al.sub.append(artist)
                al.hay.append(search_text(f"{name} {artist}"))
                al.sort_a.append(search_text(artist))
                al.sort_t.append(search_text(name))
            al.members[gid].append(tid)
            al.of_track.append(gid)

        self.levels = {"track": tr, "artist": ar, "album": al}
        self.key_index = {}
        for lvl in self.levels.values():
            for i, k in enumerate(lvl.keys):
                self.key_index[k] = (lvl, i)

        # per play, in local time: hour of the week (Mon 0:00 = 0 ... Sun 23:00 = 167)
        # and the calendar day (as a date ordinal)
        zones = {}
        self.how = bytearray(len(self.raw))
        self.lday = array.array("i", bytes(4 * len(self.raw)))
        for i, (t, _, _, src, _, _, _, tzname) in enumerate(self.raw):
            if not t:
                self.how[i] = 255
                continue
            if src == TIDAL and self.tidal_local:
                d = datetime.fromtimestamp(t, timezone.utc)          # already local, kept as-is
                self.how[i] = d.weekday() * 24 + d.hour
                self.lday[i] = d.toordinal()
                continue
            z = None
            if tzname and tzname not in zones:
                if tzname.startswith("offset:"):           # Apple: seconds from UTC at that moment
                    try:
                        zones[tzname] = timezone(timedelta(seconds=int(tzname[7:])))
                    except (ValueError, OverflowError):
                        zones[tzname] = None
                elif ZoneInfo:
                    try:
                        zones[tzname] = ZoneInfo(tzname)
                    except Exception:
                        zones[tzname] = None
                else:
                    zones[tzname] = None
            if tzname:
                z = zones[tzname]
            z = z or self.tz
            d = datetime.fromtimestamp(t, z) if z else datetime.fromtimestamp(t)   # else: this computer's zone
            self.how[i] = d.weekday() * 24 + d.hour
            self.lday[i] = d.toordinal()

        # everything above covers all plays; what the stats see can leave out hidden artists
        self.all_raw, self.all_extra, self.all_how, self.all_lday = self.raw, self.extra, self.how, self.lday
        self.credits = self._credits()
        self.credit_ms = Counter()                       # listening per credited artist name, hidden or not
        for p in self.all_raw:
            for n in self.credits[p[1]]:
                self.credit_ms[n] += p[4]
        self.credit_hay = {n: search_text(t) for n, t in self.credit_title.items()}
        self.set_hidden(hidden)

    # ------------------------------------------------------- hidden artists --
    def find_artists(self, q, limit=12):
        """Artists (including ones only ever featured) whose name contains q, most listened first."""
        words = search_text(q).split()
        hits = [n for n, hay in self.credit_hay.items() if all(w in hay for w in words)] if words else []
        hits.sort(key=lambda n: -self.credit_ms[n])
        return [{"key": "a:" + n, "title": self.credit_title[n], "ms": self.credit_ms[n],
                 "hidden": "a:" + n in self.hidden, "only": "a:" + n in self.only} for n in hits[:limit]]

    def is_artist_key(self, key):
        return key.startswith("a:") and key[2:] in self.credit_title

    _SPLIT = re.compile(r",|;| & | x | feat\.? | ft\.? | featuring | with ", re.I)
    _FEAT = re.compile(r"[\(\[](?:feat|ft|with|featuring)\.?\s+([^\)\]]+)[\)\]]", re.I)

    def _credits(self):
        """Per track: every artist credited (main, co-artists, "feat." in the title), normalized.
        Also collects how each name is usually written, for the "Hide artists" search."""
        out, shown = [], defaultdict(Counter)
        art = self.levels["artist"]
        for tid in range(len(self.keys)):
            main = self.keys[tid].split("\t")[0]
            names = {main}
            shown[main][art.title[art.of_track[tid]]] += 1
            for artist, title in self.names[tid]:
                parts = [x.strip() for x in self._SPLIT.split(artist) if x.strip()]
                for feat in self._FEAT.findall(title):
                    parts += [x.strip() for x in self._SPLIT.split(feat) if x.strip()]
                for x in parts:
                    n = norm_artist(x, True)
                    if n:
                        names.add(n)
                        shown[n][x] += 1
            out.append(frozenset(names))
        self.credit_title = {n: c.most_common(1)[0][0] for n, c in shown.items()}
        return out

    def set_hidden(self, keys, only=()):
        """Leave out every play of the given artists (artist keys "a:<name>"), including songs
        they're featured on; with `only`, also leave out everything not by (or featuring) those
        artists. Then rebuild the indexes and clear all caches."""
        self.hidden = sorted(k for k in keys if self.is_artist_key(k))
        self.only = sorted(k for k in only if self.is_artist_key(k) and k not in self.hidden)
        names = {k[2:] for k in self.hidden}
        keep_names = {k[2:] for k in self.only}
        drop = {tid for tid, c in enumerate(self.credits)
                if (names and c & names) or (keep_names and not c & keep_names)}
        keep = [i for i, p in enumerate(self.all_raw) if p[1] not in drop] if drop else range(len(self.all_raw))
        self.raw = [self.all_raw[i] for i in keep]
        self.extra = [self.all_extra[i] for i in keep]
        self.how = bytearray(self.all_how[i] for i in keep)
        self.lday = array.array("i", (self.all_lday[i] for i in keep))
        self.ts = [p[0] for p in self.raw]
        self.hidden_tracks = len(drop)
        self._activate()

    def _activate(self):
        n = len(self.keys)
        # per track: indices into raw (for the detail popup)
        self.track_plays = [[] for _ in range(n)]
        for i, p in enumerate(self.raw):
            self.track_plays[p[1]].append(i)

        # who ever played what (for "discover")
        self.ever = {name: [set() for _ in self.people] for name in self.levels}
        for p in self.raw:
            tid, pid = p[1], p[2]
            for name, lvl in self.levels.items():
                gid = lvl.of_track[tid]
                if gid >= 0:
                    self.ever[name][pid].add(gid)

        self.person_stats = [{"name": nm, "plays": 0, "first": None, "last": None, "last_ts": 0.0}
                             for nm in self.people]
        for p in self.raw:
            ps = self.person_stats[p[2]]
            ps["plays"] += 1
            if p[0]:
                ps["first"] = ps["first"] or iso_day(p[0])
                ps["last_ts"] = p[0]
        for ps in self.person_stats:
            ps["last"] = iso_day(ps["last_ts"]) if ps["last_ts"] else None

        self.aggregate = lru_cache(maxsize=64)(self._aggregate)
        self.level_agg = lru_cache(maxsize=64)(self._level_agg)
        self.insights = lru_cache(maxsize=32)(self._insights)
        self.fun = lru_cache(maxsize=32)(self._fun)
        self.time_travel = lru_cache(maxsize=16)(self._time)
        self.clock = lru_cache(maxsize=32)(self._clock)
        self.more = lru_cache(maxsize=16)(self._more)
        self.match = lru_cache(maxsize=32)(self._match)
        self.extras = lru_cache(maxsize=16)(self._extras)
        self._albums_key = None

    # -------------------------------------------------------- aggregation --
    def _span(self, lo_ts, hi_ts):
        lo = bisect.bisect_left(self.ts, lo_ts) if lo_ts is not None else 0
        hi = bisect.bisect_left(self.ts, hi_ts) if hi_ts is not None else len(self.ts)
        return lo, hi

    def _aggregate(self, lo_ts, hi_ts, half_s=0.0, ref=0.0, minplay_ms=0):
        """{track_id: [record or None per person]} for plays in [lo_ts, hi_ts).

        With a half-life (half_s, seconds) each play adds ms * 0.5 ** (age / half_s)
        to the score, age measured back from `ref`. Plays shorter than minplay_ms
        still count toward skips but not toward listening; a record with only
        those has PLAYS == 0 and is treated as "not played".
        """
        lo, hi = self._span(lo_ts, hi_ts)
        k = math.log(2) / half_s if half_s else 0.0
        n_people = len(self.people)
        acc = {}
        for t, tid, pid, src, ms, skipped, _, _ in self.raw[lo:hi]:
            recs = acc.get(tid)
            if recs is None:
                recs = acc[tid] = [None] * n_people
            r = recs[pid]
            if r is None:
                r = recs[pid] = new_rec()
            # skips are counted for every play: skipped plays are usually the short ones
            if skipped is not None:
                r[SKIP_N] += 1
                r[SKIPS] += skipped
            if ms < minplay_ms:
                continue                               # too short to count as listening
            r[src] += ms
            r[PLAYS] += 1
            if t < r[FIRST]:
                r[FIRST] = t
            r[LAST] = t                                # raw is sorted, so this is the latest
            r[SCORE] += ms * math.exp(-k * max(ref - t, 0.0)) if k else ms
        return acc

    def _level_agg(self, level, lo_ts, hi_ts, half_s=0.0, ref=0.0, minplay_ms=0):
        """Like aggregate, grouped by level. Returns (recs by id, best track per id, track count per id)."""
        agg = self.aggregate(lo_ts, hi_ts, half_s, ref, minplay_ms)
        if level == "track":
            return agg, {tid: tid for tid in agg}, {tid: 1 for tid in agg}
        lvl = self.levels[level]
        out, best, best_ms, count = {}, {}, {}, Counter()
        for tid, recs in agg.items():
            gid = lvl.of_track[tid]
            if gid < 0:
                continue
            dst = out.get(gid)
            if dst is None:
                dst = out[gid] = [None] * len(recs)
            for i, r in enumerate(recs):
                if r:
                    dst[i] = merge_rec(dst[i], r)
            ms = sum(rec_ms(r) for r in recs if r)
            count[gid] += 1
            if ms > best_ms.get(gid, -1):
                best_ms[gid], best[gid] = ms, tid
        return out, best, count

    # --------------------------------------------------------------- rows --
    def _rows(self, recs_by_id, sel, weights, measure, joint_fn, common, min_ms, normalize,
              discover=None, level="track", exclude=None):
        """Turn grouped records into scored rows for the selected people."""
        joint_mode = len(sel) > 1
        scale = [1.0] * len(sel)
        if normalize and joint_mode:
            tot = [0.0] * len(sel)
            for recs in recs_by_id.values():
                for j, pid in enumerate(sel):
                    if recs[pid] and recs[pid][PLAYS]:
                        tot[j] += measure(recs[pid])
            avg = sum(tot) / len(sel)
            scale = [avg / t if t > 0 else 0.0 for t in tot]
        others_ever = []
        if discover is not None:
            others_ever = [self.ever[level][o] for o in sel if o != discover]

        rows, hidden, not_common = [], 0, 0
        for gid, recs in recs_by_id.items():
            if exclude and gid in exclude:
                continue
            raw_ps = [recs[i] for i in sel]
            ps = [p if p and p[PLAYS] else None for p in raw_ps]   # only short plays = not played
            played = [p for p in ps if p]
            if not played:
                continue
            if discover is not None:
                if not (recs[discover] and recs[discover][PLAYS]) or any(gid in s for s in others_ever):
                    continue
            elif joint_mode and common and len(played) < len(ps):
                not_common += 1
                continue
            by_src = [sum(p[i] for p in played) for i in range(NSRC)]
            total = sum(by_src)
            if total < min_ms:
                hidden += 1
                continue
            rows.append({
                "id": gid, "total": total, "src": by_src,
                "plays": sum(p[PLAYS] for p in played),
                "first": min(p[FIRST] for p in played), "last": max(p[LAST] for p in played),
                "score": sum(p[SCORE] for p in played) / 60000,
                "skips": sum(p[SKIPS] for p in raw_ps if p), "skip_n": sum(p[SKIP_N] for p in raw_ps if p),
                "joint": joint_fn([measure(p) * sc if p else 0.0 for p, sc in zip(ps, scale)], weights),
                "per": ps,
            })
        return rows, hidden, not_common

    @staticmethod
    def _keyfn(sort, sel, measure, lvl):
        def skip_rate(r):
            return r["skips"] / r["skip_n"] if r["skip_n"] >= 5 else None
        keys = {
            "total": lambda r: -r["total"],
            "score": lambda r: -r["score"],
            "joint": lambda r: -r["joint"],
            **{name: (lambda i: lambda r: -r["src"][i])(i) for i, name in enumerate(SOURCES)},
            "plays": lambda r: -r["plays"],
            "last": lambda r: -r["last"],
            "artist": lambda r: (lvl.sort_a[r["id"]], lvl.sort_t[r["id"]]),
            "title": lambda r: (lvl.sort_t[r["id"]], lvl.sort_a[r["id"]]),
            # fewer than 5 plays with skip info: not enough data, goes last
            "skip_hi": lambda r: (skip_rate(r) is None, -(skip_rate(r) or 0)),
            "skip_lo": lambda r: (skip_rate(r) is None, skip_rate(r) or 0),
        }
        m = re.fullmatch(r"p(\d+)", sort or "")
        if m and int(m.group(1)) in sel:
            j = sel.index(int(m.group(1)))
            return lambda r: -(measure(r["per"][j]) if r["per"][j] else -1)
        return keys.get(sort)

    def _ranked(self, rows, sort, sel, measure, lvl):
        rows.sort(key=lambda r: -r["total"])           # tie-break for every sort
        keyfn = self._keyfn(sort, sel, measure, lvl)
        if keyfn:
            rows.sort(key=keyfn)
        return rows

    def last_ts(self, sel):
        return max((self.person_stats[p]["last_ts"] for p in sel), default=0.0)

    # -------------------------------------------------------------- query --
    def query(self, frm, to, q, sort, page, size, min_ms=0, half_days=0, people=None, weights=None,
              by="plays", common=True, formula="entropy", normalize=False, level="track",
              view="top", gap_days=365, minplay_s=0, cap=""):
        lvl = self.levels.get(level) or self.levels["track"]
        level = lvl.name
        sel = people or list(range(len(self.people)))
        weights = (list(weights or []) + [1.0] * len(sel))[:len(sel)]
        joint_mode = len(sel) > 1
        measure = MEASURES.get(by, MEASURES["plays"])
        joint_fn = FORMULAS.get(formula, joint_entropy)
        half_s = half_days * DAY
        minplay_ms = int(minplay_s * 1000)
        today_end = (int(time.time()) // DAY + 1) * DAY

        discover = None
        m = re.fullmatch(r"d(\d+)", view or "")
        if m and joint_mode and int(m.group(1)) in sel:
            discover, view = int(m.group(1)), "discover"
        elif view not in ("top", "rediscover"):
            view = "top"

        exclude, cutoff = None, None
        if view == "rediscover":
            # loved before the cutoff, not played by any of the selected people since
            cutoff = self.last_ts(sel) + 1 - gap_days * DAY
            lo_ts, hi_ts, ref = None, cutoff, cutoff
            recent, _, _ = self.level_agg(level, cutoff, None, 0.0, 0.0, minplay_ms)
            exclude = {gid for gid, recs in recent.items() if any(recs[p] and recs[p][PLAYS] for p in sel)}
        else:
            lo_ts, hi_ts = day_to_ts(frm), day_to_ts(to, end=True)
            # decay is measured back from the end of the frame, or from the end of today
            ref = min(hi_ts, today_end) if hi_ts is not None else today_end

        recs, best, count = self.level_agg(level, lo_ts, hi_ts, half_s, ref if half_s else 0.0, minplay_ms)
        args = (sel, weights, measure, joint_fn, common, min_ms, normalize, discover, level)
        rows, hidden, not_common = self._rows(recs, *args, exclude=exclude)

        default = "joint" if joint_mode else ("score" if half_s else "total")
        rank_sort = sort if (sort in RANKABLE or re.fullmatch(r"p\d+", sort or "")) else default
        rows = self._ranked(rows, rank_sort, sel, measure, lvl)
        rank = {r["id"]: i + 1 for i, r in enumerate(rows)}

        # movement vs. the previous period of the same length
        prev_rank, has_prev = {}, False
        if view == "top" and lo_ts is not None and hi_ts is not None:
            span = min(hi_ts, today_end) - lo_ts
            if span > 0:
                has_prev = True
                p_recs, _, _ = self.level_agg(level, lo_ts - span, lo_ts, half_s, lo_ts if half_s else 0.0, minplay_ms)
                p_rows, _, _ = self._rows(p_recs, *args)
                p_rows = self._ranked(p_rows, rank_sort, sel, measure, lvl)
                prev_rank = {r["id"]: i + 1 for i, r in enumerate(p_rows)}
        newcomer = len(prev_rank) + 1

        def move(gid):
            if not has_prev:
                return None
            return prev_rank.get(gid, newcomer) - rank[gid]

        if sort == "climb" and has_prev:
            rows.sort(key=lambda r: (-move(r["id"]), rank[r["id"]]))
        elif sort != rank_sort:
            rows = self._ranked(rows, sort, sel, measure, lvl)

        # "one song per album/artist": keep only the first (best-sorted) song of each
        if level == "track" and cap in ("album", "artist"):
            of = self.levels[cap].of_track
            seen, kept = set(), []
            for r in rows:
                g = of[r["id"]]
                if g >= 0 and g in seen:
                    continue
                if g >= 0:
                    seen.add(g)
                kept.append(r)
            rows = kept
            # ranks count only the songs that are left; movement vs. last period no longer lines up
            rank = {gid: i + 1 for i, gid in enumerate(sorted((r["id"] for r in rows), key=rank.get))}
            has_prev, prev_rank = False, {}

        per_person = [{"ms": 0, "plays": 0, "score": 0.0} for _ in sel]
        for r in rows:
            for j, p in enumerate(r["per"]):
                if p:
                    per_person[j]["ms"] += rec_ms(p)
                    per_person[j]["plays"] += p[PLAYS]
                    per_person[j]["score"] += p[SCORE] / 60000
        totals = {
            "tracks": len(rows), "hidden": hidden, "not_common": not_common,
            "plays": sum(r["plays"] for r in rows),
            **{name: sum(r["src"][i] for r in rows) for i, name in enumerate(SOURCES)},
            "score": sum(r["score"] for r in rows), "people": per_person,
        }

        words = search_text(q).split()
        view_rows = [r for r in rows if all(w in lvl.hay[r["id"]] for w in words)] if words else rows
        pages = max(1, -(-len(view_rows) // size))
        page = min(max(1, page), pages)
        is_new = lambda gid: has_prev and gid not in prev_rank
        items = [self._item(r, lvl, best, count, rank, move, is_new) for r in view_rows[(page - 1) * size: page * size]]

        return {"totals": totals, "matched": len(view_rows), "page": page, "pages": pages, "size": size,
                "ref": iso_day(ref - 1) if ref else None, "cutoff": iso_day(cutoff) if cutoff else None,
                "people": sel, "level": level, "view": view, "has_prev": has_prev,
                "match": self.match(lo_ts, hi_ts, tuple(sel), by, half_s, ref if half_s else 0.0, minplay_ms)
                         if joint_mode and view != "rediscover" else [],
                "items": items}

    def _item(self, r, lvl, best, count, rank, move, is_new):
        gid = r["id"]
        tid = best.get(gid, lvl.members[gid][0])
        uri = self.uris[tid] if lvl.name == "track" else None
        mv = move(gid)
        return {
            "key": lvl.keys[gid], "kind": lvl.name, "title": lvl.title[gid], "sub": lvl.sub[gid],
            "album": self.album_name[tid] if lvl.name == "track" else None,
            "cover_key": self.keys[tid], "n_tracks": count.get(gid, 0),
            "total": r["total"], **{name: r["src"][i] for i, name in enumerate(SOURCES)}, "plays": r["plays"],
            "score": round(r["score"], 2), "joint": round(r["joint"], 3),
            "first": iso_day(r["first"]), "last": iso_day(r["last"]),
            "skips": r["skips"], "skip_n": r["skip_n"],
            "rank": rank[gid], "move": mv, "new": is_new(gid),
            "per": [{"ms": rec_ms(p), "plays": p[PLAYS], "score": round(p[SCORE] / 60000, 2)}
                    if p else None for p in r["per"]],
            "spotify_url": f"https://open.spotify.com/track/{uri.split(':')[-1]}" if uri else None,
            "apple_id": self.apple_ids[tid] if lvl.name == "track" else None,
        }

    # -------------------------------------------------------- taste match --
    def _match(self, lo_ts, hi_ts, sel, by, half_s, ref, minplay_ms):
        """Cosine similarity between people's listening, on log(1 + value), for songs and artists."""
        measure = MEASURES.get(by, MEASURES["plays"])
        out = []
        vecs = {}
        for level in ("track", "artist"):
            recs, _, _ = self.level_agg(level, lo_ts, hi_ts, half_s, ref, minplay_ms)
            for pid in sel:
                vecs[(level, pid)] = {gid: math.log1p(measure(r[pid])) for gid, r in recs.items()
                                      if r[pid] and r[pid][PLAYS]}
        for i, a in enumerate(sel):
            for b in sel[i + 1:]:
                ta, tb = vecs[("track", a)], vecs[("track", b)]
                out.append({"a": a, "b": b,
                            "songs": round(cosine(ta, tb), 4),
                            "artists": round(cosine(vecs[("artist", a)], vecs[("artist", b)]), 4),
                            "shared_songs": len(ta.keys() & tb.keys())})
        return out

    # ------------------------------------------------------------- detail --
    def detail(self, key, frm, to, sel, minplay_s=0):
        found = self.key_index.get(key)
        if not found:
            return None
        lvl, gid = found
        selset = set(sel)
        lo_ts, hi_ts = day_to_ts(frm), day_to_ts(to, end=True)
        minplay_ms = minplay_s * 1000
        idx = sorted(i for tid in lvl.members[gid] for i in self.track_plays[tid])
        in_idx = [i for i in idx
                  if self.raw[i][2] in selset and self.raw[i][0]
                  and (lo_ts is None or self.raw[i][0] >= lo_ts) and (hi_ts is None or self.raw[i][0] < hi_ts)]
        in_frame = [self.raw[i] for i in in_idx]
        plays = [p for p in in_frame if p[4] >= minplay_ms]   # skips still count from in_frame
        hours = [0] * 24                                     # plays per local hour of the day
        for i in in_idx:
            if self.raw[i][4] >= minplay_ms and self.how[i] != 255:
                hours[self.how[i] % 24] += 1

        per = {pid: {"pid": pid, "plays": 0, "ms": 0, "skips": 0, "skip_n": 0, "first": None, "last": None}
               for pid in sel}
        top = defaultdict(lambda: [0, 0])
        for t, tid, pid, src, ms, skipped, _, _ in in_frame:
            if skipped is not None:
                per[pid]["skip_n"] += 1
                per[pid]["skips"] += skipped
        for t, tid, pid, src, ms, skipped, _, _ in plays:
            p = per[pid]
            p["plays"] += 1
            p["ms"] += ms
            p["first"] = p["first"] or iso_day(t)
            p["last"] = iso_day(t)
            top[tid][0] += ms
            top[tid][1] += 1

        # timeline buckets: daily for short spans, weekly up to ~13 months, monthly beyond
        buckets, unit, series = [], "month", []
        if plays:
            start = lo_ts if lo_ts is not None else plays[0][0]
            end = min(hi_ts, time.time()) if hi_ts is not None else plays[-1][0]
            span_days = max((end - start) / DAY, 1)
            unit = "day" if span_days <= 62 else "week" if span_days <= 400 else "month"
            d0 = datetime.fromtimestamp(start, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            if unit == "week":
                d0 = datetime.fromtimestamp(d0.timestamp() - d0.weekday() * DAY, timezone.utc)
            if unit == "month":
                d0 = d0.replace(day=1)

            def bucket(t):
                d = datetime.fromtimestamp(t, timezone.utc)
                if unit == "month":
                    return (d.year - d0.year) * 12 + d.month - d0.month
                return int((t - d0.timestamp()) // (DAY * (7 if unit == "week" else 1)))

            n = bucket(end) + 1
            for b in range(n):
                if unit == "month":
                    y, mth = divmod(d0.month - 1 + b, 12)
                    buckets.append(f"{d0.year + y}-{mth + 1:02d}-01")
                else:
                    buckets.append(iso_day(d0.timestamp() + b * DAY * (7 if unit == "week" else 1)))
            data = {pid: ([0] * n, [0] * n) for pid in sel}
            for t, tid, pid, src, ms, *_ in plays:
                b = min(max(bucket(t), 0), n - 1)
                data[pid][0][b] += 1
                data[pid][1][b] += ms
            series = [{"pid": pid, "plays": data[pid][0], "ms": data[pid][1]} for pid in sel]

        out = {"kind": lvl.name, "key": key, "title": lvl.title[gid], "sub": lvl.sub[gid], "hours": hours,
               "unit": unit, "buckets": buckets, "series": series, "per": [per[p] for p in sel],
               "top": []}
        if lvl.name == "track":
            tid = gid
            out["album"] = self.album_name[tid]
            out["cover_key"] = self.keys[tid]
            uri = self.uris[tid]
            out["spotify_url"] = f"https://open.spotify.com/track/{uri.split(':')[-1]}" if uri else None
            out["apple_id"] = self.apple_ids[tid]
        else:
            ranked = sorted(top.items(), key=lambda kv: -kv[1][0])
            out["cover_key"] = self.keys[ranked[0][0]] if ranked else self.keys[lvl.members[gid][0]]
            out["n_tracks"] = len(top)
            out["top"] = [{"key": self.keys[tid], "title": self.display[tid][1], "sub": self.display[tid][0],
                           "ms": ms, "plays": n} for tid, (ms, n) in ranked[:12]]
        return out

    # ------------------------------------------------------ compatibility --
    COMPAT_WEIGHTS = {"songs": 0.30, "artists": 0.25, "overlap": 0.20, "top": 0.15, "rhythm": 0.10}

    def _compat(self, lo_ts, hi_ts, sel, by, half_s, ref, minplay_ms, clock):
        """Compatibility per pair of people, from five metrics in [0, 1]."""
        measure = MEASURES.get(by, MEASURES["plays"])
        tracks, _, _ = self.level_agg("track", lo_ts, hi_ts, half_s, ref, minplay_ms)
        artists, _, _ = self.level_agg("artist", lo_ts, hi_ts, half_s, ref, minplay_ms)
        match = {(m["a"], m["b"]): m for m in self.match(lo_ts, hi_ts, sel, by, half_s, ref, minplay_ms)}
        art = self.levels["artist"]

        def values(recs, pid):
            return {g: measure(r[pid]) for g, r in recs.items() if r[pid] and r[pid][PLAYS]}

        out = []
        for i, a in enumerate(sel):
            for b in sel[i + 1:]:
                va, vb = values(tracks, a), values(tracks, b)
                sa, sb = sum(va.values()), sum(vb.values())
                shared = va.keys() & vb.keys()
                # histogram intersection: how much of both people's listening is on shared songs
                overlap = sum(min(va[g] / sa, vb[g] / sb) for g in shared) if sa and sb else 0.0
                top_a = sorted(va, key=va.get, reverse=True)[:20]
                top_b = sorted(vb, key=vb.get, reverse=True)[:20]
                b_played_a = sum(1 for g in top_a if g in vb)        # of A's top 20, how many B played
                a_played_b = sum(1 for g in top_b if g in va)
                top = ((b_played_a / len(top_a)) + (a_played_b / len(top_b))) / 2 if top_a and top_b else 0.0
                rhythm = cosine({h: v for h, v in enumerate(clock[a]) if v},
                                {h: v for h, v in enumerate(clock[b]) if v})
                m = match.get((a, b), {"songs": 0.0, "artists": 0.0})
                metrics = {"songs": m["songs"], "artists": m["artists"], "overlap": overlap, "top": top, "rhythm": rhythm}
                overall = sum(self.COMPAT_WEIGHTS[k] * v for k, v in metrics.items())

                anthem = max(shared, key=lambda g: joint_entropy([va[g], vb[g]], [1, 1]), default=None)
                aa, ab = values(artists, a), values(artists, b)
                shared_art = max(aa.keys() & ab.keys(), key=lambda g: joint_entropy([aa[g], ab[g]], [1, 1]), default=None)
                out.append({
                    "a": a, "b": b, "overall": round(overall, 4),
                    "metrics": {k: round(v, 4) for k, v in metrics.items()},
                    "shared_songs": len(shared),
                    "top_counts": {"b_played_a": b_played_a, "a_top": len(top_a),
                                   "a_played_b": a_played_b, "b_top": len(top_b)},
                    "anthem": {"key": self.keys[anthem], "title": self.display[anthem][1],
                               "sub": self.display[anthem][0]} if anthem is not None else None,
                    "artist": {"key": art.keys[shared_art], "title": art.title[shared_art],
                               "cover_key": self.keys[art.members[shared_art][0]]} if shared_art is not None else None,
                })
        out.sort(key=lambda c: -c["overall"])
        return out

    # ---------------------------------------------------------------- fun --
    # Badges: (id, name, emoji, test on the person's stats, description of the number)
    BADGES = [
        ("demon", "Demon hours regular", "😈", lambda s: s["demon"] >= 0.10,
         lambda s: f"{s['demon']:.0%} of your listening happens between midnight and 3 am"),
        ("night_owl", "Night owl", "🦉", lambda s: s["night"] >= 0.15,
         lambda s: f"{s['night']:.0%} of your listening happens between midnight and 5 am"),
        ("early_bird", "Early bird", "🌅", lambda s: s["morning"] >= 0.2,
         lambda s: f"{s['morning']:.0%} of your listening happens between 5 and 9 am"),
        ("weekend", "Weekend warrior", "🎉", lambda s: s["weekend"] >= 0.4,
         lambda s: f"{s['weekend']:.0%} of your listening happens on weekends (2 days out of 7 would be 29%)"),
        ("office", "Office soundtrack", "💼", lambda s: s["work"] >= 0.5,
         lambda s: f"{s['work']:.0%} of your listening is on weekdays between 9 and 5"),
        ("loyalist", "Loyalist", "💍", lambda s: s["top10"] >= 0.3,
         lambda s: f"Your top 10 songs are {s['top10']:.0%} of everything you played"),
        ("explorer", "Explorer", "🧭", lambda s: s["songs"] >= 1000 or (s["variety"] >= 0.4 and s["plays"] >= 100),
         lambda s: f"{s['songs']:,} different songs in {s['plays']:,} plays"),
        ("superfan", "Superfan", "⭐", lambda s: s["top_artist_share"] >= 0.2,
         lambda s: f"{s['top_artist']} is {s['top_artist_share']:.0%} of your listening"),
        ("repeat", "On repeat", "🔁", lambda s: s["streak"] >= 5,
         lambda s: f"You played {s['streak_song']} {s['streak']} times in a row"),
        ("marathon", "Marathoner", "🏃", lambda s: s["best_day_ms"] >= 8 * 3600000,
         lambda s: f"{s['best_day_ms'] / 3600000:.1f} hours of music on {s['best_day']}"),
        ("skipper", "Restless thumb", "⏭️", lambda s: s["skip_n"] >= 50 and s["skip_rate"] >= 0.25,
         lambda s: f"You skip {s['skip_rate']:.0%} of songs"),
        ("patient", "Hears it out", "🧘", lambda s: s["skip_n"] >= 50 and s["skip_rate"] <= 0.05,
         lambda s: f"You skip only {s['skip_rate']:.0%} of songs"),
    ]

    ERA_UNITS = ("day", "month", "quarter", "half", "year")

    @staticmethod
    def _era_start(day, unit):
        """First day (as a date ordinal) of the era period that a day falls in."""
        d = datetime.fromordinal(day)
        if unit == "day":
            return day
        if unit == "year":
            return d.replace(month=1, day=1).toordinal()
        size = {"month": 1, "quarter": 3, "half": 6}[unit]
        return d.replace(month=(d.month - 1) // size * size + 1, day=1).toordinal()

    def _fun(self, lo_ts, hi_ts, sel, minplay_ms, era="month"):
        """Per person: highlights, badges and the top song of each period ("eras")."""
        era = era if era in self.ERA_UNITS else "month"
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        artist_of = self.levels["artist"].of_track
        art = self.levels["artist"]
        st = {pid: {"ms": 0, "plays": 0, "tracks": Counter(), "artists": Counter(), "night": 0, "demon": 0, "morning": 0,
                    "weekend": 0, "work": 0, "days": Counter(), "day_track": Counter(), "skips": 0, "skip_n": 0,
                    "run": [None, 0], "streak": (0, None)} for pid in sel}
        periods = defaultdict(Counter)                         # (person, first day of period) -> track -> ms
        period_of = {}                                         # day -> first day of its period
        for i in range(lo, hi):
            t, tid, pid, src, ms, skipped, _, _ = self.raw[i]
            if pid not in selset:
                continue
            s = st[pid]
            if skipped is not None:
                s["skip_n"] += 1
                s["skips"] += skipped
            if ms < minplay_ms or not t:
                continue
            s["ms"] += ms
            s["plays"] += 1
            s["tracks"][tid] += ms
            s["artists"][artist_of[tid]] += ms
            h = self.how[i]
            if h != 255:
                hour, wd = h % 24, h // 24
                s["night"] += ms if hour < 5 else 0
                s["demon"] += ms if hour < 3 else 0
                s["morning"] += ms if 5 <= hour < 9 else 0
                s["weekend"] += ms if wd >= 5 else 0
                s["work"] += ms if wd < 5 and 9 <= hour < 17 else 0
            day = self.lday[i]
            if day:
                s["days"][day] += ms
                s["day_track"][(day, tid)] += 1
                start = period_of.get(day)
                if start is None:
                    start = period_of[day] = self._era_start(day, era)
                periods[(pid, start)][tid] += ms
            run = s["run"]
            run[1] = run[1] + 1 if run[0] == tid else 1
            run[0] = tid
            if run[1] > s["streak"][0]:
                s["streak"] = (run[1], tid)

        def song(tid, **extra):
            artist, title = self.display[tid]
            return {"key": self.keys[tid], "title": title, "sub": artist, "album": self.album_name[tid],
                    "cover_key": self.keys[tid], **extra}

        def day_str(o):
            return datetime.fromordinal(o).strftime("%Y-%m-%d")

        people = []
        for pid in sel:
            s = st[pid]
            total = s["ms"] or 1
            top_art = s["artists"].most_common(1)
            best_day = s["days"].most_common(1)
            stats = {
                "plays": s["plays"], "songs": len(s["tracks"]),
                "night": s["night"] / total, "demon": s["demon"] / total, "morning": s["morning"] / total,
                "weekend": s["weekend"] / total, "work": s["work"] / total,
                "top10": sum(v for _, v in s["tracks"].most_common(10)) / total,
                "variety": len(s["tracks"]) / max(s["plays"], 1),
                "top_artist": art.title[top_art[0][0]] if top_art else "",
                "top_artist_share": top_art[0][1] / total if top_art else 0.0,
                "streak": s["streak"][0],
                "streak_song": self.display[s["streak"][1]][1] if s["streak"][1] is not None else "",
                "best_day": (lambda d: f"{d.day} {d:%b %Y}")(datetime.fromordinal(best_day[0][0])) if best_day else "",
                "best_day_ms": best_day[0][1] if best_day else 0,
                "skip_n": s["skip_n"], "skip_rate": s["skips"] / s["skip_n"] if s["skip_n"] else 0.0,
            }
            badges = [{"id": b[0], "name": b[1], "emoji": b[2], "text": b[4](stats)}
                      for b in self.BADGES if s["plays"] and b[3](stats)]
            out = {
                "pid": pid, "ms": s["ms"], "plays": s["plays"], "songs": len(s["tracks"]),
                "artists": len(s["artists"]), "days": len(s["days"]),
                "top_songs": [song(tid, ms=ms) for tid, ms in s["tracks"].most_common(5)],
                "top_artists": [{"key": art.keys[a], "title": art.title[a], "sub": "",
                                 "cover_key": self.keys[max(art.members[a], key=lambda t: s["tracks"].get(t, 0))],
                                 "ms": ms} for a, ms in s["artists"].most_common(5)],
                "badges": badges, "stats": {k: v for k, v in stats.items() if not isinstance(v, str)},
                "best_day": None, "repeat_day": None, "streak": None,
                "eras": [song(periods[k].most_common(1)[0][0], start=day_str(k[1]),
                              ms=periods[k].most_common(1)[0][1])
                         for k in sorted(k for k in periods if k[0] == pid)],
            }
            if best_day:
                d0 = best_day[0][0]
                day_songs = Counter({tid: n for (d, tid), n in s["day_track"].items() if d == d0})
                out["best_day"] = {"date": day_str(d0), "ms": best_day[0][1],
                                   "songs": sum(1 for _ in day_songs),
                                   "top": song(day_songs.most_common(1)[0][0]) if day_songs else None}
            if s["day_track"]:
                (d1, tid), n = s["day_track"].most_common(1)[0]
                out["repeat_day"] = song(tid, date=day_str(d1), plays=n)
            if s["streak"][1] is not None and s["streak"][0] >= 2:
                out["streak"] = song(s["streak"][1], len=s["streak"][0])
            people.append(out)

        return {"people": people, "era": era}

    def music(self, lo_ts, hi_ts, sel, minplay_ms, meta):
        """Genres, decades and song lengths of the listening in a time frame, from the
        music info gathered so far (coverage tells how much of the listening that is)."""
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        info = {}
        P = {pid: {"ms": 0, "known_g": 0, "known_y": 0, "genres": Counter(), "decades": Counter(),
                   "genre_year": defaultdict(Counter), "age_ms": 0.0, "old_ms": 0, "year_ms": 0.0,
                   "years": defaultdict(Counter), "len_n": 0, "len_sum": 0, "full": 0, "full_n": 0,
                   "finished": {}, "tracks": Counter()} for pid in sel}
        for i in range(lo, hi):
            t, tid, pid, src, ms = self.raw[i][:5]
            if pid not in selset or ms < minplay_ms or not t:
                continue
            if tid not in info:
                info[tid] = meta.get(tid) or {}
            m, q = info[tid], P[pid]
            q["ms"] += ms
            q["tracks"][tid] += 1
            play_year = datetime.fromtimestamp(t, timezone.utc).year
            if m.get("genre"):
                q["known_g"] += ms
                q["genres"][m["genre"]] += ms
                q["genre_year"][play_year][m["genre"]] += ms
            y = m.get("year")
            if y and 1900 < y <= play_year + 1:
                q["known_y"] += ms
                q["decades"][y // 10 * 10] += ms
                age = max(play_year - y, 0)
                q["age_ms"] += age * ms
                q["year_ms"] += y * ms
                q["old_ms"] += ms if age >= 10 else 0
                q["years"][y][tid] += 1
            d = m.get("duration_ms")
            if d and d >= 60000:
                q["len_n"] += 1
                q["len_sum"] += d
                q["full_n"] += 1
                if ms >= 0.9 * d:
                    q["full"] += 1
                    if tid not in q["finished"] or q["finished"][tid] < d:
                        q["finished"][tid] = d
        people = []
        for pid in sel:
            q = P[pid]
            tot, ky = q["ms"] or 1, q["known_y"] or 1
            g_tot = q["known_g"] or 1
            genres = [{"genre": g, "share": v / g_tot, "ms": v} for g, v in q["genres"].most_common(12)]
            top_genres = [g["genre"] for g in genres[:6]]
            by_year = []
            for year in sorted(q["genre_year"]):
                c = q["genre_year"][year]
                ysum = sum(c.values()) or 1
                by_year.append({"year": year, "top": c.most_common(1)[0][0],
                                "shares": {g: c[g] / ysum for g in top_genres if c[g]}})
            yrs = sorted(q["years"])
            pick = lambda y: max(q["years"][y].items(), key=lambda kv: kv[1])[0]
            oldest = next((self._song(pick(y), year=y) for y in yrs if sum(q["years"][y].values()) >= 3), None)
            newest = next((self._song(pick(y), year=y) for y in reversed(yrs) if sum(q["years"][y].values()) >= 3), None)
            longest = sorted(q["finished"].items(), key=lambda kv: -kv[1])[:5]
            people.append({
                "pid": pid, "coverage_genre": q["known_g"] / tot, "coverage_year": q["known_y"] / tot,
                "genres": genres, "genre_years": by_year,
                "decades": [{"decade": d, "share": v / ky} for d, v in sorted(q["decades"].items())],
                "avg_year": round(q["year_ms"] / q["known_y"]) if q["known_y"] else None,
                "avg_age": round(q["age_ms"] / q["known_y"], 1) if q["known_y"] else None,
                "old_share": q["old_ms"] / ky if q["known_y"] else None,
                "oldest": oldest, "newest": newest,
                "avg_len_ms": q["len_sum"] / q["len_n"] if q["len_n"] else None,
                "patience": q["full"] / q["full_n"] if q["full_n"] else None, "len_n": q["full_n"],
                "longest_finished": [self._song(tid, duration_ms=d, plays=q["tracks"][tid]) for tid, d in longest],
            })
        return {"people": people, "progress": meta.progress()}

    # ------------------------------------------------------------- albums --
    def album_stats(self, lo_ts, hi_ts, sel, minplay_ms, meta):
        """Album habits per person, and for 2+ people "plot twists": songs and albums whose
        top listener isn't the person who listens to that artist the most."""
        key = (lo_ts, hi_ts, sel, minplay_ms, meta.progress()["looked_up"])
        if getattr(self, "_albums_key", None) == key:
            return self._albums_val
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        alb, art = self.levels["album"], self.levels["artist"]
        # album size: the track count from music info, or at least the different songs anyone played
        size = {}
        for gid, members in enumerate(alb.members):
            known = [((meta.get(t) or {}).get("track_count") or 0) for t in members]
            size[gid] = max(max(known, default=0), len(members))

        def album_item(gid, **extra):
            tid = max(alb.members[gid], key=lambda t: len(self.track_plays[t]))
            return {"key": alb.keys[gid], "title": alb.title[gid], "sub": alb.sub[gid], "cover_key": self.keys[tid],
                    "size": size[gid], **extra}

        people = []
        for pid in sel:
            plays = defaultdict(Counter)                   # album -> track -> plays
            runs = Counter()
            run_album, run_tracks, run_last = None, set(), 0.0
            for i in range(lo, hi):
                t, tid, p, src, ms = self.raw[i][:5]
                if p != pid or ms < minplay_ms or not t:
                    continue
                gid = alb.of_track[tid]
                if gid < 0:
                    run_album = None
                    continue
                plays[gid][tid] += 1
                if gid == run_album and t - run_last <= 1800:
                    run_tracks.add(tid)
                else:
                    if run_album is not None and len(run_tracks) >= max(4, 0.6 * size[run_album]):
                        runs[run_album] += 1
                    run_album, run_tracks = gid, {tid}
                run_last = t
            if run_album is not None and len(run_tracks) >= max(4, 0.6 * size[run_album]):
                runs[run_album] += 1

            whole = [album_item(g, times=n, plays=sum(plays[g].values())) for g, n in runs.most_common(30)]
            complete, one, deep = [], [], []
            for g, c in plays.items():
                n, distinct, top_tid = sum(c.values()), len(c), c.most_common(1)[0][0]
                top_share = c[top_tid] / n
                if size[g] >= 5 and distinct / size[g] >= 0.8 and n >= 10:
                    complete.append((distinct / size[g], n, album_item(g, heard=distinct, plays=n)))
                if n >= 15 and size[g] >= 4 and top_share >= 0.85:
                    artist, title = self.display[top_tid]
                    one.append((n, album_item(g, plays=n, share=round(top_share, 3), song=title, song_key=self.keys[top_tid])))
                if distinct >= 5:
                    ent = -sum((v / n) * math.log(v / n) for v in c.values()) / math.log(distinct)
                    deep.append((distinct * ent, album_item(g, heard=distinct, plays=n, top_share=round(top_share, 3),
                                                            evenness=round(ent, 3))))
            complete.sort(key=lambda x: (-x[0], -x[1]))
            one.sort(key=lambda x: -x[0])
            deep.sort(key=lambda x: -x[0])
            people.append({"pid": pid, "whole": whole, "complete": [x[2] for x in complete[:30]],
                           "one_song": [x[1] for x in one[:30]], "deep": [x[1] for x in deep[:30]],
                           "albums": len(plays)})

        twists = {"songs": [], "albums": []}
        if len(sel) > 1:
            artists, _, _ = self.level_agg("artist", lo_ts, hi_ts, 0.0, 0.0, minplay_ms)
            fans = {}
            for gid, recs in artists.items():
                v = [recs[p][PLAYS] if recs[p] else 0 for p in sel]
                tot = sum(v)
                if tot >= 30:
                    j = max(range(len(sel)), key=lambda k: v[k])
                    # a real fan: most of the artist's plays, and plenty of them
                    if v[j] / tot >= 0.6 and v[j] >= 10:
                        fans[gid] = (sel[j], v[j] / tot, v)
            for level, out in (("track", "songs"), ("album", "albums")):
                recs_by, _, _ = self.level_agg(level, lo_ts, hi_ts, 0.0, 0.0, minplay_ms)
                lvl = self.levels[level]
                found = []
                for gid, recs in recs_by.items():
                    tid = gid if level == "track" else lvl.members[gid][0]
                    a = art.of_track[tid]
                    if a not in fans:
                        continue
                    fan, fan_share, art_v = fans[a]
                    v = [recs[p][PLAYS] if recs[p] else 0 for p in sel]
                    tot = sum(v)
                    if tot < (10 if level == "track" else 20):
                        continue
                    j = max(range(len(sel)), key=lambda k: v[k])
                    if sel[j] == fan or v[j] / tot < 0.6 or v[j] < (5 if level == "track" else 8):
                        continue
                    fan_here = v[sel.index(fan)] / tot
                    surprise = fan_share - fan_here
                    item = (self._song(gid) if level == "track" else album_item(gid))
                    item.update({"artist": art.title[a], "fan": fan, "fan_share": round(fan_share, 3),
                                 "winner": sel[j], "plays": v, "artist_plays": art_v})
                    # twists where the fan did play it (just less) beat "never played it at all"
                    found.append((surprise * math.log1p(tot) * (1.0 if fan_here > 0 else 0.6), item))
                found.sort(key=lambda x: -x[0])
                twists[out] = [x[1] for x in found[:40]]
        self._albums_key, self._albums_val = key, {"people": people, "twists": twists}
        return self._albums_val

    # -------------------------------------------------------- more angles --
    XMAS = re.compile(r"christmas|xmas|santa|jingle|sleigh|mistletoe|rudolph|navidad|weihnacht|craciun|crăciun|"
                      r"noel|noël|feliz navidad|holly jolly|let it snow|silent night|o holy night|frosty|"
                      r"boże narodzenie|wesołych świąt|colinde|last christmas", re.I)
    SEASONS = (("winter", "Winter", "❄️"), ("spring", "Spring", "🌱"), ("summer", "Summer", "☀️"), ("autumn", "Autumn", "🍂"))

    def _signature(self, counts, totals, bucket_n, all_n, min_n=3, own_min=0.2, lift_min=1.5, limit=30):
        """Songs played unusually often in a bucket. counts: track -> plays in bucket,
        totals: track -> all plays, bucket_n / all_n: the person's plays in the bucket / overall."""
        share = bucket_n / all_n if all_n else 0.0
        out = []
        for tid, n_b in counts.items():
            n = totals[tid]
            own = n_b / n
            lift = own / share if share else 0.0
            if n_b >= min_n and own >= own_min and lift >= lift_min:
                out.append((n_b * min(lift, 6.0), tid, n_b, n, own))
        out.sort(reverse=True)
        return [self._song(tid, plays_here=n_b, plays=n, own=round(own, 3)) for _, tid, n_b, n, own in out[:limit]]

    def _song(self, tid, **extra):
        artist, title = self.display[tid]
        return {"key": self.keys[tid], "title": title, "sub": artist, "album": self.album_name[tid],
                "cover_key": self.keys[tid], **extra}

    def _more(self, lo_ts, hi_ts, sel, minplay_ms):
        """Sessions, seasons, weekdays, Christmas, chosen vs served, devices, trips,
        love-hate songs (in the time frame) and milestones (whole history)."""
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        artist_of = self.levels["artist"].of_track
        art = self.levels["artist"]
        P = {pid: {"idx": [], "totals": Counter(), "season": [Counter() for _ in range(4)],
                   "wday": [Counter() for _ in range(7)], "friday": Counter(), "modes": Counter(),
                   "mode_tracks": defaultdict(Counter), "devices": Counter(), "dev_tracks": defaultdict(Counter),
                   "places": defaultdict(lambda: [0, 0, math.inf, 0.0, Counter(), set()]),
                   "skips": Counter(), "skip_n": Counter(), "months": defaultdict(set), "xmas": defaultdict(list)}
             for pid in sel}
        month_of = {}
        for i in range(lo, hi):
            t, tid, pid, src, ms, skipped, place, _ = self.raw[i]
            if pid not in selset or not t:
                continue
            q = P[pid]
            if skipped is not None:
                q["skip_n"][tid] += 1
                q["skips"][tid] += skipped
            if ms < minplay_ms:
                continue
            q["idx"].append(i)
            q["totals"][tid] += 1
            day = self.lday[i]
            mo = month_of.get(day)
            if mo is None:
                d = datetime.fromordinal(day) if day else datetime.fromtimestamp(t, timezone.utc)
                mo = month_of[day] = (d.year, d.month)
            q["months"][tid].add(mo)
            q["season"][(mo[1] % 12) // 3][tid] += 1
            h = self.how[i]
            if h != 255:
                wd, hour = h // 24, h % 24
                q["wday"][wd][tid] += 1
                if (wd == 4 and hour >= 18) or (wd == 5 and hour < 4):
                    q["friday"][tid] += 1
            mode, device = self.extra[i]
            if mode:
                q["modes"][mode] += ms
                q["mode_tracks"][mode][tid] += 1
            if device:
                q["devices"][device] += ms
                q["dev_tracks"][device][tid] += 1
            if place:
                pl = q["places"][place]
                pl[0] += ms
                pl[1] += 1
                pl[2] = min(pl[2], t)
                pl[3] = max(pl[3], t)
                pl[4][tid] += ms
                pl[5].add(day)
            title, album = self.display[tid][1], self.album_name[tid] or ""
            if self.XMAS.search(title) or self.XMAS.search(album):
                q["xmas"][mo[0]].append((t, tid))

        people = []
        for pid in sel:
            q = P[pid]
            idx, totals = q["idx"], q["totals"]
            all_n = len(idx)
            out = {"pid": pid, "plays": all_n}

            # sessions: a gap of 30+ minutes starts a new one
            sessions, cur = [], None
            for i in idx:
                t, tid, ms = self.raw[i][0], self.raw[i][1], self.raw[i][4]
                if cur and t - cur["end"] <= 1800:
                    cur["end"] = t
                    cur["n"] += 1
                    cur["ms"] += ms
                    cur["last"] = tid
                    cur["tracks"][tid] += 1
                else:
                    cur = {"start": t, "end": t, "n": 1, "ms": ms, "first": tid, "last": tid, "tracks": Counter({tid: 1})}
                    sessions.append(cur)
            multi = [x for x in sessions if x["n"] >= 2]
            openers = Counter(x["first"] for x in multi)
            closers = Counter(x["last"] for x in multi)
            longest = max(sessions, key=lambda x: x["ms"], default=None)
            lengths = sorted(x["ms"] for x in sessions)
            out["sessions"] = {
                "count": len(sessions), "median_ms": lengths[len(lengths) // 2] if lengths else 0,
                "avg_songs": round(all_n / len(sessions), 1) if sessions else 0,
                "openers": [self._song(tid, times=n, of=len(multi)) for tid, n in openers.most_common(30) if n >= 2],
                "closers": [self._song(tid, times=n, of=len(multi)) for tid, n in closers.most_common(30) if n >= 2],
                "longest": {"start": iso_day(longest["start"]), "start_ts": longest["start"], "end_ts": longest["end"],
                            "ms": longest["ms"], "songs": longest["n"],
                            "top": self._song(longest["tracks"].most_common(1)[0][0])} if longest else None,
            }

            # seasons and weekdays: share, top artist, signature songs
            def buckets(counters, names):
                res = []
                for c, (bid, name, emoji) in zip(counters, names):
                    n_b = sum(c.values())
                    top_art = Counter()
                    for tid, n in c.items():
                        top_art[artist_of[tid]] += n
                    a = top_art.most_common(1)
                    res.append({"id": bid, "name": name, "emoji": emoji, "plays": n_b,
                                "share": n_b / all_n if all_n else 0.0, "artist": art.title[a[0][0]] if a else None,
                                "signature": self._signature(c, totals, n_b, all_n),
                                "top": [self._song(tid, plays_here=n) for tid, n in c.most_common(20)]})
                return res
            out["seasons"] = buckets(q["season"], self.SEASONS)
            days = [(d.lower(), d, e) for d, e in zip(("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                                                        "Saturday", "Sunday"), ("😩", "🌀", "🐪", "⏳", "🎉", "🛋️", "☁️"))]
            out["weekdays"] = buckets(q["wday"], days)
            fri_n = sum(q["friday"].values())
            fri = self._signature(q["friday"], totals, fri_n, all_n, min_n=2, own_min=0.15, lift_min=1.3, limit=30)
            out["friday"] = fri or [self._song(tid, plays_here=n) for tid, n in q["friday"].most_common(10)]

            # Christmas: when it starts each year
            xm = []
            for year, plays in sorted(q["xmas"].items()):
                autumn = [p for p in plays if datetime.fromtimestamp(p[0], timezone.utc).month >= 9]
                if not autumn:
                    continue
                c = Counter(tid for _, tid in plays)
                xm.append({"year": year, "first": iso_day(min(p[0] for p in autumn)), "plays": len(plays),
                           "top": self._song(c.most_common(1)[0][0])})
            out["christmas"] = xm

            # chosen vs served
            mode_ms = sum(q["modes"].values())
            picked, served = q["mode_tracks"]["picked"], Counter()
            for m in ("shuffle", "autoplay", "flow"):
                served.update(q["mode_tracks"][m])
            out["modes"] = {
                "share": {m: q["modes"][m] / mode_ms for m in MODES} if mode_ms else {},
                "known": mode_ms, "has_picked": bool(picked),
                "picked": [self._song(tid, plays_here=n, plays=totals[tid], own=round(n / totals[tid], 3))
                           for tid, n in picked.most_common(200) if n >= 3 and n / totals[tid] >= 0.5][:30],
                "served": [self._song(tid, plays_here=n, plays=totals[tid], own=round(n / totals[tid], 3))
                           for tid, n in served.most_common(300)
                           if n >= 3 and n / totals[tid] >= 0.8 and picked[tid] == 0][:30],
            }

            # devices
            dev_ms = sum(q["devices"].values())
            out["devices"] = [{"id": d, "share": q["devices"][d] / dev_ms, "ms": q["devices"][d],
                               "signature": self._signature(q["dev_tracks"][d], totals, sum(q["dev_tracks"][d].values()),
                                                            all_n, limit=20) if len(q["devices"]) > 1 else [],
                               "top": [self._song(tid, plays_here=n) for tid, n in q["dev_tracks"][d].most_common(10)]}
                              for d in DEVICES if q["devices"][d]] if dev_ms else []

            # places (the page decides which one is home, after merging country codes and names)
            out["places"] = sorted(({"place": pl, "ms": v[0], "plays": v[1], "first": iso_day(v[2]), "last": iso_day(v[3]),
                                     "days": len(v[5]), "top": [self._song(tid, ms=ms) for tid, ms in v[4].most_common(5)]}
                                    for pl, v in q["places"].items()), key=lambda x: -x["ms"])[:15]

            # love-hate: skipped a lot, played anyway, across months
            lh = []
            for tid, n_skip in q["skip_n"].items():
                rate = q["skips"][tid] / n_skip
                if n_skip >= 10 and rate >= 0.35 and totals[tid] >= 5 and len(q["months"][tid]) >= 2:
                    lh.append((q["skips"][tid] * totals[tid], self._song(tid, skips=q["skips"][tid], skip_n=n_skip,
                                                                      rate=round(rate, 3), plays=totals[tid],
                                                                      months=len(q["months"][tid]))))
            lh.sort(key=lambda x: x[0], reverse=True)
            out["lovehate"] = [x for _, x in lh[:30]]
            people.append(out)

        # milestones over the whole history
        marks_n = (1, 100, 1000, 10000, 50000, 100000, 250000, 500000)
        marks_h = (1, 10, 100, 500, 1000, 2500, 5000, 10000)
        for person in people:
            pid, n, total, ms_list, hi_i, todo_h = person["pid"], 0, 0, [], 0, list(marks_h)
            for i, p in enumerate(self.raw):
                if p[2] != pid or not p[0] or p[4] < minplay_ms:
                    continue
                n += 1
                total += p[4]
                if hi_i < len(marks_n) and n == marks_n[hi_i]:
                    ms_list.append({"kind": "play", "n": n, "date": iso_day(p[0]), "song": self._song(p[1])})
                    hi_i += 1
                while todo_h and total >= todo_h[0] * 3600000:
                    ms_list.append({"kind": "hour", "n": todo_h.pop(0), "date": iso_day(p[0]), "song": self._song(p[1])})
            person["milestones"] = sorted(ms_list, key=lambda m: (m["date"], m["kind"] == "hour"))
        return {"people": people, "modes": MODES, "devices": DEVICES}

    # ----------------------------------------------------- around the clock --
    def _clock(self, lo_ts, hi_ts, sel, minplay_ms):
        """Per person: listening per hour of the day, and for each 3-hour block its share,
        top artist and "signature" songs: ones played unusually often in that block."""
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        artist_of = self.levels["artist"].of_track
        hours = {pid: [0] * 24 for pid in sel}
        blocks = {pid: [0] * 8 for pid in sel}                       # plays per block
        songs = {pid: defaultdict(lambda: [0] * 9) for pid in sel}   # track -> plays per block + total
        artists = {pid: [Counter() for _ in range(8)] for pid in sel}
        for i in range(lo, hi):
            p = self.raw[i]
            pid, ms, h = p[2], p[4], self.how[i]
            if pid not in selset or ms < minplay_ms or h == 255:
                continue
            hour = h % 24
            b = hour // 3
            hours[pid][hour] += ms
            blocks[pid][b] += 1
            rec = songs[pid][p[1]]
            rec[b] += 1
            rec[8] += 1
            artists[pid][b][artist_of[p[1]]] += ms
        art = self.levels["artist"]

        def song(tid, **extra):
            artist, title = self.display[tid]
            return {"key": self.keys[tid], "title": title, "sub": artist, "album": self.album_name[tid],
                    "cover_key": self.keys[tid], **extra}

        people = []
        for pid in sel:
            total = sum(blocks[pid]) or 1
            parts = []
            for b, (part_id, name, emoji) in enumerate(DAYPARTS):
                share = blocks[pid][b] / total
                sig, top = [], []
                for tid, rec in songs[pid].items():
                    n_b, n = rec[b], rec[8]
                    if not n_b:
                        continue
                    top.append((n_b, tid))
                    own = n_b / n                                  # how much of this song's plays are in this block
                    lift = own / share if share else 0.0
                    if n_b >= 3 and own >= 0.2 and lift >= 1.5:
                        sig.append((n_b * min(lift, 6.0), tid, n_b, n, own))
                sig.sort(reverse=True)
                top.sort(reverse=True)
                a = artists[pid][b].most_common(1)
                parts.append({
                    "id": part_id, "share": share, "plays": blocks[pid][b],
                    "artist": art.title[a[0][0]] if a else None,
                    "signature": [song(tid, plays_here=n_b, plays=n, own=round(own, 3)) for _, tid, n_b, n, own in sig[:30]],
                    "top": [song(tid, plays_here=n_b) for n_b, tid in top[:20]],
                })
            people.append({"pid": pid, "hours": hours[pid], "plays": sum(blocks[pid]), "parts": parts})
        return {"people": people, "dayparts": [{"id": i, "name": n, "emoji": e, "from": 3 * k, "to": 3 * k + 3}
                                               for k, (i, n, e) in enumerate(DAYPARTS)]}

    # --------------------------------------------------------- time travel --
    def _time(self, lo_ts, hi_ts, sel, minplay_ms, today):
        """How songs move through time: comebacks, ever-present songs, flings, slow
        burners, on this day (all history) and, for pairs, who found a song first."""
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        plays = {pid: defaultdict(list) for pid in sel}        # pid -> track -> [raw index], in time order
        for i in range(lo, hi):
            t, tid, pid, src, ms = self.raw[i][:5]
            if pid in selset and t and ms >= minplay_ms:
                plays[pid][tid].append(i)
        ts, lday = self.ts, self.lday
        month_of = {}

        def month(i):                                          # local month index: year * 12 + month - 1
            d = lday[i]
            m = month_of.get(d)
            if m is None:
                dt = datetime.fromordinal(d) if d else datetime.fromtimestamp(ts[i], timezone.utc)
                m = month_of[d] = dt.year * 12 + dt.month - 1
            return m

        def song(tid, **extra):
            artist, title = self.display[tid]
            return {"key": self.keys[tid], "title": title, "sub": artist, "album": self.album_name[tid],
                    "cover_key": self.keys[tid], **extra}

        def mstr(m):
            return f"{m // 12}-{m % 12 + 1:02d}"

        people = []
        for pid in sel:
            mine = plays[pid]
            last_any = max((ts[idx[-1]] for idx in mine.values()), default=0.0)
            comebacks, steady, flings, slow = [], [], [], []
            for tid, idx in mine.items():
                n = len(idx)
                if n < 4:
                    continue
                t = [ts[i] for i in idx]
                # comeback: the longest silence with at least 2 plays on each side
                if n >= 4:
                    k = max(range(1, n - 2), key=lambda j: t[j + 1] - t[j], default=None)
                    if k is not None:
                        gap = (t[k + 1] - t[k]) / DAY
                        if gap >= 60:
                            comebacks.append((gap, song(tid, gap_days=round(gap), left=iso_day(t[k]),
                                                        back=iso_day(t[k + 1]), before=k + 1, after=n - k - 1)))
                months = Counter(month(i) for i in idx)
                if n >= 5:
                    first_m, last_m = min(months), max(months)
                    steady.append(((len(months), n), song(tid, months=len(months), span=last_m - first_m + 1,
                                                          first=iso_day(t[0]), last=iso_day(t[-1]), plays=n)))
                # fling: at least 10 plays, 80%+ of them within 30 days, then silent for 6+ months
                if n >= 10 and last_any - t[-1] >= 180 * DAY:
                    best, start, j = 0, 0, 0
                    for a in range(n):
                        while t[a] - t[j] > 30 * DAY:
                            j += 1
                        if a - j + 1 > best:
                            best, start = a - j + 1, j
                    if best >= 0.8 * n:
                        flings.append((best, song(tid, window=best, plays=n, start=iso_day(t[start]),
                                                  last=iso_day(t[-1]))))
                # slow burner: the busiest month came 6+ months after the first play, and
                # stands out (3x the song's average month), so steady favorites don't count
                peak_m, peak_n = max(months.items(), key=lambda kv: (kv[1], -kv[0]))
                delay = peak_m - month(idx[0])
                life = max(months) - min(months) + 1
                if peak_n >= 8 and delay >= 6 and peak_n >= 3 * n / life:
                    slow.append((delay, song(tid, delay_months=delay, first=iso_day(t[0]), peak=mstr(peak_m),
                                             peak_plays=peak_n, plays=n)))
            top = lambda xs: [x for _, x in sorted(xs, key=lambda kv: kv[0], reverse=True)[:40]]
            people.append({"pid": pid, "comebacks": top(comebacks), "steady": top(steady),
                           "flings": top(flings), "slow": top(slow), "on_this_day": []})

        # on this day: today's date in earlier years, over the whole history
        td = datetime.fromordinal(today)
        days = set()
        first_year = datetime.fromtimestamp(self.ts[bisect.bisect_right(self.ts, 0.0)], timezone.utc).year \
            if self.ts and self.ts[-1] else td.year
        for y in range(first_year, td.year):
            try:
                days.add(td.replace(year=y).toordinal())
            except ValueError:                             # 29 Feb in a non-leap year
                pass
        otd = {pid: defaultdict(lambda: [0, 0, Counter()]) for pid in sel}
        if days:
            for i, p in enumerate(self.raw):
                if p[2] in selset and lday[i] in days and p[4] >= minplay_ms:
                    rec = otd[p[2]][lday[i]]
                    rec[0] += p[4]
                    rec[1] += 1
                    rec[2][p[1]] += p[4]
        for person in people:
            person["on_this_day"] = [
                {"date": datetime.fromordinal(d).strftime("%Y-%m-%d"), "ms": ms, "plays": n, "songs": len(c),
                 "top": song(c.most_common(1)[0][0])}
                for d, (ms, n, c) in sorted(otd[person["pid"]].items(), reverse=True)]

        # who found it first: shared songs, only when both people's histories had already started
        found = []
        for a_i, a in enumerate(sel):
            for b in sel[a_i + 1:]:
                pa, pb = plays[a], plays[b]
                start = max(ts[min(idx[0] for idx in pa.values())] if pa else 0,
                            ts[min(idx[0] for idx in pb.values())] if pb else 0)
                wins, rows = Counter(), []
                for tid in pa.keys() & pb.keys():
                    fa, fb = ts[pa[tid][0]], ts[pb[tid][0]]
                    if min(fa, fb) < start + 30 * DAY:             # one of you may have known it before your data starts
                        continue
                    lead = abs(fa - fb) / DAY
                    if lead < 1:
                        wins["tie"] += 1
                        continue
                    first, second = (a, b) if fa < fb else (b, a)
                    wins[first] += 1
                    both = min(len(pa[tid]), len(pb[tid]))
                    if both >= 3:
                        rows.append((both, song(tid, first=first, second=second, lead_days=round(lead),
                                                found=iso_day(min(fa, fb)), followed=iso_day(max(fa, fb)),
                                                plays=[len(pa[tid]), len(pb[tid])])))
                rows.sort(key=lambda kv: kv[0], reverse=True)
                found.append({"a": a, "b": b, "wins": {str(k): v for k, v in wins.items()},
                              "since": iso_day(start + 30 * DAY), "songs": [x for _, x in rows[:40]]})
        return {"people": people, "found": found, "today": td.strftime("%Y-%m-%d")}

    # ----------------------------------------------------------- insights --
    def _insights(self, lo_ts, hi_ts, sel, by, half_s, ref, minplay_ms):
        lo, hi = self._span(lo_ts, hi_ts)
        selset = set(sel)
        artist_of = self.levels["artist"].of_track
        clock = {pid: [0] * 168 for pid in sel}
        places = defaultdict(lambda: [0, 0, Counter()])
        best_song = {pid: {} for pid in sel}            # pid -> {tid: (len, start, end, ms)}
        best_art = {pid: {} for pid in sel}
        cur = {pid: [None, 0, 0.0, 0.0, 0, None, 0, 0.0, 0.0, 0] for pid in sel}
        # cur: [tid, len, start, end, ms, artist, alen, astart, aend, ams]

        def close(table, key, length, start, end, ms):
            if key is None or length < 2:
                return
            old = table.get(key)
            if not old or length > old[0]:
                table[key] = (length, start, end, ms)

        for i in range(lo, hi):
            t, tid, pid, src, ms, _, place, _ = self.raw[i]
            if pid not in selset or ms < minplay_ms:
                continue
            h = self.how[i]
            if h != 255:
                clock[pid][h] += ms
            if place:
                pl = places[place]
                pl[0] += ms
                pl[1] += 1
                pl[2][tid] += ms
            c = cur[pid]
            if tid == c[0]:
                c[1] += 1
                c[3] = t
                c[4] += ms
            else:
                close(best_song[pid], c[0], c[1], c[2], c[3], c[4])
                c[0:5] = [tid, 1, t, t, ms]
            aid = artist_of[tid]
            if aid == c[5]:
                c[6] += 1
                c[8] = t
                c[9] += ms
            else:
                close(best_art[pid], c[5], c[6], c[7], c[8], c[9])
                c[5:10] = [aid, 1, t, t, ms]
        for pid in sel:
            c = cur[pid]
            close(best_song[pid], c[0], c[1], c[2], c[3], c[4])
            close(best_art[pid], c[5], c[6], c[7], c[8], c[9])

        art = self.levels["artist"]

        def fmt_streaks(table, is_artist):
            top = sorted(table.items(), key=lambda kv: (-kv[1][0], -kv[1][3]))[:8]
            out = []
            for key, (length, start, end, ms) in top:
                if is_artist:
                    out.append({"key": art.keys[key], "title": art.title[key], "sub": "",
                                "cover_key": self.keys[art.members[key][0]],
                                "len": length, "start": iso_day(start), "end": iso_day(end), "ms": ms,
                                "start_ts": start, "end_ts": end})
                else:
                    out.append({"key": self.keys[key], "title": self.display[key][1], "sub": self.display[key][0],
                                "cover_key": self.keys[key],
                                "len": length, "start": iso_day(start), "end": iso_day(end), "ms": ms,
                                "start_ts": start, "end_ts": end})
            return out

        top_places = sorted(places.items(), key=lambda kv: -kv[1][0])[:12]
        return {
            "match": self.match(lo_ts, hi_ts, sel, by, half_s, ref, minplay_ms) if len(sel) > 1 else [],
            "compat": self._compat(lo_ts, hi_ts, sel, by, half_s, ref, minplay_ms, clock) if len(sel) > 1 else [],
            "compat_weights": self.COMPAT_WEIGHTS,
            "clock": [{"pid": pid, "ms": clock[pid]} for pid in sel],
            "places": [{"place": pl, "ms": v[0], "plays": v[1],
                        "top": {"title": self.display[v[2].most_common(1)[0][0]][1],
                                "sub": self.display[v[2].most_common(1)[0][0]][0]}}
                       for pl, v in top_places],
            "streaks": [{"pid": pid, "songs": fmt_streaks(best_song[pid], False),
                         "artists": fmt_streaks(best_art[pid], True)} for pid in sel],
        }

    def meta(self):
        dated = self.ts[bisect.bisect_right(self.ts, 0.0):]
        years = []
        if dated:
            y0 = datetime.fromtimestamp(dated[0], timezone.utc).year
            y1 = datetime.fromtimestamp(dated[-1], timezone.utc).year
            for y in range(y0, y1 + 1):
                a = datetime(y, 1, 1, tzinfo=timezone.utc).timestamp()
                b = datetime(y + 1, 1, 1, tzinfo=timezone.utc).timestamp()
                if bisect.bisect_left(dated, b) > bisect.bisect_left(dated, a):
                    years.append(y)
        return {
            "first": iso_day(dated[0]) if dated else None,
            "last": iso_day(dated[-1]) if dated else None,
            "years": years,
            "sources": [SOURCES[i] for i in sorted({p[3] for p in self.all_raw})],
            "hidden": [{"key": k, "title": self.credit_title[k[2:]]} for k in self.hidden],
            "only": [{"key": k, "title": self.credit_title[k[2:]]} for k in self.only],
            "hidden_tracks": self.hidden_tracks,
            "people": [{k: v for k, v in ps.items() if k != "last_ts"} for ps in self.person_stats],
            "tracks": len(self.keys),
            "artists": len(self.levels["artist"].keys),
            "albums": len(self.levels["album"].keys),
            "plays": len(self.raw),
            "undated_plays": self.undated,
        }


# How a play started: picked (you chose it), flow (next on the album/playlist/queue),
# shuffle, or autoplay (radio, autoplay after the queue ran out)
MODES = ("picked", "flow", "shuffle", "autoplay")
DEVICES = ("phone", "computer", "tv")                  # tv = TVs, consoles, speakers, cars


def device_kind(s):
    s = (s or "").lower()
    if not s:
        return None
    if any(w in s for w in ("cast", "sonos", "partner", "_tv", " tv", "tv ", "playstation", "xbox", "console",
                            "tesla", "android_auto", "carplay", "alexa", "echo", "speaker", "homepod", "roku")):
        return "tv"                                    # checked first: "android_tv" or a console on Linux
    if any(w in s for w in ("android", "ios", "iphone", "ipad", "phone")):
        return "phone"
    if any(w in s for w in ("windows", "os x", "osx", "mac", "linux", "web", "desktop", "chrome", "firefox")):
        return "computer"
    return None


# ----------------------------------------------------------------- loading --
#
# Everything is read through "entries": plain files, given directly or found in
# folders (searched recursively). Each export is recognized by its file name
# and CSV header, so a person's paths can be any mix of Spotify, Tidal and
# Apple Music exports.

class Entry:
    def __init__(self, path):
        self.label = path                              # shown in messages
        self.base = os.path.basename(path).lower()

    def open(self):
        return open(self.label, "rb")

    def text(self):
        return io.TextIOWrapper(self.open(), encoding="utf-8-sig", newline="")

    def header(self):
        try:
            with self.text() as fh:
                return next(csv.reader(fh), [])
        except (OSError, UnicodeDecodeError, csv.Error):
            return []


def iter_entries(paths):
    for p in paths:
        for path in sorted(glob.glob(p)) or [p]:
            if os.path.isdir(path):
                files = []
                for root, _, names in os.walk(path):
                    files += [os.path.join(root, n) for n in names]
            else:
                files = [path]
            for f in sorted(files):
                if not os.path.isfile(f):
                    print(f"  ! not found: {f}", file=sys.stderr)
                elif f.lower().endswith((".zip", ".tar.gz", ".tgz", ".tar")):
                    print(f"  ! skipping archive {f}: unzip it first", file=sys.stderr)
                else:
                    yield Entry(f)


APPLE_LIBRARY = "apple music library tracks.json"
APPLE_DAILY = "apple music - play history daily tracks.csv"


def classify(entries):
    """Sort entries into the exports we understand; everything else is ignored."""
    found = {"spotify": [], "tidal": [], "apple": [], "apple_library": [], "apple_daily": []}
    for e in entries:
        if e.base == APPLE_LIBRARY:
            found["apple_library"].append(e)
        elif e.base.endswith(".json"):
            found["spotify"].append(e)
        elif e.base == APPLE_DAILY:
            found["apple_daily"].append(e)
        elif e.base.endswith(".csv"):
            head = e.header()
            if "artist_name" in head and "track_title" in head:
                found["tidal"].append(e)
            elif "Song Name" in head and "Event Type" in head:
                found["apple"].append(e)
    return found


def load_person(paths, lib, pid):
    found = classify(iter_entries(paths))
    if found["spotify"]:
        load_spotify(found["spotify"], lib, pid)
    if found["tidal"]:
        load_tidal(found["tidal"], lib, pid)
    if found["apple"]:
        load_apple(found["apple"], found["apple_library"], found["apple_daily"], lib, pid)
    if not (found["spotify"] or found["tidal"] or found["apple"]):
        print("  ! no Spotify, Tidal or Apple Music history found in these paths", file=sys.stderr)


def load_spotify(entries, lib, pid):
    n, used = 0, 0
    for f in entries:
        try:
            with f.open() as fh:
                data = json.loads(fh.read().decode("utf-8-sig"))
        except (OSError, ValueError) as e:
            print(f"  ! skipping {f.label}: {e}", file=sys.stderr)
            continue
        if not isinstance(data, list):
            continue
        before = n
        for e in data:
            if not isinstance(e, dict):
                continue
            artist = e.get("master_metadata_album_artist_name")
            title = e.get("master_metadata_track_name")
            ms, ts = e.get("ms_played"), e.get("ts")
            skipped = None
            if title is not None:
                skipped = 1 if (e.get("skipped") is True or e.get("reason_end") == "fwdbtn") else 0
            elif "trackName" in e:                     # older, basic export format (no skip info)
                artist, title = e.get("artistName"), e.get("trackName")
                ms, ts = e.get("msPlayed"), e.get("endTime")
            if not artist or not title:
                continue                               # podcasts, audiobooks, video
            country = e.get("conn_country")
            start = e.get("reason_start")
            mode = ("picked" if start in ("clickrow", "playbtn", "backbtn") else
                    "shuffle" if e.get("shuffle") else
                    "flow" if start in ("trackdone", "fwdbtn", "appload", "remote", "trackerror") else None)
            lib.add(pid, ts, artist, title, int(ms or 0), SPOTIFY,
                    e.get("spotify_track_uri"), e.get("master_metadata_album_album_name"),
                    skipped, f"c:{country}" if country and country != "ZZ" else None,
                    mode=mode, device=device_kind(e.get("platform")))
            n += 1
        used += n > before
    if n:                                              # other exports (e.g. Apple's library) are .json too
        print(f"  Spotify: {n:,} plays from {used} file(s)")


def load_tidal(entries, lib, pid):
    n = 0
    for f in entries:
        with f.text() as fh:
            for row in csv.DictReader(fh):
                artist, title = row.get("artist_name"), row.get("track_title")
                if not artist or not title:
                    continue
                try:
                    ms = int(float(row.get("stream_duration_ms") or 0))
                except ValueError:
                    ms = 0
                country = (row.get("country_name") or "").strip()
                lib.add(pid, row.get("entry_date"), artist, title, ms, TIDAL,
                        place=f"n:{country}" if country else None,
                        tzname=(row.get("time_zone") or "").strip() or None,
                        device=device_kind(row.get("client_name_from_session") or row.get("product_type")))
                n += 1
    print(f"  Tidal:   {n:,} plays from {len(entries)} file(s)")


# -- Apple Music
#
# "Apple Music Play Activity.csv" logs PLAY_START / PLAY_END events, and only
# PLAY_END carries how long you listened. It has no artist column, so the
# artist comes from "Apple Music Library Tracks.json" (unzip it from the
# export's "Apple Music Library Tracks.json.zip"), then from "Apple Music -
# Play History Daily Tracks.csv" (whose descriptions read "Artist - Song"),
# then from apple_artists.csv, a file you can fill in yourself for whatever is
# still missing.

APPLE_CONTINUES = {"PLAYBACK_MANUALLY_PAUSED", "SCRUB_BEGIN", "PLAYBACK_SUSPENDED"}
APPLE_SKIPS = {"TRACK_SKIPPED_FORWARDS", "MANUALLY_SELECTED_PLAYBACK_OF_A_DIFF_ITEM"}
APPLE_OVERRIDES = "apple_artists.csv"
APPLE_MISSING = "apple_missing_artists_{}.csv"      # per person


def _k(s):
    return _base_norm(s)


class AppleArtists:
    """Finds the artist of an Apple Music play from its song and album name."""

    def __init__(self, library, daily):
        self.by_song_album = defaultdict(Counter)      # (song, album) -> artists
        self.by_song = defaultdict(Counter)            # song -> artists
        self.by_album = defaultdict(Counter)           # album -> artists
        self.daily = defaultdict(Counter)              # song -> artists (weighted by plays)
        self.ids = {}                                  # (song, album) or song -> Apple Music track id
        self.meta = {}                                 # (song, album) -> genre, year, duration from the library
        self.overrides = {}
        for f in library:
            try:
                with f.open() as fh:
                    tracks = json.loads(fh.read().decode("utf-8-sig"))
            except (OSError, ValueError) as e:
                print(f"  ! skipping {f.label}: {e}", file=sys.stderr)
                continue
            for t in tracks if isinstance(tracks, list) else []:
                title, artist, album = t.get("Title"), t.get("Artist"), t.get("Album")
                if not title or not artist:
                    continue
                self.by_song_album[(_k(title), _k(album))][artist] += 1
                self.by_song[_k(title)][artist] += 1
                if album:
                    self.by_album[_k(album)][t.get("Album Artist") or artist] += 1
                aid = t.get("Apple Music Track Identifier")
                if aid:
                    self.ids.setdefault((_k(title), _k(album)), str(aid))
                year = t.get("Track Year") or str(t.get("Release Date") or "")[:4]
                try:
                    year = int(year) if year else None
                except ValueError:
                    year = None
                dur = t.get("Track Duration")
                count, number = t.get("Track Count On Album"), t.get("Track Number On Album")
                self.meta.setdefault((_k(title), _k(album)), {
                    "genre": t.get("Genre") or None, "year": year,
                    "duration_ms": int(dur) if isinstance(dur, (int, float)) and dur > 0 else None,
                    "track_count": count if isinstance(count, int) and count > 0 else None,
                    "track_no": number if isinstance(number, int) and number > 0 else None})
        for f in daily:
            with f.text() as fh:
                for row in csv.DictReader(fh):
                    desc = row.get("Track Description") or ""
                    try:
                        plays = int(row.get("Play Count") or 1)
                    except ValueError:
                        plays = 1
                    parts = desc.split(" - ")
                    # "Artist - Song", but either side may contain " - " too: record every split
                    for i in range(1, len(parts)):
                        song = _k(" - ".join(parts[i:]))
                        self.daily[song][" - ".join(parts[:i])] += plays
                        if row.get("Track Identifier"):
                            self.ids.setdefault(song, row["Track Identifier"])
        if os.path.exists(APPLE_OVERRIDES):
            with open(APPLE_OVERRIDES, encoding="utf-8-sig", newline="") as fh:
                for row in csv.DictReader(fh):
                    if (row.get("artist") or "").strip():
                        self.overrides[(_k(row.get("song")), _k(row.get("album")))] = row["artist"].strip()

    @staticmethod
    def _one(counter):
        return next(iter(counter)) if len(counter) == 1 else None

    def find(self, song, album):
        s, a = _k(song), _k(album)
        if (s, a) in self.overrides:
            return self.overrides[(s, a)]
        hit = (self._one(self.by_song_album.get((s, a), ()))
               or self._one(self.by_song.get(s, ()))
               or self._one(self.daily.get(s, ())))
        if hit:
            return hit
        # several artists have a song with this name: prefer one known for this album,
        # then whoever this person played it from most
        cands = Counter(self.by_song.get(s, {})) + Counter(self.daily.get(s, {}))
        on_album = self.by_album.get(a, {})
        for artist, _ in cands.most_common():
            if artist in on_album:
                return artist
        if cands:
            return cands.most_common(1)[0][0]
        return self._one(self.by_album.get(a, ())) if a else None

    def track_id(self, song, album):
        return self.ids.get((_k(song), _k(album))) or self.ids.get(_k(song))


def load_apple(entries, library, daily, lib, pid):
    events = []
    for f in entries:
        with f.text() as fh:
            for row in csv.DictReader(fh):
                if row.get("Event Type") != "PLAY_END" or row.get("Media Type", "AUDIO") != "AUDIO":
                    continue
                song = row.get("Song Name")
                if not song:
                    continue
                start = parse_ts(row.get("Event Start Timestamp") or row.get("Event Timestamp")
                                 or row.get("Event End Timestamp"))
                try:
                    ms = max(int(float(row.get("Play Duration Milliseconds") or 0)), 0)
                    pos = int(float(row.get("Start Position In Milliseconds") or 0))
                except ValueError:
                    ms, pos = 0, 0
                auto, shuffle = row.get("Auto Play") or "", row.get("Shuffle Play") or ""
                mode = ("autoplay" if auto.startswith("AUTO_ON") or row.get("Container Type") == "RADIO" else
                        "shuffle" if shuffle == "SHUFFLE_ON" else
                        "flow" if shuffle == "SHUFFLE_OFF" else None)
                device = device_kind(" ".join(row.get(c) or "" for c in ("Device Type", "Source Type", "Device OS Name")))
                events.append((start or 0.0, song, row.get("Album Name") or "", ms, pos,
                               row.get("End Reason Type") or "", row.get("IP Country Code") or "",
                               row.get("UTC Offset In Seconds") or "", mode, device))
    events.sort(key=lambda e: e[0])

    # Pausing or seeking ends an event, and resuming starts a new one at the same
    # spot. Stitch those back together so one listen counts as one play.
    plays = []
    for e in events:
        start, song, album, ms, pos, reason = e[:6]
        last = plays[-1] if plays else None
        if (last and pos > 1000 and last["song"] == song and last["album"] == album
                and last["reason"] in APPLE_CONTINUES and 0 <= start - last["start"] < 12 * 3600):
            last["ms"] += ms
            last["reason"] = reason
            continue
        plays.append({"start": start, "song": song, "album": album, "ms": ms, "reason": reason,
                      "country": e[6], "offset": e[7], "mode": e[8], "device": e[9]})
    stitched = len(events) - len(plays)

    artists = AppleArtists(library, daily)
    n, missing = 0, Counter()
    for p in plays:
        artist = artists.find(p["song"], p["album"])
        if not artist:
            missing[(p["song"], p["album"])] += 1
            continue
        country = p["country"].strip()
        tid = lib.add(pid, p["start"] or None, artist, p["song"], p["ms"], APPLE,
                      album=p["album"] or None, skipped=1 if p["reason"] in APPLE_SKIPS else 0,
                      place=f"c:{country}" if country else None,
                      tzname=f"offset:{p['offset']}" if p["offset"].lstrip("-").isdigit() else None,
                      apple_id=artists.track_id(p["song"], p["album"]), mode=p["mode"], device=p["device"])
        m = artists.meta.get((_k(p["song"]), _k(p["album"])))
        if m and lib.keys[tid] not in lib.meta_seed:
            lib.meta_seed[lib.keys[tid]] = m
        n += 1
    print(f"  Apple:   {n:,} plays from {len(entries)} file(s) "
          f"({stitched:,} paused or seeked fragments joined into their plays)")
    if not library:
        print(f"  ! Apple Music Library Tracks.json not found next to the play activity: "
              f"artists can only come from the daily tracks file", file=sys.stderr)
    if missing:
        total = sum(missing.values())
        out = APPLE_MISSING.format(re.sub(r"[^\w-]+", "_", lib.people[pid]))
        with open(out, "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["song", "album", "artist", "plays"])
            for (song, album), c in missing.most_common():
                w.writerow([song, album, "", c])
        print(f"  ! {total:,} Apple plays ({len(missing):,} songs) skipped: artist unknown. They're listed in "
              f"{out}; fill in the artist column, save it as {APPLE_OVERRIDES} and restart.",
              file=sys.stderr)


# ------------------------------------------------------------------ caches --

class JsonCache:
    def __init__(self, path):
        self.path, self.lock, self.dirty = path, threading.Lock(), 0
        self.data = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    self.data = json.load(fh)
            except (OSError, json.JSONDecodeError):
                print(f"  ! couldn't read {path}, starting fresh", file=sys.stderr)

    def get(self, key):
        with self.lock:
            return key in self.data, self.data.get(key)

    def set(self, key, value):
        with self.lock:
            self.data[key] = value
            self.dirty += 1
            if self.dirty >= 10:
                self._save()

    def save(self):
        with self.lock:
            self._save()

    def _save(self):
        if not self.dirty:
            return
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.data, fh, ensure_ascii=False)
        os.replace(tmp, self.path)
        self.dirty = 0


NET = threading.BoundedSemaphore(4)                    # max parallel outgoing requests


class CoverFiles:
    """Cover images saved on disk, one file per image URL, so each cover is downloaded only once
    (albums share a file). Served to the page from here instead of from Spotify or Apple."""
    MAGIC = ((b"\xff\xd8", "image/jpeg"), (b"\x89PNG", "image/png"), (b"RIFF", "image/webp"), (b"GIF8", "image/gif"))

    def __init__(self, folder):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)

    def _path(self, url):
        return os.path.join(self.folder, hashlib.sha1(url.encode()).hexdigest()[:24] + ".img")

    def get(self, url):
        """(bytes, content type), downloading the image the first time."""
        path = self._path(url)
        try:
            with open(path, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            with NET:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=10) as r:
                    body = r.read(5_000_000)
            tmp = f"{path}.{threading.get_ident()}.tmp"
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, path)                          # never leaves half a file behind
        ctype = next((t for m, t in self.MAGIC if body.startswith(m)), "image/jpeg")
        return body, ctype


def http_json(url, retries=3, timeout=15, headers=None):
    for attempt in range(retries):
        try:
            with NET:
                req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (403, 429, 503) and attempt < retries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < retries - 1:
                time.sleep(2)
                continue
            raise
    return None


def lookup_cover(uri, artist, title, apple_id=None):
    if apple_id:                                       # exact match by Apple Music track id
        d = http_json("https://itunes.apple.com/lookup?" + urllib.parse.urlencode({"id": apple_id}),
                      retries=1, timeout=6)
        art = ((d or {}).get("results") or [{}])[0].get("artworkUrl100")
        if art:
            return art.replace("100x100bb", "600x600bb")
    if uri:
        tid = uri.split(":")[-1]
        d = http_json("https://open.spotify.com/oembed?url=" +
                      urllib.parse.quote(f"https://open.spotify.com/track/{tid}", safe=""), retries=1, timeout=6)
        if d and d.get("thumbnail_url"):
            return d["thumbnail_url"]
    q = urllib.parse.urlencode({"term": f"{artist} {title}", "entity": "song", "limit": 5})
    # fail fast: covers block browser connections while they load; a miss is retried next time
    d = http_json("https://itunes.apple.com/search?" + q, retries=1, timeout=6)
    if not d or not d.get("results"):
        return None
    a = search_text(artist)
    best = next((r for r in d["results"] if search_text(r.get("artistName", "")).startswith(a[:6])),
                d["results"][0])
    art = best.get("artworkUrl100")
    return art.replace("100x100bb", "600x600bb") if art else None


def lookup_lyrics(artist, title):
    clean = re.sub(r"\s*[\(\[](feat|ft|with)\.?\s[^\)\]]*[\)\]]", "", title, flags=re.I)
    clean = re.sub(r"\s+-\s+.*remaster.*$", "", clean, flags=re.I)
    for params in ({"artist_name": artist, "track_name": clean}, {"q": f"{artist} {clean}"}):
        res = http_json("https://lrclib.net/api/search?" + urllib.parse.urlencode(params)) or []
        hit = (next((x for x in res if x.get("plainLyrics")), None)
               or next((x for x in res if x.get("syncedLyrics")), None)
               or next((x for x in res if x.get("instrumental")), None))
        if hit:
            if hit.get("instrumental"):
                return "This track is instrumental."
            if hit.get("plainLyrics"):
                return hit["plainLyrics"]
            return re.sub(r"^\[[^\]]*\]\s?", "", hit["syncedLyrics"], flags=re.M)
    return ""                                          # looked, nothing found




# ------------------------------------------------------------- music info --
#
# Genre, release year, length and a 30-second preview per song, from Apple's free
# iTunes Search API. It allows about 20 requests a minute, so a background thread
# works through songs in order of how much they're played (yours first) and caches
# the results in meta_cache.json. Songs in an Apple Music library export already
# carry genre, year and length and need no request for those.

def _meta_from_itunes(r):
    year = str(r.get("releaseDate") or "")[:4]
    return {"genre": r.get("primaryGenreName") or None, "year": int(year) if year.isdigit() else None,
            "duration_ms": r.get("trackTimeMillis") or None, "preview": r.get("previewUrl") or None,
            "apple_id": str(r["trackId"]) if r.get("trackId") else None,
            "track_count": r.get("trackCount") or None, "track_no": r.get("trackNumber") or None}


class MetaStore:
    PAUSE = 3.2                                        # seconds between requests, ~19 a minute

    def __init__(self, lib, path):
        self.lib, self.cache = lib, JsonCache(path)
        self.cv = threading.Condition()
        self.done = 0
        self.running = False
        self.order = []
        for key, m in lib.meta_seed.items():           # from the Apple library export
            hit, old = self.cache.get(key)
            if not hit or not old:
                self.cache.set(key, dict(m, source="library"))
            elif any(v and not old.get(k) for k, v in m.items()):   # fill in fields added later (album sizes)
                self.cache.set(key, {**old, **{k: v for k, v in m.items() if v and not old.get(k)}})

    def get(self, tid):
        return self.cache.get(self.lib.keys[tid])[1]

    def start(self):
        ms = Counter()
        for p in self.lib.raw:
            ms[p[1]] += p[4]
        self.order = [tid for tid, _ in ms.most_common()]
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def progress(self):
        known = sum(1 for tid in self.order if (self.cache.get(self.lib.keys[tid])[0]))
        return {"looked_up": known, "total": len(self.order), "running": self.running}

    def _todo(self):
        for tid in self.order:
            hit, m = self.cache.get(self.lib.keys[tid])
            if not hit or (m and m.get("source") == "library" and m.get("apple_id") is None and not m.get("tried")):
                yield tid

    def _run(self):
        while True:
            batch, todo = [], self._todo()
            for tid in todo:
                if self.lib.apple_ids[tid]:
                    batch.append(tid)
                    if len(batch) >= 150:
                        break
                elif not batch:
                    self.fetch(tid)
                    break
            else:
                if not batch:
                    self.running = False
                    self.cache.save()
                    with self.cv:
                        self.cv.wait(timeout=300)  # sleep until asked for a preview
                    self.running = True
                    continue
            if batch:
                self._fetch_ids(batch)
            time.sleep(self.PAUSE)

    def _fetch_ids(self, tids, interactive=False):
        try:
            d = http_json("https://itunes.apple.com/lookup?" + urllib.parse.urlencode(
                {"id": ",".join(self.lib.apple_ids[t] for t in tids), "entity": "song"}),
                retries=1 if interactive else 2, timeout=8 if interactive else 15)
        except Exception:
            if not interactive:
                time.sleep(60)                         # probably rate limited: the background thread backs off
            return
        found = {str(r.get("trackId")): r for r in (d or {}).get("results", []) if r.get("wrapperType") == "track"}
        for tid in tids:
            key = self.lib.keys[tid]
            r = found.get(self.lib.apple_ids[tid])
            old = self.cache.get(key)[1] or {}
            new = _meta_from_itunes(r) if r else {}
            self.cache.set(key, {**{k: v for k, v in new.items() if v}, **{k: v for k, v in old.items() if v},
                                 "preview": new.get("preview") or old.get("preview"), "tried": True,
                                 "source": old.get("source", "itunes")} if (r or old) else None)

    def fetch(self, tid, interactive=False):
        """Look one song up by name. Returns its info (or None). Interactive lookups
        (someone is waiting, e.g. for a game clip) fail fast instead of backing off."""
        key = self.lib.keys[tid]
        artist, title = self.lib.display[tid]
        clean = re.sub(r"\s*[\(\[](feat|ft|with)\.?\s[^\)\]]*[\)\]]", "", title, flags=re.I)
        clean = re.sub(r"\s+-\s+.*remaster.*$", "", clean, flags=re.I)
        try:
            d = http_json("https://itunes.apple.com/search?" + urllib.parse.urlencode(
                {"term": f"{artist} {clean}", "entity": "song", "limit": 10}),
                retries=1 if interactive else 2, timeout=8 if interactive else 10)
        except Exception:
            if not interactive:
                time.sleep(60)
            return None
        want_a, want_t = search_text(norm_artist(artist, True)), search_text(norm_title(clean, True))
        best = None
        for r in (d or {}).get("results", []):
            ra = search_text(r.get("artistName", ""))
            rt = search_text(norm_title(r.get("trackName", ""), True))
            if not (ra.startswith(want_a[:6]) or want_a in ra):
                continue                               # wrong artist: better no info than wrong info
            if rt == want_t:
                best = r
                break
            if best is None and (rt.startswith(want_t) or want_t.startswith(rt)):
                best = r
        old = self.cache.get(key)[1] or {}
        if best:
            new = _meta_from_itunes(best)
            m = {**new, **{k: v for k, v in old.items() if v and k != "tried"}, "preview": new["preview"] or old.get("preview"),
                 "tried": True, "source": old.get("source", "itunes")}
        else:
            m = dict(old, tried=True) if old else None
        self.cache.set(key, m)
        return m

    def preview(self, tid):
        m = self.get(tid)
        if m and m.get("preview"):
            return m["preview"]
        if m and m.get("tried"):
            return None
        if self.lib.apple_ids[tid]:                     # exact lookup by Apple Music id first
            self._fetch_ids([tid], interactive=True)
            m = self.get(tid)
            if m and m.get("preview"):
                return m["preview"]
        m = self.fetch(tid, interactive=True)
        return m.get("preview") if m else None

# --------------------------------------------------------- hidden artists --

def load_hidden(path):
    """Artist keys saved by the page's "Hide artists" list."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            return [x["key"] if isinstance(x, dict) else str(x) for x in json.load(fh)]
    except (OSError, ValueError, KeyError) as e:
        print(f"  ! couldn't read {path}: {e}", file=sys.stderr)
        return []


def save_hidden(path, lib):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(lib.meta()["hidden"], fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# ---------------------------------------------------------------- concerts --
# "Prepare for the concert": upcoming shows you enter on the page (saved to concerts.json),
# and the artist's popular songs (Deezer, falling back to iTunes), matched against your own history.
# Setlists are deliberately never looked at: no spoilers.

class ConcertStore:
    def __init__(self, path):
        self.path, self.lock = path, threading.Lock()
        self.items = []
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    self.items = [c for c in json.load(fh) if c.get("id") and c.get("artist") and c.get("date")]
            except (OSError, ValueError) as e:
                print(f"  ! couldn't read {path}: {e}", file=sys.stderr)

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.items, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def all(self):
        with self.lock:
            return [dict(c) for c in self.items]

    def get(self, cid):
        with self.lock:
            return next((dict(c) for c in self.items if c["id"] == cid), None)

    def add(self, artist, date, city, people):
        c = {"id": hashlib.sha1(f"{artist}|{date}|{time.time()}".encode()).hexdigest()[:10],
             "artist": artist, "date": date, "city": city, "people": people}
        with self.lock:
            self.items.append(c)
            self._save()
        return c

    def remove(self, cid):
        with self.lock:
            self.items = [c for c in self.items if c["id"] != cid]
            self._save()


def _song_norm(s):
    """Title for matching a popular song to your plays: no feat., remaster, live, version."""
    s = norm_title(s, True)
    s = re.sub(r"\s*[\(\[][^\)\]]*(live|version|edit|mix|mono|stereo|acoustic|demo|session)[^\)\]]*[\)\]]", "", s)
    s = re.sub(r"\s+-\s+.*(live|version|edit|mix|remaster|mono|stereo|acoustic|demo|session).*$", "", s)
    s = s.replace("&", "and")
    return re.sub(r"[^\w]+", " ", s).strip()


def fetch_popular(artist):
    """The artist's most popular songs: Deezer's top tracks, or an iTunes search as a fallback."""
    want = norm_artist(artist, True)
    try:
        d = http_json("https://api.deezer.com/search/artist?" + urllib.parse.urlencode({"q": artist, "limit": 10}),
                      retries=2, timeout=8) or {}
        found = d.get("data") or []
        best = next((a for a in found if norm_artist(a.get("name", ""), True) == want), None) or (found[0] if found else None)
        if best:
            top = http_json(f"https://api.deezer.com/artist/{best['id']}/top?limit=30", retries=2, timeout=8) or {}
            songs = [{"title": t.get("title_short") or t.get("title"), "full": t.get("title"),
                      "preview": t.get("preview") or None,
                      "cover": ((t.get("album") or {}).get("cover_medium")) or None}
                     for t in top.get("data") or [] if t.get("title")]
            if songs:
                return {"source": "Deezer", "artist": best.get("name"), "picture": best.get("picture_medium"),
                        "fans": best.get("nb_fan"), "songs": songs}
    except Exception as e:
        print(f"  ! Deezer lookup for {artist} failed: {e}", file=sys.stderr)
    d = http_json("https://itunes.apple.com/search?" + urllib.parse.urlencode(
        {"term": artist, "entity": "song", "attribute": "artistTerm", "limit": 60}), retries=2, timeout=8) or {}
    songs, seen = [], set()
    for r in d.get("results") or []:
        if norm_artist(r.get("artistName", ""), True) != want:
            continue
        k = _song_norm(r.get("trackName", ""))
        if k and k not in seen:
            seen.add(k)
            songs.append({"title": r.get("trackName"), "full": r.get("trackName"), "preview": r.get("previewUrl"),
                          "cover": (r.get("artworkUrl100") or "").replace("100x100bb", "250x250bb") or None})
    return {"source": "iTunes", "artist": artist, "picture": None, "fans": None, "songs": songs[:25]}


def concert_prep(lib, artist, pids, concert_day, popular):
    """Everything the concert page shows for one artist and the people going."""
    MIN_MS, DAYS90, FORGOT = 30_000, 90 * DAY, 120 * DAY
    n = norm_artist(artist, True)
    art = lib.levels["artist"]
    tids = [t for t, c in enumerate(lib.credits) if n in c]
    tidset = set(tids)
    gid_of = {k: i for i, k in enumerate(art.keys)}
    main_gid = gid_of.get("a:" + n, -1)
    concert_ts = day_to_ts(concert_day) or time.time()

    by_artist = [Counter() for _ in pids]              # main-artist listening, to rank this artist
    last_any = [0.0] * len(pids)
    times = [defaultdict(list) for _ in pids]          # track -> play times (this artist only)
    ms_of = [Counter() for _ in pids]
    idx = {p: j for j, p in enumerate(pids)}
    for p in lib.all_raw:
        t, tid, pid, src, ms = p[:5]
        j = idx.get(pid)
        if j is None or ms < MIN_MS or not t:
            continue
        by_artist[j][art.of_track[tid]] += ms
        if t > last_any[j]:
            last_any[j] = t
        if tid in tidset:
            times[j][tid].append(t)
            ms_of[j][tid] += ms

    # several versions of one song (live, remaster…) count together for matching
    by_title = defaultdict(list)
    for tid in tids:
        by_title[_song_norm(lib.display[tid][1])].append(tid)

    def plays_of(j, tids_):
        return sum(len(times[j][t]) for t in tids_)

    def last_of(j, tids_):
        return max((times[j][t][-1] for t in tids_ if times[j][t]), default=0.0)

    def item(title, tids_, **extra):
        best = max(tids_, key=lambda t: sum(len(times[j][t]) for j in range(len(pids)))) if tids_ else None
        out = {"title": title, "key": lib.keys[best] if best is not None else None,
               "plays": [plays_of(j, tids_) for j in range(len(pids))],
               "last": [iso_day(last_of(j, tids_)) if last_of(j, tids_) else None for j in range(len(pids))],
               "spotify": (f"https://open.spotify.com/track/{lib.uris[best].split(':')[-1]}"
                           if best is not None and lib.uris[best] else None), **extra}
        return out

    pop_items, pop_keys = [], set()
    for i, s in enumerate((popular or {}).get("songs") or []):
        k = _song_norm(s["title"])
        if not k or k in pop_keys:
            continue
        pop_keys.add(k)
        pop_items.append(item(s["title"], by_title.get(k, []), rank=len(pop_items) + 1,
                              preview=s.get("preview"), cover=s.get("cover")))
    likely = pop_items[:10]                            # their 10 most popular songs

    people = []
    for j, pid in enumerate(pids):
        ref = min(last_any[j] or concert_ts, concert_ts)   # "lately" means the end of this person's data
        songs = []
        for k, ts_ in by_title.items():
            all_t = sorted(t for tid in ts_ for t in times[j][tid])
            if all_t:
                songs.append((k, ts_, all_t))
        total = sum(len(x[2]) for x in songs)
        first = min((x[2][0] for x in songs), default=0.0)
        last = max((x[2][-1] for x in songs), default=0.0)
        rank = None
        if main_gid >= 0 and by_artist[j][main_gid]:
            mine = by_artist[j][main_gid]
            rank = 1 + sum(1 for g, v in by_artist[j].items() if v > mine and g >= 0)
        forgotten, repeat, deep = [], [], []
        for k, ts_, all_t in songs:
            nplays, recent = len(all_t), sum(1 for t in all_t if t > ref - DAYS90)
            title = lib.display[max(ts_, key=lambda t: len(times[j][t]))][1]
            if nplays >= 5 and all_t[-1] < ref - FORGOT:
                forgotten.append((nplays, item(title, ts_, days_since=int((ref - all_t[-1]) // DAY))))
            if recent >= 3:
                repeat.append((recent, item(title, ts_, recent=recent)))
            if nplays >= 5 and k not in pop_keys:
                deep.append((nplays, item(title, ts_)))
        learn = [x for x in pop_items if x["plays"][j] < 3]
        known = sum(1 for x in likely if x["plays"][j] >= 3)
        people.append({
            "pid": pid, "plays": total, "ms": sum(ms_of[j].values()), "songs": len(songs),
            "first": iso_day(first) if first else None, "last": iso_day(last) if last else None,
            "rank": rank, "ready": {"known": known, "of": len(likely)},
            "forgotten": [x for _, x in sorted(forgotten, key=lambda x: -x[0])][:30],
            "repeat": [x for _, x in sorted(repeat, key=lambda x: -x[0])][:20],
            "deep": [x for _, x in sorted(deep, key=lambda x: -x[0])][:20],
            "learn": learn[:30],
        })

    shared = []
    if len(pids) > 1:
        for k, ts_ in by_title.items():
            v = [plays_of(j, ts_) for j in range(len(pids))]
            if min(v) >= 3:
                title = lib.display[max(ts_, key=lambda t: plays_of(0, [t]) + plays_of(1, [t]))][1]
                shared.append((min(v), item(title, ts_)))
        shared.sort(key=lambda x: -x[0])

    # past shows: did it change how much you listen? 30 days before vs after
    after = None
    if concert_ts < time.time():
        after = []
        for j in range(len(pids)):
            b = sum(1 for ts_ in times[j].values() for t in ts_ if concert_ts - 30 * DAY <= t < concert_ts)
            a = sum(1 for ts_ in times[j].values() for t in ts_ if concert_ts + DAY <= t < concert_ts + 31 * DAY)
            after.append({"before": b, "after": a, "has_data": last_any[j] >= concert_ts + 31 * DAY})

    return {"artist_known": bool(tids), "people_full": people, "popular": pop_items,
            "shared": [x for _, x in shared][:30],
            "after": after}


def concert_summary(lib, artist, pids):
    """Quick numbers for the concert list: plays and songs per person going."""
    n = norm_artist(artist, True)
    tids = {t for t, c in enumerate(lib.credits) if n in c}
    plays, songs = Counter(), defaultdict(set)
    if tids:
        for p in lib.all_raw:
            if p[1] in tids and p[2] in pids and p[4] >= 30_000:
                plays[p[2]] += 1
                songs[p[2]].add(p[1])
    return [{"pid": pid, "plays": plays[pid], "songs": len(songs[pid])} for pid in pids]


# ------------------------------------------------------------------ extras --
# More fun: your A–Z of artists, the words in your song titles (and how dark they are),
# one-hit wonders, and for two people: telepathy (the same song within an hour, out of nowhere)
# and your most in-sync day. Plus the rediscover roulette.

TITLE_STOP = set("""a an the and or of to in on at for with from by is are was be it its it's i i'm im me my you your
you're we our us he she his her they them this that these those not no don't dont do just so up out down all
what when where who how why can can't cant will won't got get let oh yeah la na feat ft remix version live edit like song
mix remastered remaster radio acoustic pt part ii iii vs x de el la le les der die das und von over away want take way into back""".split())
DARK = re.compile(r"\b(death|dead|die|dying|kill|killer|blood|bleed|hell|demon|devil|grave|funeral|pain|hate|"
                  r"war|dark|darkness|black|nightmare|scream|fear|knife|bullet|suicide|sin|sinner|chaos|ghost|"
                  r"cold|broken|bury|burial|corpse|doom|evil|curse|cursed|venom|poison|tod|tot|sterben|hölle)\b", re.I)
LIGHT = re.compile(r"\b(love|lover|sun|sunshine|happy|happiness|light|smile|heaven|summer|dance|dancing|sweet|"
                   r"baby|honey|dream|dreams|kiss|beautiful|shine|golden|paradise|joy|good|friend|friends|fly|"
                   r"liebe|sonne|angel)\b", re.I)


def _letter(name):
    c = _strip_accents(name.strip())[:1].upper()
    if not c:
        return None
    return c if "A" <= c <= "Z" else "#"


def _extras(self, lo_ts, hi_ts, sel, minplay_ms, part="all"):
    """part: taste (A–Z, title words, one-hit wonders), sync (telepathy, in-sync days), unusual (sessions),
    or all. Each part is its own request, so the page can show the quick ones first."""
    lo, hi = self._span(lo_ts, hi_ts)
    art = self.levels["artist"]
    if part == "unusual":
        return {"people": [{"pid": pid, "unusual": self._unusual(lo, hi, pid, minplay_ms)} for pid in sel]}
    pairs = []
    if part in ("sync", "all") and len(sel) > 1:
        for ai in range(len(sel)):
            for bi in range(ai + 1, len(sel)):
                pairs.append(self._sync_pair(lo, hi, sel[ai], sel[bi], minplay_ms))
    if part == "sync":
        return {"pairs": pairs}
    people = []
    for pid in sel:
        art_ms, art_tracks, plays = Counter(), defaultdict(Counter), Counter()
        for i in range(lo, hi):
            t, tid, p, src, ms = self.raw[i][:5]
            if p != pid or ms < minplay_ms or not t:
                continue
            g = art.of_track[tid]
            art_ms[g] += ms
            art_tracks[g][tid] += 1
            plays[tid] += 1
        total = sum(plays.values())

        # A–Z: the top artist for each first letter
        letters = {}
        for g, ms in art_ms.most_common():
            if g < 0:
                continue
            L = _letter(art.title[g])
            if not L:
                continue
            x = letters.setdefault(L, {"letter": L, "artist": art.title[g], "ms": ms, "n": 0,
                                       "cover_key": self.keys[art_tracks[g].most_common(1)[0][0]]})
            x["n"] += 1

        # words in song titles, weighted by plays
        words, dark, light = Counter(), 0, 0
        for tid, n in plays.items():
            title = self.display[tid][1]
            clean = re.sub(r"[\(\[].*?[\)\]]|\s-\s.*$", "", title)
            for w in set(re.findall(r"[^\W\d_][\w']+", clean.lower())):
                if len(w) > 2 and w not in TITLE_STOP:
                    words[w] += n
            dark += n if DARK.search(clean) else 0
            light += n if LIGHT.search(clean) else 0
        top_words = [{"word": w, "plays": n} for w, n in words.most_common(24)]

        # one-hit wonders: artists you only know for one song
        ohw = []
        for g, c in art_tracks.items():
            n_art = sum(c.values())
            tid, n = c.most_common(1)[0]
            if g >= 0 and n >= 15 and n / n_art >= 0.9:
                ohw.append((n, self._song(tid, plays=n, share=round(n / n_art, 3), artist_plays=n_art)))
        ohw.sort(key=lambda x: -x[0])

        people.append({"pid": pid, "letters": sorted(letters.values(), key=lambda x: x["letter"]),
                       "missing": [L for L in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if L not in letters],
                       "words": top_words, "plays": total,
                       "dark": round(dark / total, 4) if total else 0.0, "light": round(light / total, 4) if total else 0.0,
                       "one_hit": [x for _, x in ohw[:30]]})
        if part == "all":
            people[-1]["unusual"] = self._unusual(lo, hi, pid, minplay_ms)
    return {"people": people, "pairs": pairs}


def _sync_pair(self, lo, hi, a, b, minplay_ms):
    """Telepathy: both played the same song within an hour, neither having played it for 30+ days.
    In sync: the day the two of you played the most of the same songs."""
    HOUR, GAP = 3600, 30 * DAY
    last, fresh = {}, {}                      # (pid, tid) -> last play time / whether that play came "out of nowhere"
    events, seen = [], set()
    day_songs = {a: defaultdict(set), b: defaultdict(set)}
    for i in range(lo, hi):
        t, tid, p, src, ms = self.raw[i][:5]
        if p not in (a, b) or ms < minplay_ms or not t:
            continue
        day_songs[p][self.lday[i]].add(tid)
        prev = last.get((p, tid))
        is_fresh = prev is None or t - prev > GAP
        q = b if p == a else a
        lq = last.get((q, tid))
        if is_fresh and lq is not None and t - lq <= HOUR and fresh.get((q, tid)):
            k = (tid, self.lday[i])
            if k not in seen:
                seen.add(k)
                events.append({**self._song(tid), "first": q, "second": p, "minutes": max(1, round((t - lq) / 60)),
                               "day": iso_day(t)})
        last[(p, tid)] = t
        fresh[(p, tid)] = is_fresh
    best, shared_days = None, 0
    for d, sa in day_songs[a].items():
        sb = day_songs[b].get(d)
        if not sb:
            continue
        common = sa & sb
        if common:
            shared_days += 1
            if len(sa) >= 5 and len(sb) >= 5:
                score = len(common) / len(sa | sb)
                if not best or (score, len(common)) > best[0]:
                    best = ((score, len(common)), d, common)
    sync = None
    if best:
        (score, n), d, common = best
        sync = {"day": datetime.fromordinal(d).date().isoformat(), "share": round(score, 3), "common": n,
                "songs": [self._song(tid) for tid in sorted(common, key=lambda t: -len(self.track_plays[t]))[:6]]}
    events.reverse()                          # newest first
    return {"a": a, "b": b, "telepathy": events[:40], "telepathy_n": len(events), "shared_days": shared_days, "sync": sync}


def _roulette(self, pid, minplay_ms, n=40):
    """Songs you loved (8+ plays) but haven't played in over a year, by the end of your history."""
    plays, last = Counter(), {}
    for p in self.raw:
        if p[2] == pid and p[0] and p[4] >= minplay_ms:
            plays[p[1]] += 1
            last[p[1]] = p[0]
    end = max(last.values(), default=0.0)
    cands = [(tid, k) for tid, k in plays.items() if k >= 8 and last[tid] < end - 365 * DAY]
    if not cands:
        return []
    pickd = random.sample(cands, min(n, len(cands)))
    return [self._song(tid, plays=k, last=iso_day(last[tid]), years=round((end - last[tid]) / (365 * DAY), 1))
            for tid, k in pickd]


def _unusual(self, lo, hi, pid, minplay_ms, limit=30):
    """Listening sessions (30+ minutes of silence starts a new one) that don't look like you:
    off your usual taste, full of songs you'd never played, at an hour you're rarely up,
    much longer than usual, one song on loop, or a deep dive into an artist you never touch otherwise."""
    art = self.levels["artist"]
    first_ever = {}                                   # track -> this person's first play, over the whole history
    for i in range(0, hi):
        p = self.raw[i]
        if p[2] == pid and p[0] and p[1] not in first_ever:
            first_ever[p[1]] = i
    sessions, cur = [], None
    art_ms, art_n, hour_n, total_ms = Counter(), Counter(), Counter(), 0
    for i in range(lo, hi):
        t, tid, p, src, ms = self.raw[i][:5]
        if p != pid or ms < minplay_ms or not t:
            continue
        g = art.of_track[tid]
        art_ms[g] += ms
        art_n[g] += 1
        total_ms += ms
        if self.how[i] != 255:
            hour_n[self.how[i] % 24] += 1
        if cur and t - cur["end"] <= 1800:
            cur["end"] = t
            cur["idx"].append(i)
        else:
            cur = {"start": t, "end": t, "idx": [i]}
            sessions.append(cur)
    sessions = [x for x in sessions if len(x["idx"]) >= 5]
    if len(sessions) < 10 or not total_ms:
        return []
    all_hours = sum(hour_n.values()) or 1

    stats = []
    for x in sessions:
        idx = x["idx"]
        n = len(idx)
        tracks, arts, ms_sum, strange = Counter(), Counter(), 0, 0.0
        new = 0
        for i in idx:
            tid, ms = self.raw[i][1], self.raw[i][4]
            g = art.of_track[tid]
            tracks[tid] += 1
            arts[g] += 1
            ms_sum += ms
            share = art_ms[g] / total_ms
            strange += 1.0 if share < 0.005 else 0.0   # a play of an artist that's under 0.5% of your listening
            new += first_ever.get(tid) == i
        x.update(n=n, tracks=tracks, arts=arts, ms=ms_sum, off=strange / n, new=new / n, new_n=new,
                 dur=x["end"] - x["start"] + self.raw[idx[-1]][4] / 1000,
                 hour=self.how[idx[0]] % 24 if self.how[idx[0]] != 255 else None)
        stats.append(x)

    def pctl(key):
        vals = sorted(x[key] for x in stats)
        return lambda v: bisect.bisect_left(vals, v) / len(vals)
    p_off, p_new, p_dur = pctl("off"), pctl("new"), pctl("dur")
    med_dur = sorted(x["dur"] for x in stats)[len(stats) // 2]

    out = []
    for x in stats:
        tags, score = [], 0.0
        if x["off"] >= 0.6 and p_off(x["off"]) >= 0.9:
            tags.append({"kind": "off", "emoji": "🧭", "text": f"{round(x['off'] * 100)}% of it by artists you almost never play"})
            score += 2 * x["off"]
        if x["new_n"] >= 5 and x["new"] >= 0.5 and p_new(x["new"]) >= 0.9:
            tags.append({"kind": "new", "emoji": "🆕", "text": f"{x['new_n']} songs you’d never played before"})
            score += 2 * x["new"]
        if x["hour"] is not None and hour_n[x["hour"]] / all_hours < 0.015:
            tags.append({"kind": "hour", "emoji": "🌙" if x["hour"] < 7 or x["hour"] >= 22 else "⏰",
                         "text": f"started at {x['hour']}:00, when you almost never listen"})
            score += 1.0
        if x["dur"] >= 3 * med_dur and p_dur(x["dur"]) >= 0.98 and x["dur"] >= 3 * 3600:
            tags.append({"kind": "long", "emoji": "🏃", "text": f"a {x['dur'] / 3600:.1f}-hour marathon "
                                                                 f"({round(x['dur'] / max(med_dur, 1))}× your usual)"})
            score += 1.5
        tid, k = x["tracks"].most_common(1)[0]
        if k >= 6 and k / x["n"] >= 0.6:
            tags.append({"kind": "loop", "emoji": "🔁", "text": f"“{self.display[tid][1]}” {k} times"})
            score += 1.5
        g, kg = x["arts"].most_common(1)[0]
        if g >= 0 and kg >= 5 and kg / art_n[g] >= 0.8:
            tags.append({"kind": "dive", "emoji": "🕳️", "text": f"a deep dive into {art.title[g]}: "
                                                                 f"{round(kg / art_n[g] * 100)}% of all your plays of them"})
            score += 2.0
        if not tags:
            continue
        i0 = x["idx"][0]
        out.append((score + 0.1 * math.log1p(x["n"]), {
            "start": iso_day(x["start"]), "day": datetime.fromordinal(self.lday[i0]).date().isoformat(),
            "hour": x["hour"], "songs": x["n"], "ms": x["ms"], "tags": tags,
            "artists": [art.title[g] for g, _ in x["arts"].most_common(3) if g >= 0],
            "top": [self._song(t, plays_here=c) for t, c in x["tracks"].most_common(5)]}))
    out.sort(key=lambda z: -z[0])
    return [z for _, z in out[:limit]]


Library._extras, Library._sync_pair, Library._roulette, Library._unusual = _extras, _sync_pair, _roulette, _unusual


# ------------------------------------------------------------------ versus --
# Two people, one artist: who's the bigger fan? A few rounds (plays, hours, songs, fan since,
# streak, biggest day, loyalty, lately), who owns which song, and both timelines.

def _in_frame(t, lo_ts, hi_ts):
    return t and (lo_ts is None or t >= lo_ts) and (hi_ts is None or t < hi_ts)


def versus_suggestions(lib, a, b, lo_ts, hi_ts, limit=10):
    """Artists both people play, closest fights first (weighted by how much they're played)."""
    art = lib.levels["artist"]
    c = {a: Counter(), b: Counter()}
    for p in lib.all_raw:
        if p[2] in c and p[4] >= 30_000 and _in_frame(p[0], lo_ts, hi_ts):
            c[p[2]][art.of_track[p[1]]] += 1
    out = []
    for g, na in c[a].items():
        nb = c[b].get(g, 0)
        if g >= 0 and min(na, nb) >= 10:
            close = 1 - abs(na - nb) / (na + nb)
            out.append((close * math.log1p(na + nb), {"artist": art.title[g], "a": na, "b": nb}))
    out.sort(key=lambda x: -x[0])
    return [x for _, x in out[:limit]]


def _data_span(lib, pid):
    ts = [p[0] for p in lib.all_raw if p[2] == pid and p[0]]
    return (ts[0], ts[-1]) if ts else (0.0, 0.0)


def versus(lib, artist, a, b, lo_ts, hi_ts, overlap=False):
    n = artist[2:] if artist.startswith("a:") else norm_artist(artist, True)
    if n not in lib.credit_title:
        return None
    span = {pid: _data_span(lib, pid) for pid in (a, b)}
    both = (max(span[a][0], span[b][0]), min(span[a][1], span[b][1]) + 1)
    if overlap and both[0] < both[1]:                # only the time both histories cover
        lo_ts = both[0] if lo_ts is None else max(lo_ts, both[0])
        hi_ts = both[1] if hi_ts is None else min(hi_ts, both[1])
    tids = {t for t, c in enumerate(lib.credits) if n in c}
    art = lib.levels["artist"]
    gid_of = {k: i for i, k in enumerate(art.keys)}
    main_gid = gid_of.get("a:" + n, -1)
    side = {pid: {"plays": 0, "ms": 0, "first": 0.0, "last": 0.0, "songs": Counter(), "days": Counter(),
                  "months": Counter(), "all_ms": 0, "by_artist": Counter(), "data_first": 0.0, "data_last": 0.0,
                  "night": 0}
            for pid in (a, b)}
    for i, p in enumerate(lib.all_raw):
        t, tid, pid, src, ms = p[:5]
        s = side.get(pid)
        if s is None or not t:
            continue
        if not s["data_first"]:
            s["data_first"] = t
        s["data_last"] = t
        if ms < 30_000 or not _in_frame(t, lo_ts, hi_ts):
            continue
        s["all_ms"] += ms
        s["by_artist"][art.of_track[tid]] += ms
        if tid not in tids:
            continue
        s["plays"] += 1
        s["ms"] += ms
        s["first"] = s["first"] or t
        s["last"] = t
        s["songs"][tid] += 1
        s["days"][lib.all_lday[i]] += 1
        s["months"][datetime.fromordinal(lib.all_lday[i]).strftime("%Y-%m")] += 1
        how = lib.all_how[i]
        if how != 255 and how % 24 < 4:
            s["night"] += 1

    # "lately" is the 90 days before both histories end (or the end of the time frame)
    ref = min(side[a]["data_last"], side[b]["data_last"])
    if hi_ts is not None:
        ref = min(ref, hi_ts)
    lately = {pid: 0 for pid in (a, b)}
    for i, p in enumerate(lib.all_raw):
        if p[2] in lately and p[1] in tids and p[4] >= 30_000 and ref - 90 * DAY < p[0] <= ref:
            lately[p[2]] += 1

    def streak(days):
        best, cur, prev = 0, 0, None
        for d in sorted(days):
            cur = cur + 1 if prev is not None and d == prev + 1 else 1
            best, prev = max(best, cur), d
        return best

    def rank(s):
        mine = s["by_artist"].get(main_gid, 0)
        return 1 + sum(1 for g, v in s["by_artist"].items() if v > mine and g >= 0) if mine else None

    rounds = []

    def rnd(rid, label, va, vb, fa=None, fb=None, lower=False, counts=True, note=""):
        if va == vb or (not va and not vb):
            win = None
        else:
            win = (a if va < vb else b) if lower else (a if va > vb else b)
        rounds.append({"id": rid, "label": label, "a": va, "b": vb, "fa": fa, "fb": fb, "winner": win,
                       "counts": counts, "note": note})

    A, B = side[a], side[b]
    rnd("plays", "🎧 Plays", A["plays"], B["plays"])
    rnd("hours", "⏱️ Time listened", A["ms"], B["ms"])
    rnd("songs", "📚 Songs explored", len(A["songs"]), len(B["songs"]))
    # fan since: earlier wins, unless it's only because the other person's history starts later
    if A["first"] and B["first"]:
        early, late = (a, b) if A["first"] <= B["first"] else (b, a)
        unfair = side[early]["first"] < side[late]["data_first"] - 30 * DAY
        close = abs(A["first"] - B["first"]) < 14 * DAY
        rnd("since", "🕰️ Fan since", A["first"], B["first"], iso_day(A["first"]), iso_day(B["first"]), lower=True,
            counts=not unfair and not close,
            note=f"{lib.people[late]}’s history only starts {iso_day(side[late]['data_first'])}" if unfair
            else "within two weeks of each other" if close else "")
    else:
        rnd("since", "🕰️ Fan since", 1 if A["first"] else 0, 1 if B["first"] else 0,
            iso_day(A["first"]) if A["first"] else None, iso_day(B["first"]) if B["first"] else None)
    rnd("streak", "🔥 Longest streak", streak(A["days"]), streak(B["days"]))
    da, db = A["days"].most_common(1), B["days"].most_common(1)
    rnd("day", "📅 Biggest day", da[0][1] if da else 0, db[0][1] if db else 0,
        datetime.fromordinal(da[0][0]).date().isoformat() if da else None,
        datetime.fromordinal(db[0][0]).date().isoformat() if db else None)
    la = A["ms"] / A["all_ms"] if A["all_ms"] else 0.0
    lb = B["ms"] / B["all_ms"] if B["all_ms"] else 0.0
    rnd("loyal", "💘 Share of all listening", round(la, 4), round(lb, 4), rank(A), rank(B))
    rnd("lately", "📈 Lately", lately[a], lately[b], note=f"the 90 days before {iso_day(ref - 1)}")
    rnd("night", "🌙 After midnight", A["night"], B["night"], counts=False, note="12–4 am, just for fun")

    score = {a: sum(1 for r in rounds if r["counts"] and r["winner"] == a),
             b: sum(1 for r in rounds if r["counts"] and r["winner"] == b)}

    # who owns which song
    owned, only_a, only_b = [], [], []
    for tid in set(A["songs"]) | set(B["songs"]):
        va, vb = A["songs"][tid], B["songs"][tid]
        item = lib._song(tid, plays=[va, vb])
        if va and vb:
            owned.append((va + vb, item))
        elif va >= 3:
            only_a.append((va, item))
        elif vb >= 3:
            only_b.append((vb, item))
    for xs in (owned, only_a, only_b):
        xs.sort(key=lambda x: -x[0])
    fav = lambda s: lib._song(s["songs"].most_common(1)[0][0], plays=s["songs"].most_common(1)[0][1]) if s["songs"] else None

    months = sorted(set(A["months"]) | set(B["months"]))
    if months:                                         # fill the gaps so the timeline is to scale
        y, m = map(int, months[0].split("-"))
        end, months = months[-1], []
        while True:
            k = f"{y:04d}-{m:02d}"
            months.append(k)
            if k >= end:
                break
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    uneven = abs(span[a][0] - span[b][0]) > 90 * DAY or abs(span[a][1] - span[b][1]) > 90 * DAY
    return {"artist": lib.credit_title[n], "key": "a:" + n, "a": a, "b": b, "rounds": rounds, "score": score,
            "overlap": overlap, "uneven": uneven, "both_from": iso_day(both[0]), "both_to": iso_day(both[1] - 1),
            "fav": {"a": fav(A), "b": fav(B)},
            "owned": [x for _, x in owned[:40]], "only_a": [x for _, x in only_a[:30]], "only_b": [x for _, x in only_b[:30]],
            "shared_songs": len(owned),
            "timeline": [{"month": k, "a": A["months"][k], "b": B["months"][k]} for k in months]}


# ------------------------------------------------------------------ server --

class BadParam(ValueError):
    pass


class ReadWriteLock:
    """Many readers at once (stats requests), one writer alone (changing hidden artists)."""

    def __init__(self):
        self.cv = threading.Condition()
        self.readers = 0
        self.writing = False

    def read(self):
        lock = self

        class Ctx:
            def __enter__(self):
                with lock.cv:
                    while lock.writing:
                        lock.cv.wait()
                    lock.readers += 1

            def __exit__(self, *exc):
                with lock.cv:
                    lock.readers -= 1
                    lock.cv.notify_all()
        return Ctx()

    def write(self):
        lock = self

        class Ctx:
            def __enter__(self):
                with lock.cv:
                    while lock.writing:
                        lock.cv.wait()
                    lock.writing = True              # new readers wait from here on
                    while lock.readers:
                        lock.cv.wait()

            def __exit__(self, *exc):
                with lock.cv:
                    lock.writing = False
                    lock.cv.notify_all()
        return Ctx()


class Handler(BaseHTTPRequestHandler):
    server_version = "MusicStats/2.0"
    lib = covers = cover_files = lyrics = web_root = meta = None
    clips, clip_lock = OrderedDict(), threading.Lock()   # recent preview clips
    data_lock = ReadWriteLock()
    hidden_path = "hidden_artists.json"
    UNLOCKED = {"/api/cover", "/api/lyrics", "/api/preview",   # don't touch the play data, and can be slow
                "/api/concerts", "/api/concert"}                  # (these two take the read lock themselves)
    concerts = concert_cache = None
    verbose = False

    def log_message(self, fmt, *args):
        if self.verbose:
            super().log_message(fmt, *args)

    def send(self, code, body=b"", ctype="application/json; charset=utf-8", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, code=200, headers=None):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), headers=headers)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        qs = dict(urllib.parse.parse_qsl(url.query))
        try:
            route = {
                "/api/meta": self.api_meta, "/api/tracks": self.api_tracks,
                "/api/detail": self.api_detail, "/api/insights": self.api_insights, "/api/fun": self.api_fun, "/api/time": self.api_time, "/api/clock": self.api_clock, "/api/more": self.api_more, "/api/albums": self.api_albums, "/api/hidden": self.api_hidden, "/api/artists": self.api_artists, "/api/music": self.api_music, "/api/preview": self.api_preview,
                "/api/concerts": self.api_concerts, "/api/concert": self.api_concert, "/api/versus": self.api_versus,
                "/api/extras": self.api_extras, "/api/roulette": self.api_roulette,
                "/api/cover": self.api_cover, "/api/lyrics": self.api_lyrics,
            }.get(url.path)
            if route:
                if url.path in self.UNLOCKED:
                    return route(qs)
                if url.path == "/api/hidden" and set(qs) & {"add", "remove", "clear", "only", "only_remove", "only_clear"}:
                    with Handler.data_lock.write():        # rebuilds the data: nobody reads meanwhile
                        return route(qs)
                t0 = time.time()
                with Handler.data_lock.read():             # stats requests run side by side
                    route(qs)
                took = time.time() - t0
                if took >= 1.0:                            # so you can tell which part of the page is slow
                    print(f"  slow: {url.path}{'?part=' + qs['part'] if qs.get('part') else ''} took {took:.1f}s")
                return
            if url.path.startswith("/api/"):
                return self.send_json({"error": "Unknown endpoint"}, 404)
            return self.static(url.path)
        except BadParam as e:
            self.send_json({"error": f"Bad parameter: {e}"}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            try:
                self.send_json({"error": str(e)}, 500)
            except Exception:
                pass

    # -- parameter parsing shared by the endpoints
    def common(self, qs):
        try:
            for k in ("from", "to"):
                if qs.get(k):
                    datetime.strptime(qs[k], "%Y-%m-%d")
        except ValueError:
            raise BadParam("dates must be YYYY-MM-DD")
        people = []
        try:
            for x in (qs.get("people") or "").split(","):
                if x.strip():
                    pid = int(x)
                    if not 0 <= pid < len(self.lib.people):
                        raise ValueError
                    if pid not in people:
                        people.append(pid)
        except ValueError:
            raise BadParam("people must be existing person ids, e.g. 0,1")
        return {
            "frm": qs.get("from") or None, "to": qs.get("to") or None,
            "people": people or list(range(len(self.lib.people))),
            "by": qs.get("by") if qs.get("by") in MEASURES else "plays",
            "half_days": self.num(qs, "half", 0, 0),
            "minplay_s": self.num(qs, "minplay", 0, 0, 600),
        }

    @staticmethod
    def num(qs, key, default, lo=None, hi=None, cast=float):
        try:
            v = cast(qs.get(key) or default)
        except ValueError:
            raise BadParam(f"{key} must be a number")
        if lo is not None:
            v = max(v, lo)
        if hi is not None:
            v = min(v, hi)
        return v

    # -- endpoints
    def api_meta(self, qs):
        self.send_json(self.lib.meta())

    def api_tracks(self, qs):
        c = self.common(qs)
        try:
            weights = [float(x) for x in (qs.get("w") or "").split(",") if x.strip()]
        except ValueError:
            raise BadParam("w must be comma-separated numbers")
        self.send_json(self.lib.query(
            c["frm"], c["to"], qs.get("q", ""), qs.get("sort", "total"),
            self.num(qs, "page", 1, 1, cast=int), self.num(qs, "size", 48, 1, 500, cast=int),
            self.num(qs, "min", 0, 0) * 60000, c["half_days"], c["people"], weights, c["by"],
            qs.get("common", "1") != "0", qs.get("formula", "entropy"), qs.get("norm", "0") == "1",
            qs.get("level", "track"), qs.get("view", "top"), self.num(qs, "gap", 365, 1),
            c["minplay_s"], qs.get("cap", "")))

    def api_detail(self, qs):
        c = self.common(qs)
        d = self.lib.detail(qs.get("k", ""), c["frm"], c["to"], c["people"], c["minplay_s"])
        if d is None:
            return self.send_json({"error": "Unknown item"}, 404)
        self.send_json(d)

    def api_fun(self, qs):
        c = self.common(qs)
        self.send_json(self.lib.fun(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                    int(c["minplay_s"] * 1000), qs.get("era", "month")))

    def api_music(self, qs):
        c = self.common(qs)
        self.send_json(self.lib.music(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                      int(c["minplay_s"] * 1000), self.meta))

    def api_preview(self, qs):
        tid = self._track_key(qs)
        if tid is None:
            return
        url = self.meta.preview(tid)
        if not url:
            return self.send_json({"error": "No preview found"}, 404)
        if qs.get("audio") == "1":                        # the clip itself, same-origin, so the page can cut it precisely
            with Handler.clip_lock:
                hit = Handler.clips.get(url)
                if hit:
                    Handler.clips.move_to_end(url)
            if not hit:
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=15) as r:   # not limited by NET: a different server
                        hit = (r.read(8_000_000), r.headers.get("Content-Type", "audio/mp4"))
                except Exception as e:
                    return self.send_json({"error": f"Couldn't fetch the clip: {e}"}, 502)
                with Handler.clip_lock:
                    Handler.clips[url] = hit
                    while len(Handler.clips) > 60:     # keep the last 60 clips in memory (~1 MB each)
                        Handler.clips.popitem(last=False)
            return self.send(200, hit[0], hit[1], {"Cache-Control": "public, max-age=86400"})
        self.send_json({"url": url})

    def api_artists(self, qs):
        self.send_json({"artists": self.lib.find_artists(qs.get("q", ""))})

    def api_hidden(self, qs):
        """Hidden artists: ?add=<artist key> / ?remove=<key> / ?clear=1 (saved to a file).
        Focus ("only these artists"): ?only=<key> / ?only_remove=<key> / ?only_clear=1 (until restart).
        Always returns the current lists."""
        keys, only = set(self.lib.hidden), set(self.lib.only)
        for param in ("add", "only"):
            if qs.get(param) and not self.lib.is_artist_key(qs[param]):
                raise BadParam(f"{param} must be an artist key, like a:radiohead")
        if qs.get("add"):
            keys.add(qs["add"])
            only.discard(qs["add"])
        if qs.get("remove"):
            keys.discard(qs["remove"])
        if qs.get("clear") == "1":
            keys = set()
        if qs.get("only"):
            only.add(qs["only"])
            keys.discard(qs["only"])
        if qs.get("only_remove"):
            only.discard(qs["only_remove"])
        if qs.get("only_clear") == "1":
            only = set()
        if keys != set(self.lib.hidden) or only != set(self.lib.only):
            t0 = time.time()
            saved = keys != set(self.lib.hidden)
            self.lib.set_hidden(keys, only)
            if saved:
                save_hidden(Handler.hidden_path, self.lib)
            m = self.lib.meta()
            print(f"Hidden: {', '.join(x['title'] for x in m['hidden']) or 'none'}; "
                  f"only: {', '.join(x['title'] for x in m['only']) or 'everyone'} "
                  f"({self.lib.hidden_tracks:,} songs left out, {time.time() - t0:.1f}s)")
        m = self.lib.meta()
        self.send_json({"hidden": m["hidden"], "only": m["only"], "hidden_tracks": m["hidden_tracks"]})

    def api_extras(self, qs):
        c = self.common(qs)
        part = qs.get("part", "all")
        if part not in ("all", "taste", "sync", "unusual"):
            raise BadParam("part must be taste, sync, unusual or all")
        self.send_json(self.lib.extras(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                       int(c["minplay_s"] * 1000), part))

    def api_roulette(self, qs):
        c = self.common(qs)
        self.send_json({"songs": self.lib._roulette(c["people"][0], int(c["minplay_s"] * 1000))})

    def api_versus(self, qs):
        """?a=<person id>&b=<person id>&artist=<name or a:key> (plus from/to); without artist: suggestions."""
        c = self.common(qs)
        try:
            a, b = int(qs.get("a", 0)), int(qs.get("b", 1))
        except ValueError:
            raise BadParam("a and b must be person ids")
        if a == b or not (0 <= a < len(self.lib.people) and 0 <= b < len(self.lib.people)):
            raise BadParam("pick two different people")
        lo, hi = day_to_ts(c["frm"]), day_to_ts(c["to"], end=True)
        if not (qs.get("artist") or "").strip():
            if qs.get("overlap") == "1":
                (fa, la), (fb, lb) = _data_span(self.lib, a), _data_span(self.lib, b)
                if max(fa, fb) < min(la, lb):
                    lo = max(lo or 0, fa, fb)
                    hi = min(hi or float("inf"), min(la, lb) + 1)
            return self.send_json({"suggestions": versus_suggestions(self.lib, a, b, lo, hi)})
        d = versus(self.lib, qs["artist"].strip(), a, b, lo, hi, qs.get("overlap") == "1")
        if d is None:
            return self.send_json({"error": f"Nobody has played {qs['artist'].strip()}"}, 404)
        self.send_json(d)

    # -- concerts
    def _people_param(self, qs):
        pids = []
        for x in (qs.get("people") or "").split(","):
            if x.strip().isdigit() and int(x) < len(self.lib.people) and int(x) not in pids:
                pids.append(int(x))
        return pids or list(range(len(self.lib.people)))

    def _concert_pids(self, c):
        pids = [self.lib.people.index(n) for n in c.get("people") or [] if n in self.lib.people]
        return pids or list(range(len(self.lib.people)))

    def api_concerts(self, qs):
        """Upcoming (and past) concerts. add=1&artist=&date=YYYY-MM-DD&city=&people=0,1 / remove=<id>."""
        if qs.get("add"):
            artist, date = (qs.get("artist") or "").strip(), qs.get("date") or ""
            if not artist:
                raise BadParam("artist is required")
            try:
                datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                raise BadParam("date must be YYYY-MM-DD")
            n = norm_artist(artist, True)
            artist = self.lib.credit_title.get(n, artist)      # the name as it appears in your history
            self.concerts.add(artist, date, (qs.get("city") or "").strip()[:80],
                              [self.lib.people[p] for p in self._people_param(qs)])
        if qs.get("remove"):
            self.concerts.remove(qs["remove"])
        today = datetime.now().date().isoformat()
        out = []
        with Handler.data_lock.read():
            for c in sorted(self.concerts.all(), key=lambda c: c["date"]):
                pids = self._concert_pids(c)
                days = (datetime.strptime(c["date"], "%Y-%m-%d").date() - datetime.now().date()).days
                out.append({**c, "people": pids, "days": days, "past": c["date"] < today,
                            "stats": concert_summary(self.lib, c["artist"], pids)})
        self.send_json({"concerts": out})

    def _cached(self, key, max_age, fetch):
        """External lookups for concerts, kept for a few days (stale copies are used if the lookup fails)."""
        hit, v = self.concert_cache.get(key)
        if hit and v and time.time() - v.get("t", 0) < max_age:
            return v["v"], None
        try:
            val = fetch()
            self.concert_cache.set(key, {"t": time.time(), "v": val})
            self.concert_cache.save()
            return val, None
        except Exception as e:
            return (v or {}).get("v"), str(e)

    def api_concert(self, qs):
        c = self.concerts.get(qs.get("id", ""))
        if not c:
            return self.send_json({"error": "No such concert"}, 404)
        n = norm_artist(c["artist"], True)
        popular, pop_err = self._cached("pop:" + n, 3 * DAY, lambda: fetch_popular(c["artist"]))
        with Handler.data_lock.read():
            pids = self._concert_pids(c)
            prep = concert_prep(self.lib, c["artist"], pids, c["date"], popular)
        days = (datetime.strptime(c["date"], "%Y-%m-%d").date() - datetime.now().date()).days
        self.send_json({**c, "people": pids, "days": days, **prep,
                        "picture": (popular or {}).get("picture"), "fans": (popular or {}).get("fans"),
                        "popular_source": (popular or {}).get("source"),
                        "errors": {"popular": pop_err} if pop_err else {}})

    def api_albums(self, qs):
        c = self.common(qs)
        self.send_json(self.lib.album_stats(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                       int(c["minplay_s"] * 1000), self.meta))

    def api_more(self, qs):
        c = self.common(qs)
        self.send_json(self.lib.more(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                     int(c["minplay_s"] * 1000)))

    def api_clock(self, qs):
        c = self.common(qs)
        self.send_json(self.lib.clock(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                      int(c["minplay_s"] * 1000)))

    def api_time(self, qs):
        c = self.common(qs)
        self.send_json(self.lib.time_travel(day_to_ts(c["frm"]), day_to_ts(c["to"], end=True), tuple(c["people"]),
                                            int(c["minplay_s"] * 1000), datetime.now().toordinal()))

    def api_insights(self, qs):
        c = self.common(qs)
        lo_ts, hi_ts = day_to_ts(c["frm"]), day_to_ts(c["to"], end=True)
        half_s = c["half_days"] * DAY
        today_end = (int(time.time()) // DAY + 1) * DAY
        ref = (min(hi_ts, today_end) if hi_ts is not None else today_end) if half_s else 0.0
        self.send_json(self.lib.insights(lo_ts, hi_ts, tuple(c["people"]), c["by"], half_s, ref,
                                         int(c["minplay_s"] * 1000)))

    def _track_key(self, qs):
        found = self.lib.key_index.get(qs.get("k", ""))
        if not found:
            self.send_json({"error": "Unknown item"}, 404)
            return None
        lvl, gid = found
        tid = gid if lvl.name == "track" else lvl.members[gid][0]
        return tid

    def api_cover(self, qs):
        tid = self._track_key(qs)
        if tid is None:
            return
        key = self.lib.keys[tid]
        hit, url = self.covers.get(key)
        if not hit:
            artist, title = self.lib.display[tid]
            try:
                url = lookup_cover(self.lib.uris[tid], artist, title, self.lib.apple_ids[tid])
            except Exception as e:
                return self.send_json({"error": f"Cover lookup failed: {e}"}, 503, {"Cache-Control": "no-store"})
            self.covers.set(key, url)
        if url:
            if qs.get("s") == "small":                    # thumbnails for tiny squares (eras grid)
                url = url.replace("600x600bb", "100x100bb").replace("/ab67616d00001e02", "/ab67616d00004851")
            # served from the covers folder (downloaded once), which also keeps it same-origin
            # so cards can be saved as images
            try:
                body, ctype = self.cover_files.get(url)
            except Exception as e:
                if qs.get("proxy") == "1":
                    return self.send_json({"error": f"Couldn't fetch the cover: {e}"}, 502)
                return self.send(302, headers={"Location": url, "Cache-Control": "no-store"})
            self.send(200, body, ctype, {"Cache-Control": "public, max-age=2592000, immutable"})
        else:
            self.send_json({"error": "No cover found"}, 404, {"Cache-Control": "public, max-age=86400"})

    def api_lyrics(self, qs):
        found = self.lib.key_index.get(qs.get("k", ""))
        if not found or found[0].name != "track":
            return self.send_json({"error": "Lyrics are only available for songs"}, 404)
        tid = found[1]
        key = self.lib.keys[tid]
        hit, text = self.lyrics.get(key)
        if not hit:
            artist, title = self.lib.display[tid]
            try:
                text = lookup_lyrics(artist, title)
            except Exception as e:
                return self.send_json({"error": f"Couldn't reach lrclib.net: {e}"}, 502)
            self.lyrics.set(key, text)
        self.send_json({"text": text or None})

    # -- static files
    def static(self, path):
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        full = os.path.realpath(os.path.join(self.web_root, rel))
        if not full.startswith(self.web_root + os.sep) or not os.path.isfile(full):
            return self.send_json({"error": "Not found"}, 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            self.send(200, fh.read(), ctype, {"Cache-Control": "no-cache"})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--person", nargs="+", action="append", default=[], metavar=("NAME", "PATH"),
                    help="a person's name followed by their export files and/or folders "
                         "(Spotify, Tidal and Apple Music are recognized automatically); "
                         "repeat for each person")
    ap.add_argument("--spotify", nargs="*", default=[], help="Spotify JSON files and/or folders (for --name)")
    ap.add_argument("--tidal", nargs="*", default=[], help="Tidal CSV files and/or folders (for --name)")
    ap.add_argument("--name", default="Me", help="whose data --spotify/--tidal are (default: Me)")
    ap.add_argument("--tz", help="time zone for the listening clock, e.g. Europe/Bucharest "
                                 "(default: this computer's; Tidal rows use their own time_zone column)")
    ap.add_argument("--tidal-times-local", action="store_true",
                    help="Tidal's entry_date is already local time (don't convert it for the clock)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--web", default=os.path.join(HERE, "web"), help="folder with index.html, app.js, style.css")
    ap.add_argument("--covers-cache", default="covers_cache.json")
    ap.add_argument("--covers-dir", default="covers", help="folder where cover images are saved after the first download")
    ap.add_argument("--lyrics-cache", default="lyrics_cache.json")
    ap.add_argument("--meta-cache", default="meta_cache.json", help="genres, years, lengths, previews")
    ap.add_argument("--hidden", default="hidden_artists.json", help="artists left out of all stats (edited from the page)")
    ap.add_argument("--concerts", default="concerts.json", help="your upcoming concerts (edited from the page)")
    ap.add_argument("--no-music-info", action="store_true", help="don't look up genres/years/previews in the background")
    ap.add_argument("--strict", action="store_true",
                    help="exact name matching (don't merge 'feat.'/'Remastered'/accent variants)")
    ap.add_argument("--open", action="store_true", help="open the page in your browser")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every request")
    args = ap.parse_args()
    if not args.spotify and not args.tidal and not args.person:
        ap.error("give --person NAME PATH... (repeatable), or --spotify / --tidal")

    tz = None
    if args.tz:
        if not ZoneInfo:
            ap.error("--tz needs Python 3.9+")
        try:
            tz = ZoneInfo(args.tz)
        except Exception:
            ap.error(f"unknown time zone: {args.tz}")

    lib = Library(fuzzy=not args.strict, tz=tz, tidal_local=args.tidal_times_local)
    if args.spotify or args.tidal:
        pid = lib.person(args.name)
        print(f"{args.name}:")
        load_person(args.spotify + args.tidal, lib, pid)
    for name, *paths in args.person:
        if not paths:
            ap.error(f"--person {name}: give at least one file or folder after the name")
        pid = lib.person(name)
        print(f"{name}:")
        load_person(paths, lib, pid)
    t0 = time.time()
    hidden = load_hidden(args.hidden)
    lib.finalize(hidden)
    Handler.hidden_path = args.hidden
    m = lib.meta()
    print(f"Indexed {m['tracks']:,} songs, {m['artists']:,} artists, {m['albums']:,} albums "
          f"in {time.time() - t0:.1f}s; history {m['first']} to {m['last']}")
    if lib.undated:
        print(f"  ! {lib.undated:,} plays had no readable date; they only count toward 'all time'")
    if lib.hidden:
        print(f"Hidden artists: {', '.join(h['title'] for h in m['hidden'])} ({lib.hidden_tracks:,} songs left out)")

    Handler.lib = lib
    Handler.covers = JsonCache(args.covers_cache)
    Handler.cover_files = CoverFiles(args.covers_dir)
    Handler.lyrics = JsonCache(args.lyrics_cache)
    Handler.meta = MetaStore(lib, args.meta_cache)
    Handler.concerts = ConcertStore(args.concerts)
    Handler.concert_cache = JsonCache("concert_cache.json")
    for k in [k for k in Handler.concert_cache.data if k.startswith("set:")]:   # never keep setlists around
        del Handler.concert_cache.data[k]
        Handler.concert_cache.dirty += 1
    Handler.concert_cache.save()
    if not args.no_music_info:
        Handler.meta.start()
    Handler.web_root = os.path.realpath(args.web)
    Handler.verbose = args.verbose
    if not os.path.isfile(os.path.join(Handler.web_root, "index.html")):
        sys.exit(f"Can't find index.html in {Handler.web_root} (use --web to point at it)")

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '') else args.host}:{args.port}/"
    print(f"Serving on {url}  (Ctrl+C to stop)")
    if args.open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping, saving caches…")
    finally:
        Handler.covers.save()
        Handler.lyrics.save()
        Handler.meta.cache.save()
        srv.server_close()


if __name__ == "__main__":
    main()
