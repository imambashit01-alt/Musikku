import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { openDatabase } from "./db/database.js";
import { ensureOwnerAccount } from "./auth/auth.service.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const database = await openDatabase(config.databasePath);
  if (!config.desktopAuthToken) await ensureOwnerAccount(database, config);

  const app = createApp(database, config);
  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : config.port;
    if (process.send) process.send({ type: "server-ready", port: actualPort });
    console.info(`Musikku API berjalan di http://127.0.0.1:${actualPort}`);
  });

  const shutdown = () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error: unknown) => {
  console.error("Gagal menjalankan server:", error);
  process.exitCode = 1;
});
