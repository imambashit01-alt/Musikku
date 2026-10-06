import Database from "better-sqlite3";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));

export async function openDatabase(databasePath: string): Promise<Database.Database> {
  if (databasePath !== ":memory:") {
    await mkdir(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  await migrateDatabase(database);
  return database;
}

async function migrateDatabase(database: Database.Database): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrations = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+.*\.sql$/.test(filename))
    .sort();

  for (const filename of migrations) {
    const version = Number.parseInt(filename, 10);
    if (!Number.isSafeInteger(version)) {
      throw new Error(`Nom file migrasi tidak valid: ${filename}`);
    }

    const migration = await readFile(join(migrationsDirectory, filename), "utf8");
    const applyMigration = database.transaction(() => {
      const applied = database
        .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get(version);
      if (applied) return;

      if (filename === "007_track_cover_version.sql") {
        const columns = database.prepare("PRAGMA table_info(tracks)").all() as { name: string }[];
        const hasCoverVersion = columns.some((column) => column.name === "cover_version");
        if (!hasCoverVersion) database.exec(migration);
      } else {
        database.exec(migration);
      }
      database.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
    });
    applyMigration();
  }
}
