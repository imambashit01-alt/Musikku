CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  duration REAL NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  cover_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX tracks_title_idx ON tracks (title COLLATE NOCASE);
CREATE INDEX tracks_artist_idx ON tracks (artist COLLATE NOCASE);
CREATE INDEX tracks_album_idx ON tracks (album COLLATE NOCASE);
