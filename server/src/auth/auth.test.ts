import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import { ensureOwnerAccount } from "./auth.service.js";
import { openDatabase } from "../db/database.js";

const config: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  host: "127.0.0.1",
  databasePath: ":memory:",
  jwtSecret: "test-only-secret-with-at-least-32-characters",
  jwtTtlSeconds: 60 * 60,
  ownerUsername: "owner",
  ownerPassword: "test-password-long-enough",
  clientOrigin: "http://localhost:5173",
  dataDirectory: "./.test-data",
};

let database: Database.Database;
let app: ReturnType<typeof createApp>;

before(async () => {
  database = await openDatabase(":memory:");
  await ensureOwnerAccount(database, config);
  app = createApp(database, config);
});

after(() => database?.close());

test("login rejects invalid credentials without issuing a session", async () => {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ username: "owner", password: "wrong-password" });

  assert.equal(response.status, 401);
  assert.equal(response.headers["set-cookie"], undefined);
});

test("owner can log in, inspect the session, and log out", async () => {
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "owner", password: config.ownerPassword });
  assert.equal(login.status, 200);
  assert.match(login.headers["set-cookie"]?.[0] ?? "", /HttpOnly/);
  assert.match(login.headers["set-cookie"]?.[0] ?? "", /SameSite=Strict/);

  const sessionCookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
  assert.ok(sessionCookie);

  const me = await request(app).get("/api/auth/me").set("Cookie", sessionCookie);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { id: 1, username: "owner" });

  const logout = await request(app).post("/api/auth/logout").set("Cookie", sessionCookie);
  assert.equal(logout.status, 204);

  const unauthenticated = await request(app).get("/api/auth/me");
  assert.equal(unauthenticated.status, 401);
});

test("protected auth endpoints reject unauthenticated requests", async () => {
  const response = await request(app).post("/api/auth/logout");
  assert.equal(response.status, 401);
  const health = await request(app).get("/api/health");
  assert.equal(health.status, 401);
});

test("desktop login creates the owner once and refreshes its httpOnly session", async () => {
  const desktopDatabase = await openDatabase(":memory:");
  const desktopToken = "d".repeat(64);
  const desktopApp = createApp(desktopDatabase, {
    ...config,
    desktopAuthToken: desktopToken,
  });

  try {
    const missingToken = await request(desktopApp).post("/api/auth/desktop-login").expect(401);
    assert.equal(missingToken.headers["set-cookie"], undefined);

    const invalidToken = await request(desktopApp)
      .post("/api/auth/desktop-login")
      .set("X-Desktop-Token", "wrong-token")
      .expect(401);
    assert.equal(invalidToken.headers["set-cookie"], undefined);

    const login = await request(desktopApp)
      .post("/api/auth/desktop-login")
      .set("X-Desktop-Token", desktopToken)
      .expect(200);
    assert.deepEqual(login.body.user, { id: 1, username: "owner" });
    assert.match(login.headers["set-cookie"]?.[0] ?? "", /HttpOnly/);
    assert.match(login.headers["set-cookie"]?.[0] ?? "", /SameSite=Strict/);

    const sessionCookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
    assert.ok(sessionCookie);
    await request(desktopApp).get("/api/auth/me").set("Cookie", sessionCookie).expect(200);

    const reusedToken = await request(desktopApp)
      .post("/api/auth/desktop-login")
      .set("X-Desktop-Token", desktopToken)
      .expect(401);
    assert.equal(reusedToken.headers["set-cookie"], undefined);

    const refreshed = await request(desktopApp)
      .post("/api/auth/desktop-refresh")
      .set("Cookie", sessionCookie)
      .expect(200);
    assert.match(refreshed.headers["set-cookie"]?.[0] ?? "", /HttpOnly/);
    assert.deepEqual(refreshed.body.user, { id: 1, username: "owner" });
    await request(desktopApp).post("/api/auth/desktop-refresh").expect(401);
  } finally {
    desktopDatabase.close();
  }
});
