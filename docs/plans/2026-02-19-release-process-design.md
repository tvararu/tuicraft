# Release Process Design

## Goal

Automate versioning, changelogs, and binary distribution using release-please
and GitHub Actions. On merge to main, release-please opens/updates a release PR
with a version bump and changelog. Merging the release PR creates a GitHub
Release, which triggers a build workflow that cross-compiles and uploads
binaries.

## Version

Start at 0.3.0 (matches current roadmap milestone). Add `"version": "0.3.0"`
to package.json. Release-please bumps this automatically on each release.

## Release-Please Config

`release-type: node` — bumps package.json version and generates CHANGELOG.md.

`bump-minor-pre-major` and `bump-patch-for-minor-pre-major` both true — all
changes stay in 0.x range until an explicit 1.0 decision.

Changelog sections: show feat, fix, perf, deps. Hide docs, chore, style,
refactor, test, build, ci. Hidden commits are omitted entirely from the
changelog (release-please has no "collapsed" mode). When the
`include-commit-authors` PR lands upstream, add that flag to show `(@username)`
attribution.

Two config files:

- `.github/release-please-config.json` — release type, changelog sections
- `.github/.release-please-manifest.json` — current version (`{ ".": "0.3.0" }`)

## Cross-Compilation

`mise build:all` task loops over four Bun targets: `bun-linux-x64`,
`bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`. Outputs
`dist/tuicraft-{os}-{arch}`. Bun cross-compiles without needing the target OS.

## GitHub Actions Workflows

### release-please.yml

Triggers on push to main. Calls `googleapis/release-please-action@v4` with the
config and manifest files. Outputs `release_created`, `tag_name`, `version` for
downstream use.

### release.yml

Triggers on `release: published`. Checks out code, installs dependencies via
mise, runs `mise build:all`, uploads `dist/tuicraft-*` to the GitHub Release
via `gh release upload`.

## Not In Scope

Install script, GitHub Pages site, README install section — separate effort.
