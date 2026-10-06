import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { stripControlCharacters } from "../sanitize.js";
import { HttpError } from "../http-error.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { parseAudioMetadata } from "./metadata.service.js";
import { parseByteRange } from "./range.js";
import { TrackRepository } from "./track.repository.js";
import { toTrack } from "./track.types.js";

const supportedExtensions = new Set(["flac", "m4a", "mp3", "ogg", "wav", "wave"]);
const mimeTypes: Record<string, string> = {
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
const imageExtensions: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
const supportedImageTypes: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
function sanitizedOriginalName(originalName: string): string {
  const leaf = originalName.replaceAll("\\", "/").split("/").pop() ?? "";
  return stripControlCharacters(leaf).trim().slice(0, 255) || "audio";
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const updateInfoSchema = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(300),
  album: z.string().trim().min(1).max(300),
});
const lyricsSchema = z.object({
  text: z.string().max(1024 * 1024),
  offset: z.number().finite().min(-600).max(600),
});

export function createTracksRouter(database: Database.Database, config: AppConfig) {
  const router = Router();
  const repository = new TrackRepository(database);
  const dataDirectory = resolve(config.dataDirectory);
  const musicDirectory = join(dataDirectory, "music");
  const coversDirectory = join(dataDirectory, "covers");
  const temporaryDirectory = join(dataDirectory, "tmp");
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        void mkdir(temporaryDirectory, { recursive: true }).then(
          () => callback(null, temporaryDirectory),
          (error: unknown) =>
            callback(error instanceof Error ? error : new Error(String(error)), temporaryDirectory),
        );
      },
      filename: (_request, _file, callback) => callback(null, randomUUID()),
    }),
    limits: { files: 1 },
  });
  const coverUpload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        void mkdir(temporaryDirectory, { recursive: true }).then(
          () => callback(null, temporaryDirectory),
          (error: unknown) =>
            callback(error instanceof Error ? error : new Error(String(error)), temporaryDirectory),
        );
      },
      filename: (_request, _file, callback) => callback(null, randomUUID()),
    }),
    limits: { files: 1 },
  });

  router.use(requireAuth(config));

  router.get("/", (request, response, next) => {
    const search = typeof request.query.q === "string" ? request.query.q.slice(0, 200) : "";
    const sort = typeof request.query.sort === "string" ? request.query.sort : "title";
    try {
      response.json(repository.list(search, sort).map(toTrack));
    } catch (error) {
      next(error);
    }
  });

  router.post("/", upload.single("file"), async (request, response, next) => {
    let storedAudioPath: string | undefined;
    let storedCoverPath: string | undefined;
    try {
      const uploadedFile = request.file;
      if (!uploadedFile) {
        throw new HttpError(400, "Pilih satu file audio untuk diunggah.");
      }

      const originalName = sanitizedOriginalName(uploadedFile.originalname);
      if (
        typeof request.body.lyricsLrc === "string" &&
        request.body.lyricsLrc.length > 1024 * 1024
      ) {
        throw new HttpError(400, "File lirik tidak valid atau melebihi ukuran 1 MB.");
      }
      const detectedType = await fileTypeFromFile(uploadedFile.path);
      if (!detectedType || !supportedExtensions.has(detectedType.ext)) {
        throw new HttpError(415, "Format tidak didukung. Gunakan MP3, M4A, FLAC, WAV, atau OGG.");
      }

      const contentHash = await hashFile(uploadedFile.path);
      const existing = repository.findByHash(contentHash);
      if (existing) {
        await rm(uploadedFile.path, { force: true });
        response.setHeader("X-Track-Duplicate", "true");
        response.status(200).json(toTrack(existing));
        return;
      }

      const relativePath =
        typeof request.body.relativePath === "string" &&
        request.body.relativePath.length <= 1024 &&
        !request.body.relativePath.includes("\0")
          ? request.body.relativePath
          : undefined;
      let metadata;
      try {
        metadata = await parseAudioMetadata(uploadedFile.path, originalName, relativePath);
      } catch {
        throw new HttpError(
          422,
          "Metadata audio tidak dapat dibaca. Pastikan file audio tidak rusak.",
        );
      }
      const importedLyrics =
        typeof request.body.lyricsLrc === "string" &&
        request.body.lyricsLrc.length <= 1024 * 1024 &&
        request.body.lyricsLrc.trim()
          ? request.body.lyricsLrc
          : metadata.lyrics;

      const id = randomUUID();
      const extension = detectedType.ext === "wave" ? "wav" : detectedType.ext;
      const storageName = `${id}.${extension}`;
      await mkdir(musicDirectory, { recursive: true });
      storedAudioPath = join(musicDirectory, storageName);
      await rename(uploadedFile.path, storedAudioPath);

      let coverName: string | null = null;
      if (metadata.cover) {
        const pictureData = Buffer.from(metadata.cover.data);
        const declaredMime = metadata.cover.mime.trim().toLowerCase();
        const normalizedDeclaredMime = declaredMime === "image/jpg" ? "image/jpeg" : declaredMime;
        const declaredExtension = imageExtensions[normalizedDeclaredMime];
        const detectedPictureType = await fileTypeFromBuffer(pictureData);
        const detectedExtension = detectedPictureType
          ? imageExtensions[detectedPictureType.mime]
          : undefined;
        const embeddedExtension =
          declaredExtension && declaredExtension === detectedExtension
            ? declaredExtension
            : detectedExtension;

        if (embeddedExtension) {
          coverName = `${id}.${embeddedExtension}`;
          await mkdir(coversDirectory, { recursive: true });
          storedCoverPath = join(coversDirectory, coverName);
          await writeFile(storedCoverPath, pictureData, { flag: "wx" });
        }
      }

      repository.create({
        id,
        storage_name: storageName,
        original_name: originalName,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        album_artist: metadata.albumArtist,
        track_number: metadata.trackNumber,
        year: metadata.year,
        genre: metadata.genre,
        duration: metadata.duration,
        mime_type: mimeTypes[extension] ?? detectedType.mime,
        file_size: uploadedFile.size,
        cover_name: coverName,
        cover_version: 1,
        content_hash: contentHash,
        lyrics_text: importedLyrics ?? null,
        lyrics_offset: 0,
        created_at: new Date().toISOString(),
      });

      response.status(201).json(toTrack(repository.findById(id)!));
    } catch (error) {
      if (request.file) await rm(request.file.path, { force: true });
      if (storedAudioPath) await rm(storedAudioPath, { force: true });
      if (storedCoverPath) await rm(storedCoverPath, { force: true });
      next(error);
    }
  });

  router.get("/:id/stream", async (request, response, next) => {
    try {
      const trackId = Array.isArray(request.params.id)
        ? (request.params.id[0] ?? "")
        : (request.params.id ?? "");
      const track = repository.findById(trackId);
      if (!track) throw new HttpError(404, "Lagu tidak ditemukan.");

      const path = join(musicDirectory, track.storage_name);
      const file = await stat(path);
      const rangeHeader = request.header("range");
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Type", track.mime_type);
      response.setHeader("Cache-Control", "private, no-store");

      if (rangeHeader) {
        const range = parseByteRange(rangeHeader, file.size);
        if (!range) {
          response.status(416).setHeader("Content-Range", `bytes */${file.size}`).end();
          return;
        }

        response.status(206);
        response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
        response.setHeader("Content-Length", range.end - range.start + 1);
        createReadStream(path, range).on("error", next).pipe(response);
        return;
      }

      response.setHeader("Content-Length", file.size);
      createReadStream(path).on("error", next).pipe(response);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/cover", (request, response, next) => {
    const track = repository.findById(request.params.id ?? "");
    if (!track?.cover_name) {
      response.status(404).json({ error: "Sampul tidak tersedia untuk lagu ini." });
      return;
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.sendFile(join(coversDirectory, track.cover_name), (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  router.patch("/:id/cover", coverUpload.single("cover"), async (request, response, next) => {
    const temporaryCoverPath = request.file?.path;
    let storedCoverPath: string | undefined;
    let coverSaved = false;
    try {
      const trackId = Array.isArray(request.params.id)
        ? (request.params.id[0] ?? "")
        : (request.params.id ?? "");
      const track = repository.findById(trackId);
      if (!track) throw new HttpError(404, "Lagu tidak ditemukan.");
      if (!request.file) throw new HttpError(400, "Pilih file gambar untuk sampul.");
      const detectedType = await fileTypeFromFile(request.file.path);
      const extension = detectedType ? supportedImageTypes[detectedType.mime] : undefined;
      if (!detectedType || !extension) {
        throw new HttpError(
          415,
          "Format gambar tidak didukung. Gunakan JPEG, PNG, GIF, atau WebP.",
        );
      }

      const coverName = `${track.id}-${randomUUID()}.${extension}`;
      storedCoverPath = join(coversDirectory, coverName);
      await mkdir(coversDirectory, { recursive: true });
      await rename(request.file.path, storedCoverPath);
      repository.updateCover(track.id, coverName);
      coverSaved = true;
      if (track.cover_name && track.cover_name !== coverName) {
        await rm(join(coversDirectory, track.cover_name), { force: true });
      }
      response.json(toTrack(repository.findById(track.id)!));
    } catch (error) {
      if (temporaryCoverPath) await rm(temporaryCoverPath, { force: true });
      if (storedCoverPath && !coverSaved) await rm(storedCoverPath, { force: true });
      next(error);
    }
  });

  router.get("/:id/lyrics", (request, response, next) => {
    try {
      const track = repository.findById(request.params.id ?? "");
      if (!track) throw new HttpError(404, "Lagu tidak ditemukan.");
      response.json({ text: track.lyrics_text ?? "", offset: track.lyrics_offset });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/lyrics", (request, response, next) => {
    try {
      const track = repository.findById(request.params.id ?? "");
      if (!track) throw new HttpError(404, "Lagu tidak ditemukan.");
      const input = lyricsSchema.safeParse(request.body);
      if (!input.success) throw new HttpError(400, "Lirik tidak valid atau melebihi ukuran 1 MB.");
      repository.updateLyrics(track.id, input.data.text, input.data.offset);
      response.json({ text: input.data.text, offset: input.data.offset });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", (request, response, next) => {
    try {
      const track = repository.findById(request.params.id ?? "");
      if (!track) throw new HttpError(404, "Lagu tidak ditemukan.");
      const input = updateInfoSchema.safeParse(request.body);
      if (!input.success) throw new HttpError(400, "Judul, artis, dan album harus diisi.");
      repository.updateInfo(track.id, input.data);
      response.json(toTrack(repository.findById(track.id)!));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (request, response, next) => {
    try {
      const track = repository.findById(request.params.id ?? "");
      if (!track) throw new HttpError(404, "Lagu tidak ditemukan.");
      await rm(join(musicDirectory, track.storage_name));
      if (track.cover_name) await rm(join(coversDirectory, track.cover_name), { force: true });
      repository.delete(track.id);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
