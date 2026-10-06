ALTER TABLE tracks ADD COLUMN content_hash TEXT;
CREATE UNIQUE INDEX tracks_content_hash_idx ON tracks (content_hash) WHERE content_hash IS NOT NULL;
