import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

class get_conn:
    def __enter__(self):
        self.conn = psycopg2.connect(
            os.getenv("DATABASE_URL"),
            cursor_factory=RealDictCursor,
            connect_timeout=10
        )
        return self.conn
    def __exit__(self, *args):
        if args[0] is None:
            self.conn.commit()
        else:
            self.conn.rollback()
        self.conn.close()

def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS library (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    artist TEXT,
                    thumbnail TEXT,
                    video_id TEXT,
                    status TEXT DEFAULT 'ready',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS favourites (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    artist TEXT,
                    thumbnail TEXT,
                    video_id TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS playlist_songs (
                    playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
                    track_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    artist TEXT,
                    thumbnail TEXT,
                    video_id TEXT,
                    position INTEGER DEFAULT 0,
                    PRIMARY KEY (playlist_id, track_id)
                );
            """)
        conn.commit()
    print("DB ready")
