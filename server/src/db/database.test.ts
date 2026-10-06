import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createDatabaseWithMigrationHistory(hasCoverVersion: boolean): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "musikku-migration-test-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "musikku.sqlite");
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE tracks (id TEXT PRIMARY KEY${hasCoverVersion ? ", cover_version INTEGER NOT NULL DEFAULT 1" : ""});
  `);
  const insertMigration = database.prepare("INSERT INTO schema_migrations (version) VALUES (?)");
  for (let version = 1; version <= 6; version += 1) insertMigration.run(version);
  database.close();
  return databasePath;
}

test("adds a missing cover version column to a database already at migration 6", async () => {
  const databasePath = await createDatabaseWithMigrationHistory(false);
  const database = await openDatabase(databasePath);

  assert.ok(
    (database.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]).some(
      (column) => column.name === "cover_version",
    ),
  );
  assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 7").get());
  database.close();
});

test("does not add the cover version column twice when it already exists", async () => {
  const databasePath = await createDatabaseWithMigrationHistory(true);
  const database = await openDatabase(databasePath);

  assert.equal(
    (database.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]).filter(
      (column) => column.name === "cover_version",
    ).length,
    1,
  );
  assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 7").get());
  database.close();
});
