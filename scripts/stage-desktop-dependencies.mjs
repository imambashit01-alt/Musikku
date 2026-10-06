import { execFileSync } from "node:child_process";
import { cp, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const rootNodeModules = join(projectRoot, "node_modules");
const serverNodeModules = join(projectRoot, "server", "node_modules");
const stagingDirectory = join(projectRoot, "build", "desktop-server-node-modules");
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("Jalankan staging dependensi melalui npm run desktop:stage.");
}

const dependencyPaths = execFileSync(
  process.execPath,
  [npmCli, "ls", "--workspace", "musikku-server", "--omit=dev", "--all", "--parseable"],
  { cwd: projectRoot, encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean);

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });

for (const dependencyPath of dependencyPaths) {
  const absolutePath = resolve(dependencyPath);
  if (!isAbsolute(dependencyPath) || absolutePath.startsWith(`${serverNodeModules}${sep}`)) {
    continue;
  }

  const relativePath = relative(rootNodeModules, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === "" ||
    relativePath.split(sep).some((part) => part === "musikku-server" || part === "musikku-client")
  ) {
    continue;
  }

  const source = await realpath(absolutePath);
  const destination = join(stagingDirectory, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
}
