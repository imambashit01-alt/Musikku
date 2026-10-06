import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange } from "./range.js";

test("parses explicit, open-ended, and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-40", 10), { start: 0, end: 9 });
});

test("rejects malformed and unsatisfiable byte ranges", () => {
  for (const header of [undefined, "items=0-1", "bytes=10-", "bytes=4-2", "bytes=0-1,4-5"]) {
    assert.equal(parseByteRange(header, 10), null);
  }
  assert.equal(parseByteRange("bytes=0-1", 0), null);
});
