# TUI Vision Design

**Date**: 2026-02-20
**Status**: Vision document — captures direction, not implementation specifics

## What This Is

tuicraft currently has a readline-based chat interface and a daemon/IPC path
for programmatic access. This doc describes the vision for evolving the
human-facing interface from a line-mode chat client into a spatial, Dwarf
Fortress-inspired terminal application.

The architecture already supports this. `WorldHandle` is a clean contract
between protocol and presentation. The protocol layer has zero presentation
concerns. The daemon mode serves non-human consumers over IPC/JSONL. Other
frontends (web, Discord, etc.) could consume the same contract without any of
the work described here. This doc is about the human side.

Three capability layers, each building on the last, each independently
shippable.

## Layer 1: Chat TUI

Replace the readline interface with a proper terminal UI.

The current implementation has a fundamental problem: incoming messages and
the user's typing collide on the same output stream. `\r\x1b[K]` clears the
line before printing, but there's no layout — no separation between the chat
log and the input area.

**What this looks like:**

- Scrollable chat log filling most of the screen. Messages styled by type —
  whispers in one color, guild in another, system messages distinct. The
  formatting logic already categorizes by `ChatType`; this gives it a real
  canvas.
- Fixed input bar at the bottom, always visible, never clobbered by incoming
  messages. Shows the current chat mode (`[say]`, `[whisper: Thrall]`,
  `[guild]`).
- Status area — connection state, character name, party members if in a group.
  Light on chrome, heavy on information.

**Protocol dependencies:** None beyond what `WorldHandle` currently exposes.
Pure presentation work.

**Hard parts:** Building the raw ANSI renderer from scratch. Framebuffer
allocation, dirty-rect diffing, cursor management, terminal resize handling
(`SIGWINCH`). No library — the project has zero runtime dependencies and this
layer shouldn't change that.

**Scope boundary:** No spatial awareness, no map, no mouse input. Keyboard
only. This is the chat client done properly.

## Layer 2: Spatial Map

A top-down, Dwarf Fortress-inspired view of the world around the player. The
chat log shrinks to a panel; the rest of the screen becomes a map.

**What this looks like:**

- A grid centered on the player, roughly 1 terminal cell per yard. An 80x40
  grid covers interaction range. The player is an oriented arrow showing
  facing direction.
- Terrain rendered from heightmap data — elevation encoded as color gradients
  (greens at low elevation, browns to whites at peaks). Pathability flags from
  the navmesh distinguish walkable ground from obstacles.
- Entities from `SMSG_UPDATE_OBJECT` rendered as positioned characters. `@`
  for players, letters for NPCs/mobs, with color encoding hostility or type.
- Obstacles as lines or filled cells in a contrasting color. Walls, buildings,
  terrain boundaries — anything the navmesh marks non-walkable.
- Camera panning via keyboard (WASD or arrows). Right-click-drag via SGR mouse
  protocol is possible but requires per-terminal configuration. Keyboard
  panning is universally portable; mouse support is an optional enhancement.

**Protocol dependencies:** `SMSG_UPDATE_OBJECT` parsing — the single largest
protocol task. Variable-length bitmask encoding, ~150 unit fields, multiple
update types. Entity position tracking and movement updates.

**External dependencies:** namigator FFI for terrain data. The server never
sends geometry — it assumes the client has the data from MPQ archives.
namigator reads those files and provides `find_height(map_id, x, y)` across a
grid to build the heightmap, plus pathability for obstacle rendering. This
means compiling C++ via CMake, writing a thin C ABI wrapper, and calling
through `bun:ffi`.

**Verticality:** WoW terrain is mostly a heightmap — one height per (x, y)
point. Caves and multi-story interiors are separate map IDs or phased areas.
For the 90% outdoor case, a top-down view with height-as-color works. Edge
cases (bridges, Undercity) could use z-level slicing with keybinds, or be
deferred.

**Performance:** Dirty-rect diffing means a typical frame update touches
5-10% of cells. At a 200x60 terminal that's ~1KB of ANSI output per frame.
Server entity updates arrive at 10-15 Hz. 30fps rendering is more than
sufficient and achievable on any GPU-accelerated terminal (kitty, WezTerm,
Alacritty).

**Scope boundary:** No terrain type identification (grass vs road vs water),
no fog of war, no object labels.

## Layer 3: Annotated World

Layer 2 gives you a map of shapes and positions. Layer 3 gives those shapes
names.

