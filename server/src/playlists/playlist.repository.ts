import type Database from "better-sqlite3";
import type { TrackRecord } from "../tracks/track.types.js";

export type Playlist = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  tracks: TrackRecord[];
};

type PlaylistRecord = Omit<Playlist, "tracks">;

export class PlaylistRepository {
  constructor(private readonly database: Database.Database) {}

  list(): Playlist[] {
    const playlists = this.database
      .prepare(
        "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM playlists ORDER BY name COLLATE NOCASE",
      )
      .all() as PlaylistRecord[];
    return playlists.map((playlist) => ({
      ...playlist,
      tracks: this.getTrackRecords(playlist.id),
    }));
  }

  findById(id: string): Playlist | undefined {
    const playlist = this.database
      .prepare(
        "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM playlists WHERE id = ?",
      )
      .get(id) as PlaylistRecord | undefined;
    return playlist ? { ...playlist, tracks: this.getTrackRecords(id) } : undefined;
  }

  create(id: string, name: string): void {
    this.database.prepare("INSERT INTO playlists (id, name) VALUES (?, ?)").run(id, name);
  }

  rename(id: string, name: string): void {
    this.database
      .prepare("UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(name, id);
  }

  delete(id: string): void {
    this.database.prepare("DELETE FROM playlists WHERE id = ?").run(id);
  }

  hasTrack(id: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM tracks WHERE id = ?").get(id));
  }

  addTrack(playlistId: string, trackId: string): boolean {
    const nextPosition = this.database
      .prepare(
        "SELECT COALESCE(MAX(position) + 1, 0) AS position FROM playlist_tracks WHERE playlist_id = ?",
      )
      .get(playlistId) as { position: number };
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
      )
      .run(playlistId, trackId, nextPosition.position);
    return result.changes > 0;
  }

  removeTrack(playlistId: string, trackId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?")
      .run(playlistId, trackId);
    if (result.changes) this.normalizePositions(playlistId);
    return result.changes > 0;
  }

  reorder(playlistId: string, trackIds: string[]): boolean {
    const existing = this.database
      .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?")
      .all(playlistId)
      .map((row) => (row as { track_id: string }).track_id);
    if (
      existing.length !== trackIds.length ||
      new Set(trackIds).size !== trackIds.length ||
      existing.some((id) => !trackIds.includes(id))
    ) {
      return false;
    }

    const update = this.database.prepare(
      "UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?",
    );
    this.database.transaction(() => {
      this.database
        .prepare("UPDATE playlist_tracks SET position = position + ? WHERE playlist_id = ?")
        .run(existing.length, playlistId);
      trackIds.forEach((trackId, position) => update.run(position, playlistId, trackId));
      this.database
        .prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(playlistId);
    })();
    return true;
  }

  isFavorite(trackId: string): boolean {
    return Boolean(
      this.database.prepare("SELECT 1 FROM favorites WHERE track_id = ?").get(trackId),
    );
  }

  addFavorite(trackId: string): void {
    this.database.prepare("INSERT OR IGNORE INTO favorites (track_id) VALUES (?)").run(trackId);
  }

  removeFavorite(trackId: string): void {
    this.database.prepare("DELETE FROM favorites WHERE track_id = ?").run(trackId);
  }

  listFavorites(): TrackRecord[] {
    return this.database
      .prepare(
        "SELECT tracks.* FROM tracks JOIN favorites ON favorites.track_id = tracks.id ORDER BY favorites.created_at DESC",
      )
      .all() as TrackRecord[];
  }

  private getTrackRecords(playlistId: string): TrackRecord[] {
    return this.database
      .prepare(
        `SELECT tracks.* FROM tracks
         JOIN playlist_tracks ON playlist_tracks.track_id = tracks.id
         WHERE playlist_tracks.playlist_id = ?
         ORDER BY playlist_tracks.position`,
      )
      .all(playlistId) as TrackRecord[];
  }

  private normalizePositions(playlistId: string): void {
    const ids = this.database
      .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position")
      .all(playlistId)
      .map((row) => (row as { track_id: string }).track_id);
    const update = this.database.prepare(
      "UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?",
    );
    const normalize = this.database.transaction(() =>
      ids.forEach((id, position) => update.run(position, playlistId, id)),
    );
    normalize();
  }
}
