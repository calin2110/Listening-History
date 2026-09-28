#!/usr/bin/env python3
"""
Local server for your merged Spotify + Tidal listening history.

    python server.py --spotify ./spotify_export --tidal ./tidal_export
    python server.py --spotify ./spotify_export --tidal history.csv --port 8080 --open

Then open http://127.0.0.1:8000 in your browser.

--spotify / --tidal accept files and/or folders (searched recursively for
.json / .csv). Only the standard library is used.

API (all GET, JSON unless noted):
  /api/meta                         date range of your history, years, counts
  /api/tracks?from=&to=&q=&sort=&page=&size=&min=&half=
                                    totals per artist + track in a time frame
                                    from/to: YYYY-MM-DD (inclusive), empty = open
                                    sort: total|spotify|tidal|plays|last|artist|title
                                    min: minimum total minutes in the frame (e.g. 20)
                                    half: decay half-life in days (0 = no decay);
                                          adds a "score" per track, sort=score ranks by it
  /api/cover?k=<track key>          302 redirect to the cover image (cached)
  /api/lyrics?k=<track key>         {"text": "..."} or {"text": null} (cached)
"""

import argparse
import bisect
import csv
import glob
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
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UA = "Mozilla/5.0 (music-stats local server)"
HERE = os.path.dirname(os.path.abspath(__file__))

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


def search_text(s):
    return _strip_accents(_base_norm(s))


# -------------------------------------------------------------- timestamps --

_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
            "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M:%S", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d")


def parse_ts(s):
    """Return a UTC epoch (float) or None. Naive times are treated as UTC."""
    if s is None:
        return None
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
    return d + 86400 if end else d                   # "to" is inclusive


# ----------------------------------------------------------------- library --

SPOTIFY, TIDAL = 0, 1


