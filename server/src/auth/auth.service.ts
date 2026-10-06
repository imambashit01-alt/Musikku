import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";

export type AuthUser = {
  id: number;
  username: string;
};

type UserRecord = AuthUser & { password_hash: string };

export async function ensureOwnerAccount(
  database: Database.Database,
  config: Pick<AppConfig, "ownerUsername" | "ownerPassword">,
): Promise<void> {
  const existing = database.prepare("SELECT id FROM users WHERE id = 1").get();
  if (existing) return;

  const passwordHash = await argon2.hash(config.ownerPassword, { type: argon2.argon2id });
  database
    .prepare("INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)")
    .run(config.ownerUsername, passwordHash);
}

export async function authenticateOwner(
  database: Database.Database,
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const user = database
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(username) as UserRecord | undefined;

  if (!user || !(await argon2.verify(user.password_hash, password))) return null;
  return { id: user.id, username: user.username };
}

export function createAccessToken(user: AuthUser, config: AppConfig): string {
  return jwt.sign({ uid: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
  });
}

export function verifyAccessToken(token: string, secret: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload === "string" ||
      typeof payload.uid !== "number" ||
      !Number.isInteger(payload.uid) ||
      typeof payload.username !== "string"
    ) {
      return null;
    }

    return { id: payload.uid, username: payload.username };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return null;
    }
    throw error;
  }
}
