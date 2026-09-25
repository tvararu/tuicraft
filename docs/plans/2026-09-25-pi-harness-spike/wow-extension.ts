// Inline Pi extension: owns one in-process tuicraft WorldHandle.
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, HStack, Text, type TUI, VStack } from "@earendil-works/pi-tui";
import { authWithRetry } from "../../../src/wow/auth";
import { type ChatMessage, type GroupEvent, type WorldHandle, worldSession } from "../../../src/wow/client";
import { clientConfig } from "../../../src/lib/config";
import type { EntityEvent, UnitEntity } from "../../../src/wow/entity-store";
import { ChatType } from "../../../src/wow/protocol/opcodes";
import { formatGroupEvent, formatMessage } from "../../../src/ui/format";
import { collectEntries, colorFor, type Pose, padTo, renderGrid, renderLegend } from "./map";

type Layout = "stack" | "side";
type ChatDetails = { chatType: number; sender: string; text: string };

const MAP_ROWS = 13;

export function createWowExtension(pi: ExtensionAPI): void {
	let handle: WorldHandle | undefined;
	let connecting = false;
	let tuiRef: TUI | undefined;
	let layout: Layout = (process.env.WOW_MAP_LAYOUT as Layout) ?? "side";
	let scale = 3; // yards per map row
	let wake = false; // whispers wake the agent
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let renders = 0;
	let entityEvents = 0;
	const character = process.env.WOW_CHARACTER_1 ?? "?";

	// --- state snapshot helpers -------------------------------------------------
	function selfPose(): Pose | undefined {
		return handle?.getControlState().pose;
	}
	function selfUnit(): UnitEntity | undefined {
		if (!handle) return undefined;
		const guid = handle.getControlState().selfGuid;
		return handle.getNearbyEntities().find((e) => e.guid === guid) as UnitEntity | undefined;
	}
	function entries() {
		if (!handle) return [];
		return collectEntries(handle.getNearbyEntities(), handle.getControlState().selfGuid, selfPose());
	}

	// --- widget -----------------------------------------------------------------
	function statusLine(theme: Theme): string {
		if (!handle) return theme.fg("muted", connecting ? `⏳ connecting ${character}…` : `○ offline — /connect to log in as ${character}`);
		const pose = selfPose();
		const me = selfUnit();
		const st = handle.getControlState();
		const hp = me?.maxHealth ? `HP ${me.health}/${me.maxHealth}` : "HP ?";
		const pos = pose ? `map ${pose.mapId} (${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}, ${pose.z.toFixed(1)})` : "no pose";
		const target = st.target ? handle.getNearbyEntities().find((e) => e.guid === st.target)?.name ?? "?" : "-";
		return [
			theme.fg("success", `● ${character}`) + (me?.level ? ` L${me.level}` : ""),
			hp,
			pos,
			`${entries().length} nearby`,
			`tgt ${target}`,
			`${scale}yd/row`,
			wake ? theme.fg("warning", "wake:on") : theme.fg("dim", "wake:off"),
			theme.fg("dim", `r${renders} e${entityEvents}`),
		].join(theme.fg("dim", " │ "));
	}

	class FnComponent implements Component {
		constructor(private readonly fn: (width: number) => string[]) {}
		render(width: number): string[] {
			return this.fn(width);
		}
		invalidate(): void {}
	}

	function buildWidget(tui: TUI, theme: Theme): Component & { dispose(): void } {
		tuiRef = tui;
		const status = new FnComponent((w) => {
			renders++;
			return [padTo(statusLine(theme), w)];
		});
		const legendRows = MAP_ROWS;
		if (layout === "side") {
			const grid = new FnComponent((w) => renderGrid(entries(), selfPose(), w, MAP_ROWS, scale, theme));
			const legend = new FnComponent((w) => renderLegend(entries(), w, legendRows, theme));
			const row = new HStack([{ component: grid, basis: 61, shrink: 1 }, { component: legend, grow: 1, minSize: 20 }], { gap: 2 });
			const root = new VStack([status, row]);
			return Object.assign(root, { dispose() {} });
		}
		const grid = new FnComponent((w) => renderGrid(entries(), selfPose(), Math.min(w, 81), MAP_ROWS, scale, theme));
		const legend = new FnComponent((w) => {
			const items = entries()
				.slice(0, 12)
				.map((e) => `${colorFor(e.kind, theme, e.glyph)} ${e.entity.name ?? "?"} ${theme.fg("muted", `${e.distance.toFixed(0)}y`)}`);
			return [padTo(items.join("  "), w)];
		});
		const root = new VStack([status, grid, legend]);
		return Object.assign(root, { dispose() {} });
	}

	function installWidget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("wow-map", (tui, theme) => buildWidget(tui, theme), { placement: "aboveEditor" });
	}

	function scheduleRender(): void {
		if (renderTimer) return;
		renderTimer = setTimeout(() => {
			renderTimer = undefined;
			tuiRef?.requestRender();
		}, 150);
	}

	// --- transcript feed ----------------------------------------------------------
	function pushChat(msg: ChatMessage): void {
		const text = formatMessage(msg);
		const isWhisper = msg.type === ChatType.WHISPER;
		pi.sendMessage<ChatDetails>(
			{ customType: "wow-chat", content: `[WoW] ${text}`, display: true, details: { chatType: msg.type, sender: msg.sender, text } },
			wake && isWhisper ? { triggerTurn: true, deliverAs: "followUp" } : { triggerTurn: false },
		);
	}
	function pushEvent(text: string): void {
		pi.sendMessage({ customType: "wow-event", content: `[WoW event] ${text}`, display: true }, { triggerTurn: false });
	}

	// Core-boundary note: WorldHandle.on*Event are single-subscriber setters; we register
	// exactly one callback per hook here and fan out (widget + transcript) ourselves.
	function wireHandle(h: WorldHandle): void {
		h.onMessage((msg) => {
			pushChat(msg);
			scheduleRender();
		});
		h.onGroupEvent((ev: GroupEvent) => {
			const text = formatGroupEvent(ev);
			if (text) pushEvent(text);
		});
		h.onEntityEvent((_ev: EntityEvent) => {
			entityEvents++;
			scheduleRender();
		});
	}

	async function connect(ctx: ExtensionContext): Promise<void> {
		if (handle || connecting) return ctx.ui.notify("already connected/connecting", "warning");
		const account = process.env.WOW_ACCOUNT_1;
		const password = process.env.WOW_PASSWORD_1;
		if (!account || !password) return ctx.ui.notify("WOW_ACCOUNT_1/WOW_PASSWORD_1 not set (run under mise)", "error");
		connecting = true;
		tuiRef?.requestRender();
		try {
			const cfg = clientConfig({
				account,
				password,
				character,
				host: process.env.WOW_HOST ?? "t1",
				port: Number(process.env.WOW_PORT ?? 3724),
				language: Number(process.env.WOW_LANGUAGE ?? 1),
				timeout_minutes: 30,
			});
			const auth = await authWithRetry(cfg, { maxAttempts: 2 });
			const h = await worldSession(cfg, auth);
			handle = h;
			wireHandle(h);
			void h.closed.then(() => {
				if (handle === h) handle = undefined;
				pushEvent("world session closed");
				tuiRef?.requestRender();
			});
			tickTimer ??= setInterval(() => tuiRef?.requestRender(), 1000);
			pushEvent(`logged in as ${character}`);
		} catch (err) {
			ctx.ui.notify(`connect failed: ${err instanceof Error ? err.message : String(err)}`, "error");
		} finally {
			connecting = false;
			tuiRef?.requestRender();
		}
	}

	function disconnect(): void {
		if (tickTimer) clearInterval(tickTimer);
		tickTimer = undefined;
		handle?.close();
		handle = undefined;
	}

	function need(ctx: ExtensionContext): WorldHandle | undefined {
		if (!handle) ctx.ui.notify("not connected — /connect first", "error");
		return handle;
	}

	// --- lifecycle --------------------------------------------------------------
	pi.on("session_start", (_ev, ctx) => {
		installWidget(ctx);
		if (process.env.WOW_AUTOCONNECT === "1") void connect(ctx);
	});
	pi.on("session_shutdown", () => disconnect());

	// Game harness: the editor's `!cmd` / `!!cmd` shell escape must not reach the host shell.
	pi.on("user_bash", () => ({ result: { output: "shell escapes are disabled in the WoW harness", exitCode: 1, cancelled: false, truncated: false } }));
	pi.registerMessageRenderer<ChatDetails>("wow-chat", (message, _opts, theme) => {
		const d = message.details;
		const t = d?.chatType;
		const color = t === ChatType.WHISPER || t === ChatType.WHISPER_INFORM ? "mdLink" : t === ChatType.PARTY || t === ChatType.PARTY_LEADER ? "accent" : t === ChatType.GUILD ? "success" : t === ChatType.SYSTEM ? "warning" : "text";
		return new Text(theme.fg(color, d?.text ?? String(message.content)), 1, 0);
	});
	pi.registerMessageRenderer("wow-event", (message, _opts, theme) => new Text(theme.fg("dim", String(message.content)), 1, 0));

	// --- human slash commands -------------------------------------------------
	pi.registerCommand("connect", { description: `Log into WoW as ${character}`, handler: async (_a, ctx) => connect(ctx) });
	pi.registerCommand("disconnect", { description: "Log out of WoW", handler: async () => disconnect() });
	const chatCmd = (name: string, description: string, send: (h: WorldHandle, msg: string) => void) =>
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				const h = need(ctx);
				if (h && args.trim()) send(h, args.trim());
			},
		});
	chatCmd("say", "/say <msg>", (h, m) => h.sendSay(m));
	chatCmd("yell", "/yell <msg>", (h, m) => h.sendYell(m));
	chatCmd("g", "/g <msg> — guild", (h, m) => h.sendGuild(m));
	chatCmd("p", "/p <msg> — party", (h, m) => h.sendParty(m));
	chatCmd("e", "/e <msg> — emote", (h, m) => h.sendEmote(m));
	pi.registerCommand("w", {
		description: "/w <name> <msg> — whisper",
		handler: async (args, ctx) => {
			const h = need(ctx);
			const m = args.trim().match(/^(\S+)\s+(.+)$/);
			if (!h) return;
			if (!m) return ctx.ui.notify("usage: /w <name> <message>", "error");
			h.sendWhisper(m[1]!, m[2]!);
		},
	});
	pi.registerCommand("zoom", {
		description: "/zoom <yards-per-row>",
		handler: async (args) => {
			const n = Number(args.trim());
			if (n > 0) scale = n;
			tuiRef?.requestRender();
		},
	});
	pi.registerCommand("maplayout", {
		description: "/maplayout stack|side",
		handler: async (args, ctx) => {
			layout = args.trim() === "stack" ? "stack" : "side";
			installWidget(ctx);
		},
	});
	pi.registerCommand("wake", {
		description: "/wake on|off — incoming whispers trigger an agent turn",
		handler: async (args) => {
			wake = args.trim() !== "off";
			tuiRef?.requestRender();
		},
	});

	// --- agent tools ------------------------------------------------------------
	const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: undefined });
	const requireHandle = () => {
		if (!handle) throw new Error("Not connected to WoW. Ask the human to run /connect.");
		return handle;
	};

	pi.registerTool({
		name: "wow_status",
		label: "WoW status",
		description: "Your character's current status: name, level, health, map and position, facing, current target.",
		parameters: Type.Object({}),
		async execute() {
			const h = requireHandle();
			const st = h.getControlState();
			const me = selfUnit();
			const target = st.target ? h.getNearbyEntities().find((e) => e.guid === st.target) : undefined;
			return text(
				JSON.stringify({
					character,
					level: me?.level,
					health: me ? `${me.health}/${me.maxHealth}` : undefined,
					pose: st.pose && { mapId: st.pose.mapId, x: +st.pose.x.toFixed(2), y: +st.pose.y.toFixed(2), z: +st.pose.z.toFixed(2), orientation: +st.pose.orientation.toFixed(2) },
					moving: st.moving,
					target: target?.name ?? null,
				}),
			);
		},
	});
	pi.registerTool({
		name: "wow_nearby",
		label: "WoW nearby",
		description: "List nearby entities (players, NPCs, creatures, objects) sorted by distance, with map glyph, level, health%, distance in yards.",
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "Max entries (default 20)" })),
			kind: Type.Optional(Type.Union([Type.Literal("player"), Type.Literal("npc"), Type.Literal("creature"), Type.Literal("object"), Type.Literal("dead")])),
		}),
		async execute(_id, params) {
			requireHandle();
			const list = entries()
				.filter((e) => !params.kind || e.kind === params.kind)
				.slice(0, params.limit ?? 20)
				.map((e) => {
					const u = e.entity as UnitEntity;
					return { glyph: e.glyph, name: e.entity.name ?? null, kind: e.kind, level: u.level, healthPct: u.maxHealth ? Math.round((100 * u.health) / u.maxHealth) : undefined, distance: +e.distance.toFixed(1) };
				});
			return text(JSON.stringify(list));
		},
	});
	pi.registerTool({
		name: "wow_say",
		label: "WoW say",
		description: "Say something out loud in /say chat (nearby players hear it).",
		parameters: Type.Object({ message: Type.String() }),
		async execute(_id, p) {
			requireHandle().sendSay(p.message);
			return text(`said: ${p.message}`);
		},
	});
	pi.registerTool({
		name: "wow_whisper",
		label: "WoW whisper",
		description: "Send a private whisper to a player by name.",
		parameters: Type.Object({ target: Type.String(), message: Type.String() }),
		async execute(_id, p) {
			requireHandle().sendWhisper(p.target, p.message);
			return text(`whispered ${p.target}: ${p.message}`);
		},
	});
	pi.registerTool({
		name: "wow_party",
		label: "WoW party",
		description: "Send a message to party chat.",
		parameters: Type.Object({ message: Type.String() }),
		async execute(_id, p) {
			requireHandle().sendParty(p.message);
			return text(`party: ${p.message}`);
		},
	});
	pi.registerTool({
		name: "wow_face",
		label: "WoW face",
		description: "Turn to face a nearby entity by (case-insensitive) name.",
		parameters: Type.Object({ name: Type.String() }),
		async execute(_id, p) {
			const h = requireHandle();
			const e = entries().find((x) => x.entity.name?.toLowerCase() === p.name.toLowerCase());
			if (!e) throw new Error(`no nearby entity named ${p.name}`);
			h.faceGuid(e.entity.guid);
			return text(`now facing ${e.entity.name} (${e.distance.toFixed(1)}y)`);
		},
	});
}