class Library:
    def __init__(self, fuzzy=True):
        self.fuzzy = fuzzy
        self.key_to_id = {}
        self.keys, self.names, self.uris, self.albums = [], [], [], []
        self.raw = []                                  # (ts, track_id, source, ms)
        self.undated = 0

    def _track(self, artist, title):
        key = (norm_artist(artist, self.fuzzy), norm_title(title, self.fuzzy))
        tid = self.key_to_id.get(key)
        if tid is None:
            tid = self.key_to_id[key] = len(self.keys)
            self.keys.append("\t".join(key))
            self.names.append(Counter())
            self.uris.append(None)
            self.albums.append(None)
        return tid

    def add(self, ts, artist, title, ms, source, uri=None, album=None):
        tid = self._track(artist, title)
        self.names[tid][(artist, title)] += ms + 1
        if uri and not self.uris[tid]:
            self.uris[tid] = uri
        if album and not self.albums[tid]:
            self.albums[tid] = album
        t = parse_ts(ts)
        if t is None:
            self.undated += 1
            t = 0.0                                    # only shows up in "all time"
        self.raw.append((t, tid, source, ms))

    def finalize(self):
        self.raw.sort()
        self.ts = [p[0] for p in self.raw]
        self.display = [n.most_common(1)[0][0] for n in self.names]
        self.hay = [search_text(f"{a} {t} {self.albums[i] or ''}") for i, (a, t) in enumerate(self.display)]
        self.sort_artist = [search_text(a) for a, _ in self.display]
        self.sort_title = [search_text(t) for _, t in self.display]
        self.aggregate = lru_cache(maxsize=64)(self._aggregate)
        self.id_by_key = {k: i for i, k in enumerate(self.keys)}

    # -- queries
    def _aggregate(self, lo_ts, hi_ts, half_s=0.0, ref=0.0):
        """Totals per track for plays in [lo_ts, hi_ts).

        With a half-life (half_s, in seconds) each play also adds a decayed
        score: ms * 0.5 ** (age / half_s), where age is measured back from
        `ref`. The score is expressed in minutes, so 1 point = one minute
        listened at the reference moment.
        """
        lo = bisect.bisect_left(self.ts, lo_ts) if lo_ts is not None else 0
        hi = bisect.bisect_left(self.ts, hi_ts) if hi_ts is not None else len(self.ts)
        k = math.log(2) / half_s if half_s else 0.0
        acc = {}
        for t, tid, src, ms in self.raw[lo:hi]:
            a = acc.get(tid)
            if a is None:
                a = acc[tid] = [0, 0, 0, 0, t, t, 0.0]  # sp_ms, td_ms, sp_n, td_n, first, last, score
            a[src] += ms
            a[2 + src] += 1
            a[5] = t                                   # raw is sorted, so this is the latest
            a[6] += ms * math.exp(-k * max(ref - t, 0.0)) if k else ms
        rows = [(tid, a[0] + a[1], a[0], a[1], a[2] + a[3], a[4], a[5], a[6] / 60000)
                for tid, a in acc.items()]
        rows.sort(key=lambda r: -r[1])
        return rows            # (tid, total, spotify, tidal, plays, first, last, score)

    def query(self, frm, to, q, sort, page, size, min_ms=0, half_days=0):
        lo_ts, hi_ts = day_to_ts(frm), day_to_ts(to, end=True)
        half_s = half_days * 86400
        # decay is measured back from the end of the frame, or from the end of today
        today_end = (int(time.time()) // 86400 + 1) * 86400
        ref = min(hi_ts, today_end) if hi_ts is not None else today_end
        all_rows = self.aggregate(lo_ts, hi_ts, half_s, ref if half_s else 0.0)
        rows = [r for r in all_rows if r[1] >= min_ms] if min_ms else all_rows
        totals = {
            "hidden": len(all_rows) - len(rows),       # tracks under the minimum
            "tracks": len(rows),
            "plays": sum(r[4] for r in rows),
            "spotify": sum(r[2] for r in rows),
            "tidal": sum(r[3] for r in rows),
            "score": sum(r[7] for r in rows),
        }
        words = search_text(q).split()
        view = [r for r in rows if all(w in self.hay[r[0]] for w in words)] if words else list(rows)

        keyfn = {
            "total": None,
            "score": lambda r: -r[7],
            "spotify": lambda r: -r[2],
            "tidal": lambda r: -r[3],
            "plays": lambda r: -r[4],
            "last": lambda r: -r[6],
            "artist": lambda r: (self.sort_artist[r[0]], self.sort_title[r[0]]),
            "title": lambda r: (self.sort_title[r[0]], self.sort_artist[r[0]]),
        }.get(sort)
        if keyfn:
            view.sort(key=keyfn)

        pages = max(1, -(-len(view) // size))
        page = min(max(1, page), pages)
        items = []
        for tid, total, sp, td, plays, first, last, score in view[(page - 1) * size: page * size]:
            artist, title = self.display[tid]
            uri = self.uris[tid]
            items.append({
                "key": self.keys[tid], "artist": artist, "title": title, "album": self.albums[tid],
                "total": total, "spotify": sp, "tidal": td, "plays": plays, "score": round(score, 2),
                "first": iso_day(first), "last": iso_day(last),
                "spotify_url": f"https://open.spotify.com/track/{uri.split(':')[-1]}" if uri else None,
            })
        return {"totals": totals, "matched": len(view), "page": page, "pages": pages, "size": size,
                "ref": iso_day(ref - 1), "items": items}

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
            "tracks": len(self.keys),
            "plays": len(self.raw),
            "undated_plays": self.undated,
        }


# ----------------------------------------------------------------- loading --

def expand_paths(paths, ext):
    out = []
    for p in paths:
        if os.path.isdir(p):
            out += sorted(glob.glob(os.path.join(p, "**", f"*{ext}"), recursive=True))
        else:
            out += sorted(glob.glob(p)) or [p]
    return out


def load_spotify(paths, lib):
    files, n = expand_paths(paths, ".json"), 0
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            print(f"  ! skipping {f}: {e}", file=sys.stderr)
            continue
        if not isinstance(data, list):
            continue
        for e in data:
            if not isinstance(e, dict):
                continue
            artist = e.get("master_metadata_album_artist_name")
            title = e.get("master_metadata_track_name")
            ms, ts = e.get("ms_played"), e.get("ts")
            if title is None and "trackName" in e:     # older, basic export format
                artist, title = e.get("artistName"), e.get("trackName")
                ms, ts = e.get("msPlayed"), e.get("endTime")
            if not artist or not title:
                continue                               # podcasts, audiobooks, video
            lib.add(ts, artist, title, int(ms or 0), SPOTIFY,
                    e.get("spotify_track_uri"), e.get("master_metadata_album_album_name"))
            n += 1
    print(f"Spotify: {n:,} plays from {len(files)} file(s)")


def load_tidal(paths, lib):
    files, n = expand_paths(paths, ".csv"), 0
    for f in files:
        with open(f, encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                artist, title = row.get("artist_name"), row.get("track_title")
                if not artist or not title:
                    continue
                try:
                    ms = int(float(row.get("stream_duration_ms") or 0))
                except ValueError:
                    ms = 0
                lib.add(row.get("entry_date"), artist, title, ms, TIDAL)
                n += 1
    print(f"Tidal:   {n:,} plays from {len(files)} file(s)")


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


def http_json(url, retries=3):
    for attempt in range(retries):
        try:
            with NET:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=15) as r:
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


def lookup_cover(uri, artist, title):
    if uri:
        tid = uri.split(":")[-1]
        d = http_json("https://open.spotify.com/oembed?url=" +
                      urllib.parse.quote(f"https://open.spotify.com/track/{tid}", safe=""))
        if d and d.get("thumbnail_url"):
            return d["thumbnail_url"]
    q = urllib.parse.urlencode({"term": f"{artist} {title}", "entity": "song", "limit": 5})
    d = http_json("https://itunes.apple.com/search?" + q)
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

class Handler(BaseHTTPRequestHandler):
    server_version = "MusicStats/1.0"
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
                "/api/cover": self.api_cover, "/api/lyrics": self.api_lyrics,
            }.get(url.path)
            if route:
                return route(qs)
            if url.path.startswith("/api/"):
                return self.send_json({"error": "Unknown endpoint"}, 404)
            return self.static(url.path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            try:
                self.send_json({"error": str(e)}, 500)
            except Exception:
                pass

    # -- endpoints
    def api_meta(self, qs):
        self.send_json(self.lib.meta())

    def api_tracks(self, qs):
        try:
            for k in ("from", "to"):
                if qs.get(k):
                    datetime.strptime(qs[k], "%Y-%m-%d")
            page = int(qs.get("page") or 1)
            size = min(max(int(qs.get("size") or 48), 1), 500)
            min_ms = max(float(qs.get("min") or 0), 0) * 60000
            half_days = max(float(qs.get("half") or 0), 0)
        except ValueError:
            return self.send_json({"error": "Dates must be YYYY-MM-DD; page, size, min and half must be numbers."}, 400)
        self.send_json(self.lib.query(qs.get("from") or None, qs.get("to") or None,
                                      qs.get("q", ""), qs.get("sort", "total"), page, size, min_ms, half_days))

    def _track(self, qs):
        tid = self.lib.id_by_key.get(qs.get("k", ""))
        if tid is None:
            self.send_json({"error": "Unknown track"}, 404)
        return tid

    def api_cover(self, qs):
        tid = self._track(qs)
        if tid is None:
            return
        key = self.lib.keys[tid]
        hit, url = self.covers.get(key)
        if not hit:
            artist, title = self.lib.display[tid]
            try:
                url = lookup_cover(self.lib.uris[tid], artist, title)
            except Exception as e:
                return self.send_json({"error": f"Cover lookup failed: {e}"}, 503, {"Cache-Control": "no-store"})
            self.covers.set(key, url)
        if url:
            self.send(302, headers={"Location": url, "Cache-Control": "public, max-age=604800"})
        else:
            self.send_json({"error": "No cover found"}, 404, {"Cache-Control": "public, max-age=86400"})

    def api_lyrics(self, qs):
        tid = self._track(qs)
        if tid is None:
            return
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
    ap.add_argument("--spotify", nargs="*", default=[], help="Spotify JSON files and/or folders")
    ap.add_argument("--tidal", nargs="*", default=[], help="Tidal CSV files and/or folders")
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
    if not args.spotify and not args.tidal:
        ap.error("give at least one of --spotify / --tidal")

    lib = Library(fuzzy=not args.strict)
    if args.spotify:
        load_spotify(args.spotify, lib)
    if args.tidal:
        load_tidal(args.tidal, lib)
    lib.finalize()
    m = lib.meta()
    print(f"Tracks:  {m['tracks']:,} unique artist + title pairs, history {m['first']} to {m['last']}")
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
