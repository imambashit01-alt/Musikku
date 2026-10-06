import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import request from "supertest";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import { ensureOwnerAccount } from "../auth/auth.service.js";
import { openDatabase } from "../db/database.js";
import { TrackRepository } from "../tracks/track.repository.js";

const config: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  host: "127.0.0.1",
  databasePath: ":memory:",
  jwtSecret: "test-only-secret-with-at-least-32-characters",
  jwtTtlSeconds: 60 * 60,
  ownerUsername: "owner",
  ownerPassword: "test-password-long-enough",
  clientOrigin: "http://localhost:5173",
  dataDirectory: "./.test-data",
};

let database: Database.Database;
let app: ReturnType<typeof createApp>;
let cookie: string;
let firstTrackId: string;
let secondTrackId: string;

before(async () => {
  database = await openDatabase(":memory:");
  await ensureOwnerAccount(database, config);
  app = createApp(database, config);
  const tracks = new TrackRepository(database);
  firstTrackId = randomUUID();
  secondTrackId = randomUUID();
  for (const [id, title] of [
    [firstTrackId, "First"],
    [secondTrackId, "Second"],
  ] as const) {
    tracks.create({
      id,
      storage_name: `${id}.mp3`,
      original_name: `${title}.mp3`,
      title,
      artist: "Test Artist",
      album: "Test Album",
      album_artist: "Test Artist",
      track_number: null,
      year: null,
      genre: null,
      duration: 5,
      mime_type: "audio/mpeg",
      file_size: 128,
      cover_name: null,
      cover_version: 1,
      content_hash: null,
      lyrics_text: null,
      lyrics_offset: 0,
      created_at: new Date().toISOString(),
    });
  }

  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: config.ownerUsername, password: config.ownerPassword });
  cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  assert.ok(cookie);
});

after(() => database?.close());

test("playlist CRUD, track order, and favorites persist for the owner", async () => {
  const created = await request(app)
    .post("/api/playlists")
    .set("Cookie", cookie)
    .send({ name: "Road trip" });
  assert.equal(created.status, 201);
  const playlistId = created.body.id as string;

  const firstAdd = await request(app)
    .post(`/api/playlists/${playlistId}/tracks`)
    .set("Cookie", cookie)
    .send({ trackId: firstTrackId });
  assert.equal(firstAdd.status, 201);
  const secondAdd = await request(app)
    .post(`/api/playlists/${playlistId}/tracks`)
    .set("Cookie", cookie)
    .send({ trackId: secondTrackId });
  assert.equal(secondAdd.status, 201);

  const duplicate = await request(app)
    .post(`/api/playlists/${playlistId}/tracks`)
    .set("Cookie", cookie)
    .send({ trackId: firstTrackId });
  assert.equal(duplicate.status, 409);

  const reordered = await request(app)
    .patch(`/api/playlists/${playlistId}/tracks`)
    .set("Cookie", cookie)
    .send({ trackIds: [secondTrackId, firstTrackId] });
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.tracks.map((track: { id: string }) => track.id),
    [secondTrackId, firstTrackId],
  );

  const invalidOrder = await request(app)
    .patch(`/api/playlists/${playlistId}/tracks`)
    .set("Cookie", cookie)
    .send({ trackIds: [firstTrackId] });
  assert.equal(invalidOrder.status, 400);

  const favorite = await request(app).post(`/api/favorites/${firstTrackId}`).set("Cookie", cookie);
  assert.equal(favorite.status, 204);
  const favorites = await request(app).get("/api/favorites").set("Cookie", cookie);
  assert.deepEqual(
    favorites.body.map((track: { id: string }) => track.id),
    [firstTrackId],
  );

  const renamed = await request(app)
    .patch(`/api/playlists/${playlistId}`)
    .set("Cookie", cookie)
    .send({ name: "Road trip 2026" });
  assert.equal(renamed.body.name, "Road trip 2026");

  const removedTrack = await request(app)
    .delete(`/api/playlists/${playlistId}/tracks/${secondTrackId}`)
    .set("Cookie", cookie);
  assert.equal(removedTrack.status, 204);

  await request(app).delete(`/api/favorites/${firstTrackId}`).set("Cookie", cookie).expect(204);
  const emptyFavorites = await request(app).get("/api/favorites").set("Cookie", cookie);
  assert.deepEqual(emptyFavorites.body, []);

  await request(app).delete(`/api/playlists/${playlistId}`).set("Cookie", cookie).expect(204);
  const playlists = await request(app).get("/api/playlists").set("Cookie", cookie);
  assert.deepEqual(playlists.body, []);
});

test("playlist and favorite endpoints require the owner session", async () => {
  assert.equal((await request(app).get("/api/playlists")).status, 401);
  assert.equal((await request(app).get("/api/favorites")).status, 401);
});
