import assert from "node:assert/strict";
import test from "node:test";
import { findActiveLyricIndex, parseLrc } from "../src/lib/lyrics.ts";

test("parses centisecond, millisecond, and colon fraction timestamps", () => {
  assert.deepEqual(parseLrc("[00:01.25]First\n[00:02.375]Second\n[00:03:5]Third").cues, [
    { time: 1.25, text: "First" },
    { time: 2.375, text: "Second" },
    { time: 3.5, text: "Third" },
  ]);
});

test("expands multiple timestamps and applies LRC and user offsets", () => {
  assert.deepEqual(parseLrc("[offset:+500]\n[00:01.00][00:02.00]Twice", -0.25).cues, [
    { time: 1.25, text: "Twice" },
    { time: 2.25, text: "Twice" },
  ]);
});

test("ignores metadata tags, sorts cues, and preserves unsynchronized text", () => {
  const parsed = parseLrc("[ar:Artist]\n[00:04.00]Late\n[00:01.00]Early\nA plain line");
  assert.deepEqual(parsed.cues, [
    { time: 1, text: "Early" },
    { time: 4, text: "Late" },
  ]);
  assert.equal(parsed.plainText, "A plain line");
});

test("finds the active cue using binary search boundaries", () => {
  const cues = parseLrc("[00:01.00]One\n[00:03.00]Two\n[00:05.00]Three").cues;
  assert.equal(findActiveLyricIndex(cues, 0.99), -1);
  assert.equal(findActiveLyricIndex(cues, 1), 0);
  assert.equal(findActiveLyricIndex(cues, 4.99), 1);
  assert.equal(findActiveLyricIndex(cues, 10), 2);
  assert.equal(findActiveLyricIndex([], 10), -1);
});
