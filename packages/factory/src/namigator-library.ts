import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type LibraryPaths = { vendor: string; store: string };
export type Build = () => Promise<string>;

const keyed = (name: string) =>
  name === "UPSTREAM" || name === "build.sh" || name.endsWith(".patch");

export function libraryPaths(): LibraryPaths {
  return {
    store: join(homedir(), ".local/share/tuicraft/namigator"),
    vendor: resolve(import.meta.dir, "../../../vendor/namigator"),
  };
}

export async function libraryKey(vendor: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const names = (await readdir(vendor)).filter(keyed).sort();
  for (const name of names)
    hasher
      .update(`${name}\0`)
      .update(await Bun.file(join(vendor, name)).bytes())
      .update("\0");
  return hasher.digest("hex").slice(0, 16);
}

export async function patchedLibrary(paths: LibraryPaths): Promise<string> {
  return join(paths.store, await libraryKey(paths.vendor), "libnamigator.so");
}

export async function requirePatchedLibrary(
  paths = libraryPaths(),
): Promise<string> {
  const path = await patchedLibrary(paths);
  if (await Bun.file(path).exists()) return path;
  throw new Error(
    `patched namigator library missing at ${path}; run mise namigator:build`,
  );
}

export async function installLibrary(
  paths: LibraryPaths,
  build: Build,
): Promise<{ path: string; built: boolean }> {
  const path = await patchedLibrary(paths);
  if (await Bun.file(path).exists()) return { built: false, path };
  const built = await build();
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.partial`;
  try {
    await copyFile(built, partial);
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return { built: true, path };
}

function buildScript(vendor: string): Build {
  return async () => {
    const out = resolve(vendor, "../../tmp/namigator");
    const proc = Bun.spawn([join(vendor, "build.sh"), out], {
      stderr: "inherit",
      stdout: "pipe",
    });
    const [text, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    const built = text.trim().split("\n").at(-1);
    if (code !== 0 || !built)
      throw new Error(`vendor/namigator/build.sh exited ${code}`);
    return built;
  };
}

if (import.meta.main) {
  const paths = libraryPaths();
  const { path } = await installLibrary(paths, buildScript(paths.vendor));
  console.log(path);
}
