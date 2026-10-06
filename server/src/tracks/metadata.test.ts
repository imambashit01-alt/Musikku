import assert from "node:assert/strict";
import test from "node:test";
import { fallbackTitleAndArtist, normalizeAudioMetadata } from "./metadata.service.js";

test("uses Artist - Title filename fallback", () => {
  assert.deepEqual(fallbackTitleAndArtist("The Artist - A Song.flac"), {
    artist: "The Artist",
    title: "A Song",
  });
});

test("uses clear fallback labels for incomplete filenames", () => {
  assert.deepEqual(fallbackTitleAndArtist("unknown-track.mp3"), {
    artist: "Unknown Artist",
    title: "Unknown-Track",
  });
  assert.deepEqual(fallbackTitleAndArtist(".mp3"), {
    artist: "Unknown Artist",
    title: "Unknown Title",
  });
});

test("normalizes embedded tags, duration, artwork, and missing metadata", () => {
  const artwork = { mime: "image/png", data: new Uint8Array([1, 2, 3]) };
  assert.deepEqual(
    normalizeAudioMetadata(
      {
        title: "  Tagged title ",
        artist: " Tagged artist ",
        album: " Tagged album ",
        albumartist: " Album Artist ",
        track: { no: 7 },
        year: 2024,
        genre: [" Rock ", "Indie"],
      },
      132.5,
      artwork,
      "Filename Artist - Filename Title.mp3",
    ),
    {
      title: "Tagged title",
      artist: "Tagged artist",
      album: "Tagged album",
      albumArtist: "Album Artist",
      trackNumber: 7,
      year: 2024,
      genre: "Rock, Indie",
      duration: 132.5,
      cover: artwork,
      lyrics: null,
    },
  );

  assert.deepEqual(
    normalizeAudioMetadata({}, Number.NaN, null, "Fallback Artist - Fallback Title.ogg"),
    {
      title: "Fallback Title",
      artist: "Unknown Artist",
      album: "Unknown Album",
      albumArtist: "Unknown Artist",
      trackNumber: null,
      year: null,
      genre: null,
      duration: 0,
      cover: null,
      lyrics: null,
    },
  );

  assert.equal(
    normalizeAudioMetadata({}, 60, null, "Fallback.mp3", undefined, "[00:01.00]Tagged lyric")
      .lyrics,
    "[00:01.00]Tagged lyric",
  );
});

test("does not create artwork when metadata has no embedded picture", () => {
  const metadata = normalizeAudioMetadata({}, 12, null, "Song.mp3");
  assert.equal(metadata.cover, null);
});