**What this looks like:**

- Cursor mode — arrow keys move a highlight across the map, and a status line
  at the bottom shows what's under it. "Silvermoon BG Tower", "Bench
  (square)", "Blood Elf Banner". No clutter on the map itself unless a label
  overlay is toggled on.
- Optionally, an LLM-generated flavor layer. ADT placement records contain
  file paths like `World/wmo/Azeroth/Cities/Silvermoon/Silvermoon_BG_Tower.wmo`
  — remarkably descriptive. Parse the path mechanically for a raw label, then
  batch through a small model (Haiku-class) for evocative one-liners.
  _"A spire of living ruby and gold."_
- Results cached in a JSON file keyed by model path. A zone has maybe 50-200
  unique doodad/WMO types, not thousands. One-time generation cost is
  negligible. Users could regenerate with their own API key for different
  tones, or ship a pre-generated set.

**Dependencies beyond layer 2:** ADT file parsing for object placement
records. namigator gives heights and pathability but not object identity —
the placement tables from ADT files need to be read directly. This is a
separate data pipeline from the navmesh: extract placements once, store as a
lightweight index.

Terrain type identification is a related problem. Knowing whether a cell is
water, grass, or road requires either ADT area ID lookups or texture/material
layer parsing. Area IDs give coarse zone-level info; texture layers give
per-cell ground type. The former is easy, the latter is deep.

**Scope boundary:** No 3D rendering, no interior mapping, no real-time object
interaction. This is a read-only annotation layer over a spatial view.

## Cross-Cutting: The Renderer

All three layers share one piece of infrastructure: a raw ANSI terminal
renderer that owns the screen.

**Single-buffer writes.** Build the entire frame as one `Uint8Array` and flush
with one `process.stdout.write()` call. No cursor-move-then-print sequences.
At 200x60 that's ~12KB per frame undiffed, well under any terminal's
throughput ceiling.

**Dirty-rect diffing.** Maintain two framebuffers (current and previous). On
each render pass, compare cell-by-cell and emit ANSI only for changed regions.
After initial draw, typical updates touch a small fraction of cells — a new
chat message, an entity that moved, a health bar tick.

**Pre-allocated buffers.** No string-per-frame allocation. Reuse `Uint8Array`
framebuffers and an output buffer sized to worst-case. GC pressure is the only
real JavaScript concern at high refresh rates.

**Terminal capability detection.** Query `TERM`/`COLORTERM` for 256-color vs
truecolor support. Degrade gracefully — height-as-color in layer 2 works with
256 colors but looks better with 24-bit. Respond to `SIGWINCH` for resize.

**Mouse input** via SGR 1006 extended protocol (`\x1b[?1003h` for any-event
tracking). Button press/release, motion while held, modifier keys. Optional —
keyboard-first for portability, mouse enhances for terminals that support
passthrough (kitty, WezTerm). Right-click and middle-click drag require
terminal-side configuration to avoid context menu interception.

Layer 1 uses the renderer for layout (log panel, input bar, status line).
Layer 2 adds a high-frequency map viewport. Layer 3 adds a cursor overlay and
status line content. The renderer doesn't know about WoW — it knows about
cells, colors, and regions.

## Dependencies and Sequencing

**Layer 1** has no protocol or external dependencies. It's a presentation
rewrite over the existing `WorldHandle` contract. Actionable now.

**Layer 2** is blocked on two large pieces of work: `SMSG_UPDATE_OBJECT`
parsing (protocol) and namigator FFI (external C++ integration). These are
independent of each other and independent of layer 1. The map renderer itself
is independent of the chat TUI — they're separate panels that compose in the
same terminal.

**Layer 3** extends layer 2 with ADT placement parsing, which is a lighter
lift than namigator integration but still requires reading WoW client data
files. The LLM annotation pipeline is trivially parallelizable and cacheable.

Each layer is independently valuable. Layer 1 alone makes tuicraft a usable
chat client. Layer 2 makes it a spatial awareness tool. Layer 3 makes the
world legible to someone who's never seen it rendered in 3D.

## What This Isn't

This doc covers the human-facing terminal interface. The daemon/IPC path
remains the programmatic interface for LLMs, scripts, and other non-human
consumers. The `WorldHandle` contract serves both sides without either knowing
about the other.

This is also not an implementation plan. Each layer will get its own design
and plan documents when its dependencies are in place.
