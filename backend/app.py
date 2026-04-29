import os, re, threading, time, requests
from flask import Flask, request, jsonify, redirect, Response
from flask_cors import CORS
from dotenv import load_dotenv
import yt_dlp
from ytmusicapi import YTMusic
from db import get_conn, init_db

load_dotenv()
PORT = int(os.getenv("PORT", 7842))

stream_cache = {}
CACHE_TTL = 5.5 * 60 * 60

COOKIES_FILE = os.path.join(os.path.dirname(__file__), "cookies.txt")

YDL_OPTS = {
    "quiet": True, "no_warnings": True, "default_search": "ytsearch1",
    "noplaylist": True, "socket_timeout": 30,
    "format": "bestaudio/best",
    "extractor_args": {
        "youtube": {
            "player_client": ["android_vr"],
        }
    },
}

if os.path.exists(COOKIES_FILE):
    YDL_OPTS["cookiefile"] = COOKIES_FILE

def extract_info_safe(url):
    with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
        return ydl.extract_info(url, download=False)

def clean_title(title):
    title = re.split(r'\s*\|\s*', title)[0]
    title = re.sub(r'\s*\(.*?\)', '', title)
    title = re.sub(r'\s*\[.*?\]', '', title)
    return re.sub(r'\s{2,}', ' ', title).strip()

ytmusic = YTMusic()
app = Flask(__name__)
CORS(app, origins=["https://harsh24276.github.io", "http://localhost:5500", "http://127.0.0.1:5500", "null", "*"])
threading.Thread(target=init_db, daemon=True).start()

# ── Library ──────────────────────────────────────────────
_lib_cache = {"data": None}

@app.route("/library")
def get_library():
    if _lib_cache["data"] is not None:
        return jsonify(_lib_cache["data"])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, artist, thumbnail, video_id AS \"videoId\", status FROM library ORDER BY created_at")
            _lib_cache["data"] = [dict(r) for r in cur.fetchall()]
    return jsonify(_lib_cache["data"])

def _invalidate_lib():
    _lib_cache["data"] = None

@app.route("/add_yt", methods=["POST"])
def add_yt():
    data = request.json
    name = clean_title(data.get("name", ""))
    artist, thumb, video_id = data.get("artist"), data.get("thumbnail"), data.get("videoId")
    tid = f"id_{int(time.time())}"
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO library (id, name, artist, thumbnail, video_id, status) VALUES (%s,%s,%s,%s,%s,'ready') ON CONFLICT (id) DO NOTHING",
                    (tid, name, artist, thumb, video_id)
                )
            conn.commit()
        _invalidate_lib()
        threading.Thread(target=_prefetch_stream, args=(tid, video_id), daemon=True).start()
        return jsonify({"ok": True, "id": tid, "track": {"id": tid, "name": name, "artist": artist, "thumbnail": thumb, "videoId": video_id, "status": "ready"}})
    except Exception as e:
        return jsonify({"ok": False}), 500

def _prefetch_stream(tid, video_id):
    try:
        url = f"https://www.youtube.com/watch?v={video_id}"
        info = extract_info_safe(url)
        video = info["entries"][0] if "entries" in info else info
        stream_url = video.get("url")
        if stream_url:
            stream_cache[tid] = (stream_url, time.time() + CACHE_TTL)
            print(f"⚡ Pre-cached stream for {tid}")
    except Exception as e:
        print(f"⚠️ Prefetch failed: {e}")

@app.route("/delete/<id>", methods=["DELETE"])
def delete_song(id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM library WHERE id=%s", (id,))
        conn.commit()
    _invalidate_lib()
    return jsonify({"ok": True})

# ── Favourites ───────────────────────────────────────────
@app.route("/favourites")
def get_favourites():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, artist, thumbnail, video_id AS \"videoId\" FROM favourites ORDER BY created_at")
            return jsonify([dict(r) for r in cur.fetchall()])

