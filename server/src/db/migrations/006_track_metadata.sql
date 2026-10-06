ALTER TABLE tracks ADD COLUMN album_artist TEXT NOT NULL DEFAULT 'Unknown Artist';
ALTER TABLE tracks ADD COLUMN track_number INTEGER;
ALTER TABLE tracks ADD COLUMN year INTEGER;
ALTER TABLE tracks ADD COLUMN genre TEXT;
UPDATE tracks SET album_artist = artist;
ALTER TABLE tracks ADD COLUMN cover_version INTEGER NOT NULL DEFAULT 1;
