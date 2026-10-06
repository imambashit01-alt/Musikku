const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const { randomBytes } = require("node:crypto");
const { fork } = require("node:child_process");
const { access, mkdir, readFile, readdir, stat, writeFile } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

let serverProcess;
let appWindow;
let backendOrigin;
let refreshTimer;
let updateState = { status: "unconfigured" };
let updateFeedUrl;

const supportedAudioExtensions = new Set([".flac", ".m4a", ".mp3", ".ogg", ".wav", ".wave"]);
const maximumLyricsSize = 1024 * 1024;

const appRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
const serverRoot = path.join(appRoot, "server");
const dataDirectory = path.join(app.getPath("userData"), "data");
const databasePath = path.join(dataDirectory, "musikku.sqlite");
const preferredPort = 32147;
const jwtTtlSeconds = 7 * 24 * 60 * 60;

function probePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () =>
      probe.close((error) => (error ? reject(error) : resolve(port))),
    );
  });
}

async function findAvailablePort() {
  try {
    return await probePort(preferredPort);
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Tidak dapat menentukan port lokal untuk Musikku."));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function getJwtSecret() {
  const secretPath = path.join(app.getPath("userData"), "jwt-secret");
  try {
    return await readFile(secretPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const secret = randomBytes(48).toString("base64url");
  try {
    await writeFile(secretPath, secret, { flag: "wx", mode: 0o600 });
    return secret;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readFile(secretPath, "utf8");
  }
}

async function startBackend() {
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const desktopAuthToken = randomBytes(32).toString("hex");
  await mkdir(dataDirectory, { recursive: true });
  const environment = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    DATA_DIRECTORY: dataDirectory,
    DATABASE_PATH: databasePath,
    JWT_SECRET: await getJwtSecret(),
    JWT_TTL_SECONDS: String(jwtTtlSeconds),
    OWNER_USERNAME: "Imam",
    OWNER_PASSWORD: randomBytes(48).toString("base64url"),
    DESKTOP_AUTH_TOKEN: desktopAuthToken,
    CLIENT_ORIGIN: origin,
  };
  if (app.isPackaged) delete environment.ELECTRON_RUN_AS_NODE;
  else environment.ELECTRON_RUN_AS_NODE = "1";
  const entry = path.join(serverRoot, "dist", "index.js");
  const runtime = app.isPackaged ? path.join(serverRoot, "node.exe") : process.execPath;

  if (app.isPackaged) await access(runtime);
  serverProcess = fork(entry, [], {
    cwd: serverRoot,
    env: environment,
    execPath: runtime,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serverProcess.stdout?.pipe(process.stdout);
  serverProcess.stderr?.pipe(process.stderr);
  serverProcess.once("error", (error) => {
    console.error("Musikku backend process failed:", error);
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
      throw new Error("Server Musikku berhenti sebelum siap. Periksa instalasi dan coba lagi.");
    }
    try {
      const response = await fetch(`${origin}/api/auth/me`, {
        signal: AbortSignal.timeout(800),
      });
      if (response.status === 401) return { origin, desktopAuthToken };
      throw new Error("Server Musikku menolak pemeriksaan kesiapan.");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  serverProcess.kill();
  serverProcess = undefined;
  throw new Error(
    "Server Musikku tidak merespons. Pastikan aplikasi dapat menulis ke folder data.",
  );
}

async function installSessionCookie(origin, response) {
  if (!response.ok) {
    throw new Error(`Autentikasi desktop gagal (${response.status}).`);
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  const cookieValue = setCookies
    .map((header) => header.match(/(?:^|,\s*)musikku_session=([^;,]+)/)?.[1])
    .find(Boolean);
  if (!cookieValue) throw new Error("Server Musikku tidak mengeluarkan sesi autentikasi.");

  await session.defaultSession.cookies.set({
    url: origin,
    name: "musikku_session",
    value: cookieValue,
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    expirationDate: Math.floor(Date.now() / 1000) + jwtTtlSeconds,
    path: "/",
  });
}

async function createDesktopSession(origin, desktopAuthToken) {
  const response = await fetch(`${origin}/api/auth/desktop-login`, {
    method: "POST",
    headers: { "X-Desktop-Token": desktopAuthToken },
    signal: AbortSignal.timeout(5000),
  });
  await installSessionCookie(origin, response);
  scheduleSessionRefresh(origin);
}

function scheduleSessionRefresh(origin, retry = false) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = retry ? 60_000 : Math.max(60_000, Math.floor((jwtTtlSeconds * 1000) / 2));
  refreshTimer = setTimeout(async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({ url: origin });
      const sessionCookie = cookies.find((cookie) => cookie.name === "musikku_session");
      if (!sessionCookie) throw new Error("Sesi lokal tidak ditemukan.");

      const response = await fetch(`${origin}/api/auth/desktop-refresh`, {
        method: "POST",
        headers: { Cookie: `musikku_session=${sessionCookie.value}` },
        signal: AbortSignal.timeout(5000),
      });
      await installSessionCookie(origin, response);
      scheduleSessionRefresh(origin);
    } catch (error) {
      console.error(
        "Sesi desktop gagal diperbarui:",
        error instanceof Error ? error.message : "Kesalahan yang tidak diketahui.",
      );
      scheduleSessionRefresh(origin, true);
    }
  }, delay);
  refreshTimer.unref?.();
}

function createAppWindow(origin) {
  backendOrigin = origin;
  Menu.setApplicationMenu(null);
  appWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 600,
    title: "Musikku",
    backgroundColor: "#111114",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(app.isPackaged ? process.resourcesPath : appRoot, "build", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  appWindow.once("ready-to-show", () => appWindow.show());
  appWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  appWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== origin && url !== `${origin}/`) event.preventDefault();
  });
  registerImportHandler();
  registerLyricsImportHandler();
  appWindow.loadURL(origin);
}

function sendUpdateState(nextState) {
  updateState = nextState;
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.webContents.send("musikku:update-state", updateState);
  }
}

function isTrustedAppRequest(event) {
  return (
    appWindow &&
    event.sender === appWindow.webContents &&
    backendOrigin &&
    event.sender.getURL().startsWith(`${backendOrigin}/`)
  );
}

function registerUpdateHandlers() {
  ipcMain.handle("musikku:update-state", (event) => {
    if (!isTrustedAppRequest(event)) throw new Error("Permintaan pembaruan tidak valid.");
    return updateState;
  });
  ipcMain.handle("musikku:check-updates", async (event) => {
    if (!isTrustedAppRequest(event)) throw new Error("Permintaan pembaruan tidak valid.");
    if (!updateFeedUrl) return updateState;
    sendUpdateState({ status: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      sendUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Pemeriksaan pembaruan gagal.",
      });
    }
    return updateState;
  });
  ipcMain.handle("musikku:download-update", async (event) => {
    if (!isTrustedAppRequest(event)) throw new Error("Permintaan pembaruan tidak valid.");
    if (updateState.status !== "available") return updateState;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      sendUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Unduhan pembaruan gagal.",
      });
    }
    return updateState;
  });
  ipcMain.handle("musikku:install-update", (event) => {
    if (!isTrustedAppRequest(event)) throw new Error("Permintaan pembaruan tidak valid.");
    if (updateState.status === "downloaded") autoUpdater.quitAndInstall();
    return updateState;
  });
}

