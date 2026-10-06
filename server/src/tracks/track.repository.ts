import type Database from "better-sqlite3";
import type { TrackRecord } from "./track.types.js";

export class TrackRepository {
  constructor(private readonly database: Database.Database) {}

  list(search = "", sort = "title"): TrackRecord[] {
    const allowedSorts: Record<string, string> = {
      title: "title COLLATE NOCASE",
      artist: "artist COLLATE NOCASE, title COLLATE NOCASE",
      album: "album COLLATE NOCASE, title COLLATE NOCASE",
      recentlyAdded: "created_at DESC",
    };
    const sortExpression = allowedSorts[sort] ?? allowedSorts.title!;
    const query = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return this.database
      .prepare(
        `SELECT * FROM tracks
         WHERE title LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR artist LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR album LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY ${sortExpression}`,
      )
      .all(query, query, query) as TrackRecord[];
  }

  findById(id: string): TrackRecord | undefined {
    return this.database.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as
      TrackRecord | undefined;
  }

  findByHash(hash: string): TrackRecord | undefined {
    return this.database.prepare("SELECT * FROM tracks WHERE content_hash = ?").get(hash) as
      TrackRecord | undefined;
  }

  create(track: TrackRecord): void {
    this.database
      .prepare(
        `INSERT INTO tracks
         (id, storage_name, original_name, title, artist, album, album_artist, track_number, year, genre, duration, mime_type, file_size, cover_name, cover_version, content_hash, lyrics_text, lyrics_offset)
         VALUES (@id, @storage_name, @original_name, @title, @artist, @album, @album_artist,
                 @track_number, @year, @genre, @duration,
                 @mime_type, @file_size, @cover_name, 1, @content_hash, @lyrics_text, @lyrics_offset)`,
      )
      .run(track);
  }

  updateLyrics(id: string, text: string, offset: number): void {
    this.database
      .prepare("UPDATE tracks SET lyrics_text = ?, lyrics_offset = ? WHERE id = ?")
      .run(text, offset, id);
  }

  updateInfo(id: string, fields: { title: string; artist: string; album: string }): void {
    this.database
      .prepare("UPDATE tracks SET title = ?, artist = ?, album = ? WHERE id = ?")
      .run(fields.title, fields.artist, fields.album, id);
  }

  updateCover(id: string, coverName: string): void {
    this.database
      .prepare("UPDATE tracks SET cover_name = ?, cover_version = cover_version + 1 WHERE id = ?")
      .run(coverName, id);
  }

  delete(id: string): void {
    this.database.prepare("DELETE FROM tracks WHERE id = ?").run(id);
  }
}
