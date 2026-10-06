import { parseFile, selectCover, TimestampFormat } from "music-metadata";
import { basename } from "node:path";
import { parseFileName } from "./file-name-parser.js";

export type ParsedAudioMetadata = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  cover: { mime: string; data: Uint8Array } | null;
  lyrics: string | null;
};

type AudioTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumartist?: string;
  track?: { no?: number | null };
  year?: number;
  genre?: string[];
};

function formatLrcTimestamp(seconds: number): string {
  const centiseconds = Math.round(Math.max(seconds, 0) * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const remainingSeconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `[${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}]`;
}

function embeddedLyrics(
  tags: Awaited<ReturnType<typeof parseFile>>["common"]["lyrics"],
  sampleRate?: number,
): string | null {
  const synchronized = tags?.find((tag) => tag.syncText?.length);
  if (synchronized) {
    const rate = sampleRate && Number.isFinite(sampleRate) ? sampleRate : 44_100;
    const lines = synchronized.syncText
      .filter((line) => typeof line.timestamp === "number" && Boolean(line.text.trim()))
      .map((line) => {
        const seconds =
          synchronized.timeStampFormat === TimestampFormat.milliseconds
            ? line.timestamp! / 1000
            : synchronized.timeStampFormat === TimestampFormat.mpegFrameNumber
              ? (line.timestamp! * 1152) / rate
              : 0;
        return `${formatLrcTimestamp(seconds)}${line.text}`;
      });
    if (lines.length) return lines.join("\n");
  }
  return tags?.find((tag) => tag.text?.trim())?.text?.trim() ?? null;
}

export function normalizeAudioMetadata(
  tags: AudioTags,
  duration: number | undefined,
  cover: ParsedAudioMetadata["cover"],
  originalName: string,
  relativePath?: string,
  lyrics: string | null = null,
): ParsedAudioMetadata {
  const fallback = parseFileName(originalName, relativePath);
  const artist = tags.artist?.trim() || "Unknown Artist";
  return {
    title: tags.title?.trim() || fallback.title,
    artist,
    album: tags.album?.trim() || "Unknown Album",
    albumArtist: tags.albumartist?.trim() || artist,
    trackNumber:
      typeof tags.track?.no === "number" && Number.isFinite(tags.track.no) ? tags.track.no : null,
    year: typeof tags.year === "number" && Number.isFinite(tags.year) ? tags.year : null,
    genre:
      tags.genre
        ?.map((genre) => genre.trim())
        .filter(Boolean)
        .join(", ") || null,
    duration: typeof duration === "number" && Number.isFinite(duration) ? duration : 0,
    cover,
    lyrics,
  };
}

export function fallbackTitleAndArtist(originalName: string): { title: string; artist: string } {
  const parsed = parseFileName(basename(originalName));
  return { artist: parsed.artist || "Unknown Artist", title: parsed.title };
}

export async function parseAudioMetadata(
  filePath: string,
  originalName: string,
  relativePath?: string,
): Promise<ParsedAudioMetadata> {
  const metadata = await parseFile(filePath, { duration: true });
  const embeddedCover = selectCover(metadata.common.picture);

  return normalizeAudioMetadata(
    metadata.common,
    metadata.format.duration,
    embeddedCover ? { mime: embeddedCover.format, data: embeddedCover.data } : null,
    originalName,
    relativePath,
    embeddedLyrics(metadata.common.lyrics, metadata.format.sampleRate),
  );
}
