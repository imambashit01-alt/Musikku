import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { build, Arch, Platform } from "electron-builder";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
dotenv.config({ path: join(projectRoot, ".env") });

function runNpmScript(script) {
  const windowsCommand = process.platform === "win32";
  const result = spawnSync(
    windowsCommand ? process.env.ComSpec : "npm",
    windowsCommand ? ["/d", "/s", "/c", `npm run ${script}`] : ["run", script],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const updateUrl = process.env.MUSIKKU_UPDATE_URL?.trim() ?? "";
if (updateUrl) {
  const parsedUrl = new URL(updateUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("MUSIKKU_UPDATE_URL harus memakai HTTPS.");
  }
}

runNpmScript("build");
runNpmScript("desktop:stage");

const generatedConfigPath = join(projectRoot, "build", "desktop-update-config.json");
await mkdir(dirname(generatedConfigPath), { recursive: true });
await writeFile(generatedConfigPath, JSON.stringify({ url: updateUrl }, null, 2));

const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const stagedRuntimePath = join(projectRoot, "build", "desktop-node.exe");
await copyFile(
  join(projectRoot, "node_modules", "node-win-x64", "bin", "node.exe"),
  stagedRuntimePath,
);
const config = {
  ...packageJson.build,
  extraResources: packageJson.build.extraResources.map((resource) =>
    resource.to === "server/node.exe" ? { ...resource, from: stagedRuntimePath } : resource,
  ),
  directories: {
    ...packageJson.build.directories,
    output: resolve(projectRoot, process.env.MUSIKKU_RELEASE_DIR ?? "release"),
  },
  ...(updateUrl ? { publish: [{ provider: "generic", url: updateUrl }] } : {}),
};

await build({
  targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
  config,
});
