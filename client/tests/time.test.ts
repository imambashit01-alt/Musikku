import assert from "node:assert/strict";
import test from "node:test";
import { formatTime } from "../src/lib/time.ts";

test("formats durations with minutes and hours", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(3599.9), "59:59");
  assert.equal(formatTime(3600), "1:00:00");
  assert.equal(formatTime(3723), "1:02:03");
});

test("uses a safe zero label for invalid or negative durations", () => {
  assert.equal(formatTime(Number.NaN), "0:00");
  assert.equal(formatTime(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatTime(-1), "0:00");
});
