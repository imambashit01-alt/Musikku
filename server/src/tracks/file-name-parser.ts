import { basename, dirname, extname, isAbsolute, normalize, sep } from "node:path";

const noisePatterns = [
  /\((?:official(?:\s+(?:audio|video|music\s+video))?|lyrics?|lyric\s+video)\)/gi,
  /\[(?:hq|hd|lyrics?|official(?:\s+(?:audio|video))?)\]/gi,
  /\b\d{2,3}\s*kbps\b/gi,
  /\b(?:official\s+audio|official\s+video|official\s+music\s+video|lyric\s+video)\b/gi,
];

export type ParsedFileName = {
  title: string;
  artist?: string;
};

function titleCase(value: string): string {
  return value.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (word) =>
    /^[A-Z0-9]{2,5}$/.test(word)
      ? word
      : word[0]!.toLocaleUpperCase() + word.slice(1).toLocaleLowerCase(),
  );
}

function cleanPart(value: string): string {
  let cleaned = value.replaceAll("_", " ").replaceAll(".", " ").replace(/\s+/g, " ").trim();
  for (const pattern of noisePatterns) cleaned = cleaned.replace(pattern, " ");
  cleaned = cleaned.replace(/\s+/g, " ").replace(/^[\s\-–—()[\]]+|[\s\-–—()[\]]+$/g, "");
  return cleaned ? titleCase(cleaned) : "";
}

function stripTrackNumber(value: string): string {
  return value.replace(/^\s*\d{1,3}(?:\s*[.)_-]\s*|\s*[-–—]\s*)/, "").trim();
}

function filenameParts(fileName: string): ParsedFileName {
  const extension = extname(fileName);
  const stem = extension
    ? basename(fileName, extension)
    : fileName.startsWith(".")
      ? ""
      : basename(fileName);
  const noNumber = stripTrackNumber(stem);
  const spaced = noNumber.replaceAll("_", " ");
  const separator = spaced.match(/\s+[-–—]\s+/);

  if (separator?.index !== undefined) {
    const artist = cleanPart(spaced.slice(0, separator.index));
    const title = cleanPart(spaced.slice(separator.index + separator[0].length));
    if (artist && title) return { artist, title };
  }

  const underscoreArtist = noNumber.match(/^(.+?)_([^_]+)$/);
  if (underscoreArtist) {
    const title = cleanPart(underscoreArtist[1] ?? "");
    const artist = cleanPart(underscoreArtist[2] ?? "");
    if (title && artist) return { artist, title };
  }

  return { title: cleanPart(noNumber) || cleanPart(stem) || "Unknown Title" };
}

function folderFallback(relativePath: string): { artist?: string; album?: string } {
  const normalized = normalize(relativePath).replace(/^[/\\]+/, "");
  if (!normalized || isAbsolute(normalized)) return {};
  const folders = dirname(normalized).split(sep).map(cleanPart).filter(Boolean);
  const artist = folders[0];
  const album = folders[1];
  if (folders.length >= 2 && artist && album) return { artist, album };
  if (artist) return { artist };
  return {};
}

export function parseFileName(
  fileName: string,
  relativePath?: string,
): ParsedFileName & {
  album?: string;
} {
  const parsed = filenameParts(basename(fileName));
  const folders = relativePath ? folderFallback(relativePath) : {};
  return {
    ...parsed,
    ...(parsed.artist ? {} : folders.artist ? { artist: folders.artist } : {}),
    ...(folders.album ? { album: folders.album } : {}),
  };
}
