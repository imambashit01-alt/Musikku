export type LyricCue = { time: number; text: string };

export type ParsedLyrics = {
  cues: LyricCue[];
  plainText: string;
  fileOffset: number;
};

const timestampPattern = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\[(?:ar|ti|al|by|re|ve|length|au|la|tool|kana|id):/i;

function parseFraction(fraction: string | undefined): number {
  if (!fraction) return 0;
  return Number(`0.${fraction}`);
}

export function parseLrc(text: string, offset = 0): ParsedLyrics {
  const cues: LyricCue[] = [];
  let fileOffset = 0;
  const plainLines: string[] = [];

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const offsetTag = rawLine.match(/^\s*\[offset:([+-]?\d+)\]\s*$/i);
    if (offsetTag) {
      fileOffset = Number(offsetTag[1]) / 1000;
      continue;
    }

    const timestamps = [...rawLine.matchAll(timestampPattern)];
    if (!timestamps.length) {
      if (rawLine.trim() && !metadataPattern.test(rawLine.trim())) plainLines.push(rawLine);
      continue;
    }

    const lyricText = rawLine.replace(timestampPattern, "").trim();
    for (const match of timestamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = parseFraction(match[3]);
      cues.push({
        time: Math.max(0, minutes * 60 + seconds + fraction + fileOffset + offset),
        text: lyricText,
      });
    }
  }

  cues.sort((left, right) => left.time - right.time);
  return { cues, plainText: plainLines.join("\n").trim(), fileOffset };
}

export function findActiveLyricIndex(cues: LyricCue[], currentTime: number): number {
  let low = 0;
  let high = cues.length - 1;
  let active = -1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (cues[middle]!.time <= currentTime) {
      active = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
}
