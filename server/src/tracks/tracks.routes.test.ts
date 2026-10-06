import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import request from "supertest";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import { ensureOwnerAccount } from "../auth/auth.service.js";
import { openDatabase } from "../db/database.js";

let database: Database.Database;
let app: ReturnType<typeof createApp>;
let dataDirectory: string;
let sessionCookie: string;

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
  dataDirectory: "",
};

function createWav(): Buffer {
  const samples = Buffer.alloc(16);
  const wav = Buffer.alloc(44 + samples.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length, 40);
  samples.copy(wav, 44);
  return wav;
}

function createMp3WithEmbeddedCover(cover: Buffer): Buffer {
  const frame = (id: string, data: Buffer) => {
    const header = Buffer.alloc(10);
    header.write(id, 0, "ascii");
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  };
  const textFrame = (id: string, value: string) =>
    frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(value, "latin1")]));
  const pictureFrame = frame(
    "APIC",
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from("image/png\0", "latin1"),
      Buffer.from([3, 0]),
      cover,
    ]),
  );
  const tag = Buffer.concat([
    textFrame("TIT2", "Embedded ID3 Title"),
    textFrame("TPE1", "Embedded ID3 Artist"),
    textFrame("TALB", "Embedded ID3 Album"),
    textFrame("TPE2", "Embedded Album Artist"),
    textFrame("TCON", "Jazz"),
    textFrame("TYER", "2001"),
    textFrame("TRCK", "9"),
    pictureFrame,
  ]);
  const tagSize = tag.length;
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    (tagSize >> 21) & 0x7f,
    (tagSize >> 14) & 0x7f,
    (tagSize >> 7) & 0x7f,
    tagSize & 0x7f,
  ]);
  const audioFrame = Buffer.alloc(417);
  audioFrame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([header, tag, audioFrame]);
}

before(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "musikku-test-"));
  database = await openDatabase(":memory:");
  await ensureOwnerAccount(database, config);
  app = createApp(database, { ...config, dataDirectory });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: config.ownerUsername, password: config.ownerPassword });
  assert.equal(login.status, 200);
  sessionCookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  assert.ok(sessionCookie);
  config.dataDirectory = relative(process.cwd(), dataDirectory);
});

