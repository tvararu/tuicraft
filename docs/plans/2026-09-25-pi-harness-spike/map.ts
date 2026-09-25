// Entity-only top-down ASCII map. WoW coords: +x = north, +y = west.
// Screen: up = north, right = east. Terminal cells are ~2:1 (h:w), so one row = `scale`
// yards and one column = scale/2 yards to keep the map roughly isotropic.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Entity, UnitEntity } from "../../../src/wow/entity-store";
import { ObjectType } from "../../../src/wow/protocol/entity-fields";

export type Pose = { x: number; y: number; z: number; orientation: number; mapId: number };

export type MapEntry = {
	glyph: string;
	entity: Entity;
	distance: number;
	kind: "player" | "npc" | "creature" | "dead" | "object";
};

const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function kindOf(e: Entity): MapEntry["kind"] | undefined {
	if (e.objectType === ObjectType.PLAYER) return "player";
	if (e.objectType === ObjectType.UNIT) {
		const u = e as UnitEntity;
		if (u.maxHealth > 0 && u.health === 0) return "dead";
		return u.npcFlags ? "npc" : "creature";
	}
	if (e.objectType === ObjectType.GAMEOBJECT) return "object";
	return undefined;
}

export function colorFor(kind: MapEntry["kind"], theme: Theme, s: string): string {
	switch (kind) {
		case "player":
			return theme.bold(theme.fg("accent", s));
		case "npc":
			return theme.fg("success", s);
		case "creature":
			return theme.fg("error", s);
		case "dead":
			return theme.fg("dim", s);
		case "object":
			return theme.fg("muted", s);
	}
}

export function collectEntries(entities: Entity[], selfGuid: bigint, pose: Pose | undefined): MapEntry[] {
	if (!pose) return [];
	const entries: Omit<MapEntry, "glyph">[] = [];
	for (const e of entities) {
		if (e.guid === selfGuid || !e.position || e.position.mapId !== pose.mapId) continue;
		const kind = kindOf(e);
		if (!kind) continue;
		const distance = Math.hypot(e.position.x - pose.x, e.position.y - pose.y);
		entries.push({ entity: e, distance, kind });
	}
	entries.sort((a, b) => a.distance - b.distance);
	return entries.map((e, i) => ({ ...e, glyph: GLYPHS[i] ?? (e.kind === "object" ? "*" : "·") }));
}

const ARROWS = ["↑", "↖", "←", "↙", "↓", "↘", "→", "↗"];

export function renderGrid(entries: MapEntry[], pose: Pose | undefined, cols: number, rows: number, scale: number, theme: Theme): string[] {
	const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => theme.fg("dim", "·")));
	const cx = Math.floor(cols / 2);
	const cy = Math.floor(rows / 2);
	if (!pose) {
		const msg = "no position yet";
		const row = grid[cy]!;
		for (let i = 0; i < msg.length && cx - 7 + i < cols; i++) row[Math.max(0, cx - 7 + i)] = theme.fg("warning", msg[i]!);
		return grid.map((r) => r.join(""));
	}
	// Draw far-to-near so nearer entities win a shared cell.
	for (const e of [...entries].reverse()) {
		const p = e.entity.position!;
		const north = p.x - pose.x;
		const east = -(p.y - pose.y);
		const col = cx + Math.round(east / (scale / 2));
		const row = cy - Math.round(north / scale);
		if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
		grid[row]![col] = colorFor(e.kind, theme, e.glyph);
	}
	// orientation: 0 = north, increases counter-clockwise (toward west).
	const octant = Math.round(((pose.orientation % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 4)) % 8;
	grid[cy]![cx] = theme.bold(theme.fg("warning", "@"));
	if (cx + 1 < cols) grid[cy]![cx + 1] = theme.fg("warning", ARROWS[octant]!);
	return grid.map((r) => r.join(""));
}

export function renderLegend(entries: MapEntry[], width: number, rows: number, theme: Theme): string[] {
	const lines: string[] = [];
	for (const e of entries.slice(0, rows)) {
		const u = e.entity as UnitEntity;
		const hp = "maxHealth" in u && u.maxHealth ? ` ${Math.round((100 * u.health) / u.maxHealth)}%` : "";
		const lvl = "level" in u && u.level ? ` L${u.level}` : "";
		const text = `${colorFor(e.kind, theme, e.glyph)} ${e.entity.name ?? `#${e.entity.entry}`}${theme.fg("muted", `${lvl}${hp} ${e.distance.toFixed(0)}y`)}`;
		lines.push(truncateToWidth(text, width));
	}
	return lines;
}

export function padTo(line: string, width: number): string {
	const w = visibleWidth(line);
	return w >= width ? truncateToWidth(line, width) : line + " ".repeat(width - w);
}