async function configureAutoUpdater() {
  registerUpdateHandlers();
  if (!app.isPackaged) {
    sendUpdateState({ status: "unavailable" });
    return;
  }

  try {
    const configPath = path.join(process.resourcesPath, "desktop-update-config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (!config.url) {
      sendUpdateState({ status: "unconfigured" });
      return;
    }

    const feedUrl = new URL(config.url);
    if (feedUrl.protocol !== "https:") throw new Error("URL server update harus memakai HTTPS.");
    updateFeedUrl = feedUrl.toString();
    autoUpdater.setFeedURL({ provider: "generic", url: updateFeedUrl });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("checking-for-update", () => sendUpdateState({ status: "checking" }));
    autoUpdater.on("update-available", (info) =>
      sendUpdateState({ status: "available", version: info.version }),
    );
    autoUpdater.on("update-not-available", () => sendUpdateState({ status: "up-to-date" }));
    autoUpdater.on("download-progress", (progress) =>
      sendUpdateState({
        status: "downloading",
        percent: Math.round(progress.percent),
      }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      sendUpdateState({ status: "downloaded", version: info.version }),
    );
    autoUpdater.on("error", (error) =>
      sendUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Pemeriksaan pembaruan gagal.",
      }),
    );
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch((error) =>
        sendUpdateState({
          status: "error",
          message: error instanceof Error ? error.message : "Pemeriksaan pembaruan gagal.",
        }),
      );
    }, 1500).unref?.();
  } catch (error) {
    sendUpdateState({
      status: "error",
      message: error instanceof Error ? error.message : "Konfigurasi pembaruan tidak valid.",
    });
    console.error("Pemeriksaan pembaruan desktop tidak dapat dijalankan:", error);
  }
}