after(async () => {
  database?.close();
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

test("end-to-end: uploads a local audio file and plays its byte-range stream", async () => {
  const upload = await request(app)
    .post("/api/tracks")
    .set("Cookie", sessionCookie)
    .attach("file", createWav(), {
      filename: "Sample Artist - Sample Song.wav",
      contentType: "audio/wav",
    })
    .field("lyricsLrc", "[00:01.25]Locally imported lyric");

  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  assert.equal(upload.body.title, "Sample Song");
  assert.equal(upload.body.artist, "Unknown Artist");
  assert.equal(upload.body.mimeType, "audio/wav");
  assert.equal(upload.body.hasLyrics, true);
  assert.equal(upload.body.album, "Unknown Album");
  assert.equal(upload.body.albumArtist, "Unknown Artist");
  assert.equal(upload.body.hasCover, false);
  assert.equal(upload.body.coverVersion, 1);

  const trackId = upload.body.id as string;
  await request(app).get(`/api/tracks/${trackId}/cover`).set("Cookie", sessionCookie).expect(404);
  const manualCover = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY5sAAAAASUVORK5CYII=",
    "base64",
  );
  const changedCover = await request(app)
    .patch(`/api/tracks/${trackId}/cover`)
    .set("Cookie", sessionCookie)
    .attach("cover", manualCover, { filename: "manual.png", contentType: "image/png" })
    .expect(200);
  assert.equal(changedCover.body.coverVersion, 2);
  const persistedManualCover = await request(app)
    .get(`/api/tracks/${trackId}/cover?v=${changedCover.body.coverVersion}`)
    .set("Cookie", sessionCookie)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.deepEqual(persistedManualCover.body, manualCover);

  const duplicateUpload = await request(app)
    .post("/api/tracks")
    .set("Cookie", sessionCookie)
    .attach("file", createWav(), {
      filename: "A Different Name.wav",
      contentType: "audio/wav",
    });
  assert.equal(duplicateUpload.status, 200);
  assert.equal(duplicateUpload.headers["x-track-duplicate"], "true");
  assert.equal(duplicateUpload.body.id, trackId);

  const rangeResponse = await request(app)
    .get(`/api/tracks/${trackId}/stream`)
    .set("Cookie", sessionCookie)
    .set("Range", "bytes=0-11")
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });

  test("extracts and persists the actual PNG APIC picture and ID3 metadata from MP3", async () => {
    const embeddedCover = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY5sAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await request(app)
      .post("/api/tracks")
      .set("Cookie", sessionCookie)
      .attach("file", createMp3WithEmbeddedCover(embeddedCover), {
        filename: "id3-fallback-name.mp3",
        contentType: "audio/mpeg",
      })
      .expect(201);

    assert.equal(upload.body.title, "Embedded ID3 Title");
    assert.equal(upload.body.artist, "Embedded ID3 Artist");
    assert.equal(upload.body.album, "Embedded ID3 Album");
    assert.equal(upload.body.albumArtist, "Embedded Album Artist");
    assert.equal(upload.body.genre, "Jazz");
    assert.equal(upload.body.year, 2001);
    assert.equal(upload.body.trackNumber, 9);
    assert.equal(upload.body.hasCover, true);

    const cover = await request(app)
      .get(`/api/tracks/${upload.body.id}/cover`)
      .set("Cookie", sessionCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    assert.equal(cover.headers["content-type"], "image/png");
    assert.deepEqual(cover.body, embeddedCover);
  });

  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers["content-range"], "bytes 0-11/60");
  assert.deepEqual(rangeResponse.body, createWav().subarray(0, 12));

  const playbackResponse = await request(app)
    .get(`/api/tracks/${trackId}/stream`)
    .set("Cookie", sessionCookie)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(playbackResponse.status, 200);
  assert.deepEqual(playbackResponse.body, createWav());

  const edited = await request(app)
    .patch(`/api/tracks/${trackId}`)
    .set("Cookie", sessionCookie)
    .send({ title: "Corrected Title", artist: "Corrected Artist", album: "Corrected Album" })
    .expect(200);
  assert.equal(edited.body.title, "Corrected Title");
  assert.equal(edited.body.artist, "Corrected Artist");
  assert.equal(edited.body.album, "Corrected Album");

  const lyrics = await request(app)
    .get(`/api/tracks/${trackId}/lyrics`)
    .set("Cookie", sessionCookie)
    .expect(200);
  assert.deepEqual(lyrics.body, {
    text: "[00:01.25]Locally imported lyric",
    offset: 0,
  });

  const updatedLyrics = await request(app)
    .patch(`/api/tracks/${trackId}/lyrics`)
    .set("Cookie", sessionCookie)
    .send({ text: "Plain lyrics", offset: 0.5 })
    .expect(200);
  assert.deepEqual(updatedLyrics.body, { text: "Plain lyrics", offset: 0.5 });

  const unsatisfiableRange = await request(app)
    .get(`/api/tracks/${trackId}/stream`)
    .set("Cookie", sessionCookie)
    .set("Range", "bytes=60-")
    .expect(416);
  assert.equal(unsatisfiableRange.headers["content-range"], "bytes */60");

  const list = await request(app).get("/api/tracks").set("Cookie", sessionCookie);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, trackId);
  assert.equal(list.body[0].title, "Corrected Title");
  assert.equal(list.body[0].hasLyrics, true);
});

test("rejects unauthenticated track access", async () => {
  const response = await request(app).get("/api/tracks");
  assert.equal(response.status, 401);

  const invalidDesktopToken = await request(app)
    .get("/api/tracks")
    .set("X-Desktop-Token", "invalid");
  assert.equal(invalidDesktopToken.status, 401);
});

test("rejects file extensions that do not contain supported audio magic bytes", async () => {
  const response = await request(app)
    .post("/api/tracks")
    .set("Cookie", sessionCookie)
    .attach("file", Buffer.from("not an audio file"), {
      filename: "pretend.mp3",
      contentType: "audio/mpeg",
    });

  assert.equal(response.status, 415);
  assert.equal(
    response.body.error,
    "Format tidak didukung. Gunakan MP3, M4A, FLAC, WAV, atau OGG.",
  );
});
