import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { HttpError } from "../http-error.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { toTrack } from "../tracks/track.types.js";
import { PlaylistRepository } from "./playlist.repository.js";

const nameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
const addTrackSchema = z.object({
  trackId: z.string().uuid(),
});
const reorderSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(10000),
});

export function createPlaylistsRouter(database: Database.Database, config: AppConfig) {
  const router = Router();
  const repository = new PlaylistRepository(database);
  router.use(requireAuth(config));

  router.get("/", (_request, response, next) => {
    try {
      response.json(
        repository.list().map((playlist) => ({
          ...playlist,
          tracks: playlist.tracks.map(toTrack),
        })),
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (request, response, next) => {
    const input = nameSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "Nama playlist wajib diisi (maksimal 80 karakter)." });
      return;
    }
    try {
      const id = randomUUID();
      repository.create(id, input.data.name);
      response.status(201).json(repository.findById(id));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", (request, response, next) => {
    const input = nameSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "Nama playlist wajib diisi (maksimal 80 karakter)." });
      return;
    }
    try {
      if (!repository.findById(request.params.id ?? "")) {
        throw new HttpError(404, "Playlist tidak ditemukan.");
      }
      repository.rename(request.params.id!, input.data.name);
      response.json(repository.findById(request.params.id!));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", (request, response, next) => {
    try {
      if (!repository.findById(request.params.id ?? "")) {
        throw new HttpError(404, "Playlist tidak ditemukan.");
      }
      repository.delete(request.params.id!);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/tracks", (request, response, next) => {
    const input = reorderSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "Urutan lagu tidak valid." });
      return;
    }
    try {
      if (!repository.findById(request.params.id ?? "")) {
        throw new HttpError(404, "Playlist tidak ditemukan.");
      }
      if (!repository.reorder(request.params.id!, input.data.trackIds)) {
        throw new HttpError(400, "Urutan harus berisi setiap lagu playlist tepat satu kali.");
      }
      response.json(repository.findById(request.params.id!));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/tracks", (request, response, next) => {
    const input = addTrackSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "ID lagu tidak valid." });
      return;
    }
    try {
      if (!repository.findById(request.params.id ?? "")) {
        throw new HttpError(404, "Playlist tidak ditemukan.");
      }
      if (!repository.hasTrack(input.data.trackId)) {
        throw new HttpError(404, "Lagu tidak ditemukan.");
      }
      const added = repository.addTrack(request.params.id!, input.data.trackId);
      if (!added) throw new HttpError(409, "Lagu sudah ada di playlist.");
      response.status(201).json(repository.findById(request.params.id!));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id/tracks/:trackId", (request, response, next) => {
    try {
      if (!repository.findById(request.params.id ?? "")) {
        throw new HttpError(404, "Playlist tidak ditemukan.");
      }
      repository.removeTrack(request.params.id!, request.params.trackId ?? "");
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
