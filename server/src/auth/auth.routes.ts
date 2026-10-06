import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { authenticateOwner, createAccessToken, ensureOwnerAccount } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(1024),
});

export function createAuthRouter(database: Database.Database, config: AppConfig) {
  const router = Router();
  let desktopTokenConsumed = false;
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit." },
  });

  router.post("/login", loginLimiter, async (request, response, next) => {
    try {
      const input = loginSchema.safeParse(request.body);
      if (!input.success) {
        response.status(400).json({ error: "Username dan password wajib diisi." });
        return;
      }

      const user = await authenticateOwner(database, input.data.username, input.data.password);
      if (!user) {
        response.status(401).json({ error: "Username atau password salah." });
        return;
      }

      const token = createAccessToken(user, config);
      setSessionCookie(response, token, config);
      response.json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/desktop-login", async (request, response, next) => {
    const remoteAddress = request.socket.remoteAddress;
    if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::ffff:127.0.0.1") {
      response.status(403).json({ error: "Akses desktop hanya diizinkan dari perangkat ini." });
      return;
    }

    const expectedToken = config.desktopAuthToken;
    const suppliedToken = request.get("X-Desktop-Token") ?? "";
    if (!expectedToken || desktopTokenConsumed || !tokensMatch(suppliedToken, expectedToken)) {
      response.status(401).json({ error: "Autentikasi desktop tidak valid." });
      return;
    }

    desktopTokenConsumed = true;
    try {
      await ensureOwnerAccount(database, config);
      const user = database.prepare("SELECT id, username FROM users WHERE id = 1").get() as
        { id: number; username: string } | undefined;
      if (!user) throw new Error("Akun pemilik Musikku tidak dapat dibuat.");

      setSessionCookie(response, createAccessToken(user, config), config, true);
      response.json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/desktop-refresh", requireAuth(config), (request, response) => {
    const user = request.authUser;
    if (!user) {
      response.status(401).json({ error: "Autentikasi diperlukan." });
      return;
    }
    setSessionCookie(response, createAccessToken(user, config), config, true);
    response.json({ user });
  });

  router.post("/logout", requireAuth(config), (_request, response) => {
    response.clearCookie("musikku_session", {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "strict",
      path: "/",
    });
    response.status(204).end();
  });

  router.get("/me", requireAuth(config), (request, response) => {
    response.json({ user: request.authUser });
  });

  return router;
}

function tokensMatch(supplied: string, expected: string): boolean {
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest) && supplied.length === expected.length;
}

function setSessionCookie(
  response: import("express").Response,
  token: string,
  config: AppConfig,
  desktop = false,
): void {
  response.cookie("musikku_session", token, {
    httpOnly: true,
    secure: desktop ? false : config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: config.jwtTtlSeconds * 1000,
    path: "/",
  });
}
