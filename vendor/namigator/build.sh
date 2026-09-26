#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "${1:-tmp/namigator}" && cd "${1:-tmp/namigator}" && pwd)
repo=${NAMIGATOR_REPO:-https://github.com/namreeb/namigator.git}
commit=$(cat "$here/UPSTREAM")
src=$out/src
build=$out/build

if [ ! -d "$src/.git" ]; then
  git clone -q "$repo" "$src"
fi
git -C "$src" checkout -q --force "$commit"
git -C "$src" clean -qfdx
git -C "$src" submodule update -q --init --force recastnavigation stormlib
git -C "$src" apply "$here/corner-height.patch"
git -C "$src" apply "$here/boundary-rays.patch"
git -C "$src" apply "$here/surface-above-hint.patch"
git -C "$src" apply "$here/adt-edges.patch"

cmake -S "$src" -B "$build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DNAMIGATOR_BUILD_PYTHON=OFF \
  -DNAMIGATOR_INSTALL_TESTS=OFF \
  -DNAMIGATOR_BUILD_EXECUTABLES=OFF >/dev/null
cmake --build "$build" --target libpathfind utility Detour Recast >/dev/null

g++ -shared -o "$out/libnamigator.so" \
  -Wl,--whole-archive "$build/pathfind/liblibpathfind.a" -Wl,--no-whole-archive \
  "$build/utility/libutility.a" \
  "$build/recastnavigation/Detour/libDetour.a" \
  "$build/recastnavigation/Recast/libRecast.a" \
  -lstdc++ -pthread

symbols=$(nm -D --defined-only "$out/libnamigator.so")
grep -q " T pathfind_find_height$" <<<"$symbols"
echo "$out/libnamigator.so"
