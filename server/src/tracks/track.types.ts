export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  mimeType: string;
  fileSize: number;
  hasCover: boolean;
  coverVersion: number;
  createdAt: string;
  hasLyrics: boolean;
};

export type TrackRecord = {
  id: string;
  storage_name: string;
  original_name: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track_number: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  mime_type: string;
  file_size: number;
  cover_name: string | null;
  cover_version: number;
  content_hash: string | null;
  lyrics_text: string | null;
  lyrics_offset: number;
  created_at: string;
};

export function toTrack(record: TrackRecord): Track {
  return {
    id: record.id,
    title: record.title,
    artist: record.artist,
    album: record.album,
    albumArtist: record.album_artist,
    trackNumber: record.track_number,
    year: record.year,
    genre: record.genre,
    duration: record.duration,
    mimeType: record.mime_type,
    fileSize: record.file_size,
    hasCover: record.cover_name !== null,
    coverVersion: record.cover_version,
    hasLyrics: Boolean(record.lyrics_text?.trim()),
    createdAt: record.created_at,
  };
}