@app.route("/favourites", methods=["POST"])
def add_favourite():
    t = request.json
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO favourites (id, name, artist, thumbnail, video_id) VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                (t["id"], t["name"], t.get("artist"), t.get("thumbnail"), t.get("videoId"))
            )
        conn.commit()
    return jsonify({"ok": True})

@app.route("/favourites/<id>", methods=["DELETE"])
def remove_favourite(id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM favourites WHERE id=%s", (id,))
        conn.commit()
    return jsonify({"ok": True})

# ── Playlists ─────────────────────────────────────────────
@app.route("/playlists")
def get_playlists():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM playlists ORDER BY created_at")
            pls = [dict(r) for r in cur.fetchall()]
            for pl in pls:
                cur.execute(
                    "SELECT track_id AS id, name, artist, thumbnail, video_id AS \"videoId\" FROM playlist_songs WHERE playlist_id=%s ORDER BY position",
                    (pl["id"],)
                )
                pl["songs"] = [dict(r) for r in cur.fetchall()]
    return jsonify(pls)

@app.route("/playlists", methods=["POST"])
def create_playlist():
    data = request.json
    pid = f"pl_{int(time.time())}"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO playlists (id, name) VALUES (%s,%s)", (pid, data["name"]))
        conn.commit()
    return jsonify({"ok": True, "id": pid})

@app.route("/playlists/<pid>", methods=["DELETE"])
def delete_playlist(pid):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM playlists WHERE id=%s", (pid,))
        conn.commit()
    return jsonify({"ok": True})

@app.route("/playlists/<pid>/songs", methods=["POST"])
def add_to_playlist(pid):
    t = request.json
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(position)+1,0) FROM playlist_songs WHERE playlist_id=%s", (pid,))
            pos = cur.fetchone()["coalesce"]
            cur.execute(
                "INSERT INTO playlist_songs (playlist_id, track_id, name, artist, thumbnail, video_id, position) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (pid, t["id"], t["name"], t.get("artist"), t.get("thumbnail"), t.get("videoId"), pos)
            )
        conn.commit()
    return jsonify({"ok": True})

@app.route("/playlists/<pid>/songs/<tid>", methods=["DELETE"])
def remove_from_playlist(pid, tid):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM playlist_songs WHERE playlist_id=%s AND track_id=%s", (pid, tid))
        conn.commit()
    return jsonify({"ok": True})

# ── Search / Trending / Artist ────────────────────────────
@app.route("/search_yt", methods=["POST"])
def search_yt():
    query = request.json.get("query")
    if not query: return jsonify([])
    try:
        raw = ytmusic.search(query, filter="songs", limit=15)
        results = []
        for t in raw:
            vid_id = t.get("videoId", "")
            if not vid_id: continue
            thumbs = t.get("thumbnails") or []
            thumb = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg"
            artists = t.get("artists") or []
            artist = artists[0]["name"] if artists else "Unknown"
            results.append({"name": clean_title(t.get("title", "")), "artist": artist, "thumbnail": thumb, "videoId": vid_id})
        return jsonify(results)
    except Exception as ex:
        print(f"❌ Search error: {ex}")
        return jsonify([])

_trending_cache = {"data": None, "time": 0}

@app.route("/trending")
def trending():
    if _trending_cache["data"] and time.time() - _trending_cache["time"] < 3600:
        return jsonify(_trending_cache["data"])
    try:
        pl = ytmusic.get_playlist('PL4fGSI1pDJn5RgLW0Sb_zECecWdH_4zOX', limit=30)
        results = []
        for t in (pl.get('tracks') or []):
            vid_id = t.get('videoId', '') if t else ''
            if not vid_id: continue
            thumbs = t.get('thumbnails') or []
            thumb = thumbs[-1]['url'] if thumbs else f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
            artists = t.get('artists') or []
            results.append({'name': clean_title(t.get('title', '')), 'artist': (artists[0]['name'] if artists else 'Unknown'), 'thumbnail': thumb, 'videoId': vid_id})
        _trending_cache["data"] = results
        _trending_cache["time"] = time.time()
        return jsonify(results)
    except Exception as ex:
        print(f"❌ Trending error: {ex}")
        return jsonify([])

