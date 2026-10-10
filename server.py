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
  /api/time       per person: comebacks, ever-present songs, flings, slow
                  burners, on this day; per pair: who found shared songs first
  /api/cover      ?k=<key>: 302 redirect to the cover image (cached); s=small for a thumbnail
  /api/lyrics     ?k=<track key>: {"text": "..."} or {"text": null} (cached)
"""

import argparse
import array
import bisect
import csv
import glob
import io
import json
import math
import mimetypes
import os
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
from collections import Counter, defaultdict
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
            tzname=None, apple_id=None):
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

    # ------------------------------------------------------------ indexing --
    def finalize(self):
        self.raw.sort(key=lambda p: p[0])
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
        self.match = lru_cache(maxsize=32)(self._match)

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
              view="top", gap_days=365, minplay_s=0):
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
                    "signature": [song(tid, plays_here=n_b, plays=n, own=round(own, 3)) for _, tid, n_b, n, own in sig[:8]],
                    "top": [song(tid, plays_here=n_b) for n_b, tid in top[:5]],
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
            top = lambda xs: [x for _, x in sorted(xs, key=lambda kv: kv[0], reverse=True)[:12]]
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
                              "since": iso_day(start + 30 * DAY), "songs": [x for _, x in rows[:15]]})
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
            "sources": [SOURCES[i] for i in sorted({p[3] for p in self.raw})],
            "people": [{k: v for k, v in ps.items() if k != "last_ts"} for ps in self.person_stats],
            "tracks": len(self.keys),
            "artists": len(self.levels["artist"].keys),
            "albums": len(self.levels["album"].keys),
            "plays": len(self.raw),
            "undated_plays": self.undated,
        }


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
            lib.add(pid, ts, artist, title, int(ms or 0), SPOTIFY,
                    e.get("spotify_track_uri"), e.get("master_metadata_album_album_name"),
                    skipped, f"c:{country}" if country and country != "ZZ" else None)
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
                        tzname=(row.get("time_zone") or "").strip() or None)
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
                events.append((start or 0.0, song, row.get("Album Name") or "", ms, pos,
                               row.get("End Reason Type") or "", row.get("IP Country Code") or "",
                               row.get("UTC Offset In Seconds") or ""))
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
                      "country": e[6], "offset": e[7]})
    stitched = len(events) - len(plays)

    artists = AppleArtists(library, daily)
    n, missing = 0, Counter()
    for p in plays:
        artist = artists.find(p["song"], p["album"])
        if not artist:
            missing[(p["song"], p["album"])] += 1
            continue
        country = p["country"].strip()
        lib.add(pid, p["start"] or None, artist, p["song"], p["ms"], APPLE,
                album=p["album"] or None, skipped=1 if p["reason"] in APPLE_SKIPS else 0,
                place=f"c:{country}" if country else None,
                tzname=f"offset:{p['offset']}" if p["offset"].lstrip("-").isdigit() else None,
                apple_id=artists.track_id(p["song"], p["album"]))
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


def http_json(url, retries=3, timeout=15):
    for attempt in range(retries):
        try:
            with NET:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
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



# ------------------------------------------------------------------ server --

class BadParam(ValueError):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "MusicStats/2.0"
    lib = covers = lyrics = web_root = None
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
                "/api/detail": self.api_detail, "/api/insights": self.api_insights, "/api/fun": self.api_fun, "/api/time": self.api_time, "/api/clock": self.api_clock,
                "/api/cover": self.api_cover, "/api/lyrics": self.api_lyrics,
            }.get(url.path)
            if route:
                return route(qs)
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
            c["minplay_s"]))

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
            self.send(302, headers={"Location": url, "Cache-Control": "public, max-age=604800"})
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
    ap.add_argument("--lyrics-cache", default="lyrics_cache.json")
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
    lib.finalize()
    m = lib.meta()
    print(f"Indexed {m['tracks']:,} songs, {m['artists']:,} artists, {m['albums']:,} albums "
          f"in {time.time() - t0:.1f}s; history {m['first']} to {m['last']}")
    if lib.undated:
        print(f"  ! {lib.undated:,} plays had no readable date; they only count toward 'all time'")

    Handler.lib = lib
    Handler.covers = JsonCache(args.covers_cache)
    Handler.lyrics = JsonCache(args.lyrics_cache)
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
        srv.server_close()


if __name__ == "__main__":
    main()