async function readSidecarLyrics(filePath) {
  const sidecarPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.lrc`,
  );
  try {
    const sidecarStats = await stat(sidecarPath);
    if (sidecarStats.size > maximumLyricsSize) throw new Error("File lirik melebihi ukuran 1 MB.");
    return await readFile(sidecarPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function collectAudioFiles(rootPath) {
  const audioFiles = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (
        entry.isFile() &&
        supportedAudioExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        audioFiles.push(entryPath);
      }
    }
  }
  await visit(rootPath);
  return audioFiles;
}

function registerImportHandler() {
  ipcMain.handle("musikku:import-audio", async (event, mode) => {
    if (
      !appWindow ||
      event.sender !== appWindow.webContents ||
      !backendOrigin ||
      !event.sender.getURL().startsWith(`${backendOrigin}/`)
    ) {
      return { imported: [], duplicates: 0, failures: ["Permintaan impor tidak valid."] };
    }
    if (mode !== "files" && mode !== "folder") {
      return { imported: [], duplicates: 0, failures: ["Jenis sumber impor tidak dikenal."] };
    }

    const selection = await dialog.showOpenDialog(appWindow, {
      title: mode === "folder" ? "Pilih folder musik" : "Pilih file musik",
      properties: mode === "folder" ? ["openDirectory"] : ["openFile", "multiSelections"],
      ...(mode === "files"
        ? {
            filters: [{ name: "File audio", extensions: ["mp3", "m4a", "flac", "wav", "ogg"] }],
          }
        : {}),
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return { imported: [], duplicates: 0, failures: [] };
    }

    const rootPath = mode === "folder" ? selection.filePaths[0] : undefined;
    const filePaths = rootPath ? await collectAudioFiles(rootPath) : selection.filePaths;
    const files = [];
    for (const filePath of filePaths) {
      if (!supportedAudioExtensions.has(path.extname(filePath).toLowerCase())) continue;
      const fileStats = await stat(filePath);
      files.push({
        filePath,
        relativePath: rootPath ? path.relative(rootPath, filePath) : path.basename(filePath),
        fileName: path.basename(filePath),
        size: fileStats.size,
      });
    }
    if (files.length === 0) {
      return {
        imported: [],
        duplicates: 0,
        failures: ["Folder tidak berisi file audio yang didukung."],
      };
    }

    const cookies = await session.defaultSession.cookies.get({ url: backendOrigin });
    const sessionCookie = cookies.find((cookie) => cookie.name === "musikku_session");
    if (!sessionCookie) {
      return {
        imported: [],
        duplicates: 0,
        failures: ["Sesi login tidak ditemukan. Keluar lalu masuk kembali, kemudian coba impor."],
      };
    }

    const imported = [];
    const failures = [];
    let duplicates = 0;
    for (const [index, file] of files.entries()) {
      try {
        const bytes = await readFile(file.filePath);
        const body = new FormData();
        body.append("file", new Blob([bytes], { type: "application/octet-stream" }), file.fileName);
        body.append("relativePath", file.relativePath);
        const sidecarLyrics = await readSidecarLyrics(file.filePath);
        if (sidecarLyrics) body.append("lyricsLrc", sidecarLyrics);
        const response = await fetch(`${backendOrigin}/api/tracks`, {
          method: "POST",
          headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
          body,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `Gagal mengunggah (${response.status}).`);
        imported.push(result);
        if (response.headers.get("x-track-duplicate") === "true") duplicates += 1;
      } catch (error) {
        failures.push(
          `${file.fileName}: ${error instanceof Error ? error.message : "Upload gagal."}`,
        );
      }
      event.sender.send("musikku:import-progress", {
        completed: index + 1,
        total: files.length,
        fileName: file.fileName,
      });
    }
    return { imported, duplicates, failures };
  });
}

function registerLyricsImportHandler() {
  ipcMain.handle("musikku:import-lyrics", async (event) => {
    if (
      !appWindow ||
      event.sender !== appWindow.webContents ||
      !backendOrigin ||
      !event.sender.getURL().startsWith(`${backendOrigin}/`)
    ) {
      throw new Error("Permintaan impor lirik tidak valid.");
    }

    const selection = await dialog.showOpenDialog(appWindow, {
      title: "Pilih file lirik",
      properties: ["openFile"],
      filters: [{ name: "File lirik", extensions: ["lrc", "txt"] }],
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;

    const filePath = selection.filePaths[0];
    const fileStats = await stat(filePath);
    if (fileStats.size > maximumLyricsSize) throw new Error("File lirik melebihi ukuran 1 MB.");
    return { name: path.basename(filePath), text: await readFile(filePath, "utf8") };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    try {
      const { origin, desktopAuthToken } = await startBackend();
      await createDesktopSession(origin, desktopAuthToken);
      createAppWindow(origin);
      void configureAutoUpdater();
    } catch (error) {
      console.error("Tidak dapat menjalankan Musikku:", error);
      dialog.showErrorBox(
        "Musikku tidak dapat dijalankan",
        error instanceof Error ? error.message : "Terjadi kesalahan saat menjalankan server.",
      );
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
        serverProcess = undefined;
      }
      app.quit();
    }
  });
}

app.on("before-quit", () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});

app.on("second-instance", () => {
  if (appWindow) {
    if (appWindow.isMinimized()) appWindow.restore();
    appWindow.focus();
  }
});

app.on("window-all-closed", () => app.quit());