@app.route("/artist_songs", methods=["POST"])
def artist_songs():
    artist = request.json.get("artist")
    if not artist: return jsonify([])
    try:
        artist_search = ytmusic.search(artist, filter="artists", limit=1)
        results = []
        if artist_search:
            artist_id = artist_search[0].get("browseId")
            if artist_id:
                artist_data = ytmusic.get_artist(artist_id)
                songs_data = artist_data.get("songs", {})
                browse_id = songs_data.get("browseId", "")
                playlist_id = browse_id.replace("VL", "", 1) if browse_id.startswith("VL") else browse_id
                if playlist_id:
                    pl = ytmusic.get_playlist(playlist_id, limit=100)
                    for t in (pl.get("tracks") or []):
                        if not t: continue
                        vid_id = t.get("videoId", "")
                        if not vid_id: continue
                        thumbs = t.get("thumbnails") or []
                        thumb = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                        t_artists = t.get("artists") or []
                        results.append({"name": clean_title(t.get("title", "")), "artist": (t_artists[0]["name"] if t_artists else artist), "thumbnail": thumb, "videoId": vid_id})
        if not results:
            raw = ytmusic.search(artist, filter="songs", limit=50)
            for t in raw:
                vid_id = t.get("videoId", "")
                if not vid_id: continue
                t_artists = t.get("artists") or []
                t_artist = t_artists[0]["name"] if t_artists else ""
                if artist.lower() not in t_artist.lower() and t_artist.lower() not in artist.lower(): continue
                thumbs = t.get("thumbnails") or []
                thumb = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                results.append({"name": clean_title(t.get("title", "")), "artist": t_artist or artist, "thumbnail": thumb, "videoId": vid_id})
        return jsonify(results)
    except Exception as ex:
        print(f"❌ Artist songs error: {ex}")
        return jsonify([])

# ── Streaming ─────────────────────────────────────────────
def _get_stream_url(vid_id):
    cached = stream_cache.get(vid_id)
    if cached and time.time() < cached[1]:
        return cached[0]
    info = extract_info_safe(f"https://www.youtube.com/watch?v={vid_id}")
    video = info["entries"][0] if "entries" in info else info
    stream_url = video.get("url")
    if stream_url:
        stream_cache[vid_id] = (stream_url, time.time() + CACHE_TTL)
    return stream_url

def _proxy_stream(stream_url):
    range_header = request.headers.get("Range")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
    }
    if range_header:
        headers["Range"] = range_header
    r = requests.get(stream_url, headers=headers, stream=True, timeout=60)
    status = r.status_code
    resp_headers = {
        "Content-Type": r.headers.get("Content-Type", "audio/webm"),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
    }
    if "Content-Range" in r.headers:
        resp_headers["Content-Range"] = r.headers["Content-Range"]
    if "Content-Length" in r.headers:
        resp_headers["Content-Length"] = r.headers["Content-Length"]
    return Response(
        r.iter_content(chunk_size=65536),
        status=status,
        headers=resp_headers,
        direct_passthrough=True
    )

@app.route("/stream_direct/<vid_id>")
def stream_direct(vid_id):
    try:
        stream_url = _get_stream_url(vid_id)
        if not stream_url:
            return jsonify({"error": "No stream URL"}), 500
        return _proxy_stream(stream_url)
    except Exception as e:
        print(f"Stream error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/stream/<id>")
def stream(id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM library WHERE id=%s", (id,))
            track = cur.fetchone()
    if not track:
        return jsonify({"error": "Track not found"}), 404
    try:
        vid_id = track.get("video_id")
        stream_url = _get_stream_url(vid_id)
        if not stream_url:
            return jsonify({"error": "Could not extract stream URL"}), 500
        return _proxy_stream(stream_url)
    except Exception as e:
        print(f"Stream error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(port=PORT, debug=True, use_reloader=False)
