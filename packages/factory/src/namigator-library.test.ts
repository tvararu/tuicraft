import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  installLibrary,
  type LibraryPaths,
  libraryKey,
  patchedLibrary,
  requirePatchedLibrary,
} from "#factory/namigator-library";

let root: string;
let paths: LibraryPaths;

beforeEach(async () => {
  root = await mkdtemp(`${tmpdir()}/namigator-library-`);
  paths = { store: `${root}/store`, vendor: `${root}/vendor` };
  await mkdir(paths.vendor);
  await writeFile(`${paths.vendor}/UPSTREAM`, "54eae69\n");
  await writeFile(`${paths.vendor}/build.sh`, "#!/bin/sh\n");
  await writeFile(`${paths.vendor}/a.patch`, "a\n");
  await writeFile(`${paths.vendor}/measure.ts`, "tool\n");
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("libraryKey", () => {
  test("changes with the upstream commit, a patch or the build script", async () => {
    const first = await libraryKey(paths.vendor);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(await libraryKey(paths.vendor)).toBe(first);
    const edits: [string, string][] = [
      ["UPSTREAM", "0000000\n"],
      ["a.patch", "b\n"],
      ["b.patch", "b\n"],
      ["build.sh", "#!/bin/bash\n"],
    ];
    const keys = new Set([first]);
    for (const [name, text] of edits) {
      await writeFile(`${paths.vendor}/${name}`, text);
      keys.add(await libraryKey(paths.vendor));
    }
    expect(keys.size).toBe(edits.length + 1);
  });

  test("ignores the measurement tools", async () => {
    const before = await libraryKey(paths.vendor);
    await writeFile(`${paths.vendor}/measure.ts`, "changed\n");
    expect(await libraryKey(paths.vendor)).toBe(before);
  });
});

describe("requirePatchedLibrary", () => {
  test("returns the keyed library path once it is installed", async () => {
    const path = await patchedLibrary(paths);
    expect(path).toBe(
      `${paths.store}/${await libraryKey(paths.vendor)}/libnamigator.so`,
    );
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await writeFile(path, "so");
    expect(await requirePatchedLibrary(paths)).toBe(path);
  });

  test("refuses a missing build and names the build task", async () => {
    const path = await patchedLibrary(paths);
    await expect(requirePatchedLibrary(paths)).rejects.toThrow(
      `patched namigator library missing at ${path}; run mise namigator:build`,
    );
  });

  test("refuses a build for another patch set", async () => {
    const old = await patchedLibrary(paths);
    await mkdir(old.slice(0, old.lastIndexOf("/")), { recursive: true });
    await writeFile(old, "so");
    await writeFile(`${paths.vendor}/a.patch`, "newer\n");
    await expect(requirePatchedLibrary(paths)).rejects.toThrow(
      "run mise namigator:build",
    );
  });
});

describe("installLibrary", () => {
  test("builds once, installs the keyed file and skips the next build", async () => {
    const builds: string[] = [];
    const build = async () => {
      const built = `${root}/built.so`;
      await writeFile(built, "library");
      builds.push(built);
      return built;
    };
    const first = await installLibrary(paths, build);
    expect(first).toEqual({ built: true, path: await patchedLibrary(paths) });
    expect(await Bun.file(first.path).text()).toBe("library");
    expect(await installLibrary(paths, build)).toEqual({
      built: false,
      path: first.path,
    });
    expect(builds).toHaveLength(1);
  });

  test("leaves nothing installed when the build fails", async () => {
    await expect(
      installLibrary(paths, () => Promise.reject(new Error("cmake failed"))),
    ).rejects.toThrow("cmake failed");
    expect(await Bun.file(await patchedLibrary(paths)).exists()).toBe(false);
  });
});
