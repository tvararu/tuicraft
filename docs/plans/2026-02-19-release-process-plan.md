# Release Process Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate versioning, changelogs, and binary distribution via release-please and GitHub Actions.

**Architecture:** release-please watches main for conventional commits and opens a release PR with version bump + changelog. Merging the release PR creates a GitHub Release, which triggers a separate workflow that cross-compiles binaries and uploads them. A new `mise build:all` task handles cross-compilation locally too.

**Tech Stack:** release-please v4, GitHub Actions, Bun cross-compilation (`--target`)

---

### Task 1: Add version to package.json

**Files:**

- Modify: `package.json:1-2`

**Step 1: Add the version field**

Add `"version": "0.3.0"` after `"name"`:

```json
{
  "name": "tuicraft",
  "version": "0.3.0",
  "module": "src/main.ts",
```

**Step 2: Verify package.json is valid**

Run: `mise test`
Expected: All tests pass (version field doesn't affect anything)

**Step 3: Commit**

```
ci: add version field to package.json

Release-please needs a version field in package.json to track and
bump the current version on each release.
```

---

### Task 2: Add release-please config files

**Files:**

- Create: `.github/release-please-config.json`
- Create: `.github/.release-please-manifest.json`

**Step 1: Create the release-please config**

Create `.github/release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "bump-minor-pre-major": true,
  "bump-patch-for-minor-pre-major": true,
  "changelog-sections": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "perf", "section": "Performance" },
    { "type": "deps", "section": "Dependencies" },
    { "type": "docs", "section": "Documentation", "hidden": true },
    { "type": "chore", "section": "Miscellaneous", "hidden": true },
    { "type": "style", "section": "Miscellaneous", "hidden": true },
    { "type": "refactor", "section": "Miscellaneous", "hidden": true },
    { "type": "test", "section": "Tests", "hidden": true },
    { "type": "build", "section": "Build", "hidden": true },
    { "type": "ci", "section": "CI", "hidden": true }
  ],
  "packages": {
    ".": {}
  }
}
```

**Step 2: Create the manifest**

Create `.github/.release-please-manifest.json`:

```json
{
  ".": "0.3.0"
}
```

**Step 3: Commit**

```
ci: add release-please config and manifest

These two files configure release-please to manage versioning via
conventional commits. The config sets node release type, keeps
releases in 0.x range, and shows only user-facing changelog sections.
```

---

### Task 3: Add mise build:all task

**Files:**

- Modify: `mise.toml:17` (insert after `[tasks.build]`)

**Step 1: Add the build:all task**

Insert after the existing `[tasks.build]` block (after line 17):

```toml
[tasks."build:all"]
description = "Cross-compile binaries for all platforms"
run = '''
set -e
for target in bun-linux-x64 bun-linux-arm64 bun-darwin-x64 bun-darwin-arm64; do
  suffix="${target#bun-}"
  echo "Building ${suffix}..."
  bun build --compile --target="${target}" src/main.ts --outfile "dist/tuicraft-${suffix}"
done
echo "Done. Binaries in dist/"
'''
```

**Step 2: Test the task locally**

Run: `mise build:all`
Expected: Four binaries appear in `dist/`: `tuicraft-linux-x64`, `tuicraft-linux-arm64`, `tuicraft-darwin-x64`, `tuicraft-darwin-arm64`. Only the one matching your current platform is executable.

**Step 3: Commit**

```
feat: add mise build:all for cross-compilation

Bun supports cross-compiling to linux and darwin on both x64 and
arm64 from any host. This task produces platform-suffixed binaries
in dist/ for use in the release workflow.
```

---

### Task 4: Add release-please workflow

**Files:**

- Create: `.github/workflows/release-please.yml`

**Step 1: Create the workflow**

Create `.github/workflows/release-please.yml`:

```yaml
name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          config-file: .github/release-please-config.json
          manifest-file: .github/.release-please-manifest.json
```

**Step 2: Commit**

```
ci: add release-please workflow

Runs on every push to main and opens or updates a release PR with
version bump and changelog based on conventional commit history.
```

---

### Task 5: Add release build workflow

**Files:**

- Create: `.github/workflows/release.yml`

**Step 1: Create the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  release:
    types: [published]

permissions:
  contents: write

env:
  MISE_TASK_TIMEOUT: 60s

jobs:
  build:
    name: build / all platforms
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: jdx/mise-action@v3
        with: { cache: true, install: true }
      - run: mise bundle
      - run: mise build:all

      - name: Upload to release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release upload "${{ github.event.release.tag_name }}" \
            dist/tuicraft-*
```

Note: `MISE_TASK_TIMEOUT: 60s` is needed because cross-compilation is
slower than the default 1s task timeout.

**Step 2: Commit**

```
ci: add release build workflow

When release-please creates a GitHub Release, this workflow
cross-compiles binaries for all four platforms and uploads them
as release assets.
```
