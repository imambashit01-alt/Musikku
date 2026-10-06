import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import multer from "multer";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "./config.js";
import { createAuthRouter } from "./auth/auth.routes.js";
import { HttpError } from "./http-error.js";
import { createTracksRouter } from "./tracks/tracks.routes.js";
import { createPlaylistsRouter } from "./playlists/playlists.routes.js";
import { createFavoritesRouter } from "./favorites/favorites.routes.js";
import { requireAuth } from "./auth/auth.middleware.js";

export function createApp(database: Database.Database, config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());

  app.get("/api/health", requireAuth(config), (_request, response) =>
    response.json({ status: "ok" }),
  );
  app.use("/api/auth", createAuthRouter(database, config));
  app.use("/api/tracks", createTracksRouter(database, config));
  app.use("/api/playlists", createPlaylistsRouter(database, config));
  app.use("/api/favorites", createFavoritesRouter(database, config));

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (response.headersSent) {
      console.error("Request stream failed after headers were sent:", error);
      response.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      response.status(status).json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran file terlalu besar untuk diproses."
            : "Permintaan upload tidak valid.",
      });
      return;
    }

    console.error("Unhandled request error:", error);
    response.status(500).json({ error: "Terjadi kesalahan pada server." });
  };
  app.use(errorHandler);
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Endpoint API tidak ditemukan." });
  });

  if (config.nodeEnv === "production") {
    const clientBuild = resolve(process.cwd(), "../client/dist");
    app.use(express.static(clientBuild));
    app.get("*", (_request, response, next) => {
      response.sendFile(resolve(clientBuild, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  return app;
}
