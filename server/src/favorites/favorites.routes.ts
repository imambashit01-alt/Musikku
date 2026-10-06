import { Router } from "express";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { HttpError } from "../http-error.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { toTrack } from "../tracks/track.types.js";
import { PlaylistRepository } from "../playlists/playlist.repository.js";

export function createFavoritesRouter(database: Database.Database, config: AppConfig) {
  const router = Router();
  const repository = new PlaylistRepository(database);
  router.use(requireAuth(config));

  router.get("/", (_request, response, next) => {
    try {
      response.json(repository.listFavorites().map(toTrack));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:trackId", (request, response, next) => {
    try {
      const trackId = request.params.trackId ?? "";
      if (!repository.hasTrack(trackId)) throw new HttpError(404, "Lagu tidak ditemukan.");
      repository.addFavorite(trackId);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:trackId", (request, response) => {
    repository.removeFavorite(request.params.trackId ?? "");
    response.status(204).end();
  });

  return router;
}
