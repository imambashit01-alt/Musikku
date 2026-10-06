import assert from "node:assert/strict";
import test from "node:test";
import { parseFileName } from "./file-name-parser.js";

const cases: Array<[string, string, string | undefined]> = [
  ["Artist - Song.mp3", "Song", "Artist"],
  ["Artist – Song (Official Audio).mp3", "Song", "Artist"],
  ["Artist — Song [HQ].flac", "Song", "Artist"],
  ["01. Song.mp3", "Song", undefined],
  ["01 - Artist - Song.mp3", "Song", "Artist"],
  ["Song_Artist.mp3", "Song", "Artist"],
  ["artist_name - song_title.mp3", "Song Title", "Artist Name"],
  ["03. the long and winding road.wav", "The Long And Winding Road", undefined],
  ["Artist - Song (Official Video).mp4", "Song", "Artist"],
  ["Artist - Song (Lyrics).mp3", "Song", "Artist"],
  ["Artist - Song [HQ].mp3", "Song", "Artist"],
  ["Artist - Song 320kbps.mp3", "Song", "Artist"],
  ["01) Artist – Song (Lyric Video).m4a", "Song", "Artist"],
  ["007 - Artist - Song.mp3", "Song", "Artist"],
  ["Song (Official Music Video).mp3", "Song", undefined],
  ["Song [HD].mp3", "Song", undefined],
  ["Song 256 kbps.mp3", "Song", undefined],
  ["01_Song.mp3", "Song", undefined],
  ["Song_Artist.mp3", "Song", "Artist"],
  ["artist - my_favorite_song.ogg", "My Favorite Song", "Artist"],
  ["Song.mp3", "Song", undefined],
  ["", "Unknown Title", undefined],
];

test("parses common music filename conventions and cleans noise", () => {
  assert.ok(cases.length >= 20);
  for (const [fileName, title, artist] of cases) {
    const parsed = parseFileName(fileName);
    assert.equal(parsed.title, title, fileName);
    assert.equal(parsed.artist, artist, fileName);
  }
});

test("uses artist and album from folder structure when filename has no artist", () => {
  assert.deepEqual(parseFileName("07. intro.mp3", "Some Artist/Live Album/07. intro.mp3"), {
    title: "Intro",
    artist: "Some Artist",
    album: "Live Album",
  });
});

test("keeps filename artist and only fills missing artist from folders", () => {
  assert.deepEqual(parseFileName("Filename Artist - Title.mp3", "Folder Artist/Album/track.mp3"), {
    title: "Title",
    artist: "Filename Artist",
    album: "Album",
  });
});
