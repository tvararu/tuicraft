// Bun entrypoint: embeds stock Pi (SDK + InteractiveMode) with an inline WoW extension.
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	InteractiveMode,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { createWowExtension } from "./wow-extension";

const agentDir = join(import.meta.dir, "../../../tmp/pi-harness-spike/agent"); // isolated from ~/.pi
// utils/tools-manager.js captures getBinDir() at module load (fd/rg auto-download), so the env var
// must be set before Pi's modules are evaluated — i.e. by the launcher, not here.
if (process.env.PI_CODING_AGENT_DIR !== agentDir) throw new Error(`launch with PI_CODING_AGENT_DIR=${agentDir}`);
const cwd = join(import.meta.dir, "../../../tmp/pi-harness-spike/workspace"); // empty dir: no AGENTS.md / .pi discovery
await Bun.write(join(cwd, ".keep"), "");

const SYSTEM_PROMPT = `You are an agent playing World of Warcraft (3.3.5a) as the character ${process.env.WOW_CHARACTER_1}.
A human is watching and steering you from a terminal. You act in the world only through the wow_* tools.
Incoming game chat and events appear in the conversation as messages prefixed "[WoW]" / "[WoW event]".
Keep in-game chat short and in character. Never reveal account details.`;

const [provider, modelId] = (process.env.PI_MODEL ?? "openai-codex/gpt-6-sol").split("/") as [string, string];

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
	const settingsManager = SettingsManager.inMemory({ quietStartup: true, compaction: { enabled: false } });
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		modelRuntime,
		settingsManager,
		resourceLoaderOptions: {
			noExtensions: true, // no discovery of ~/.pi or project extensions
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
			systemPrompt: SYSTEM_PROMPT,
			extensionFactories: [{ name: "wow", factory: createWowExtension }],
		},
	});
	const created = await createAgentSessionFromServices({
		services,
		sessionManager,
		sessionStartEvent,
		model: modelRuntime.getModel(provider, modelId),
		thinkingLevel: "low",
		noTools: "builtin", // drop read/bash/edit/write, keep extension tools
	});
	return { ...created, services, diagnostics: services.diagnostics };
};

const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
await Bun.write(join(import.meta.dir, "../../../tmp/pi-harness-spike/effective-system-prompt.txt"), `${runtime.session.systemPrompt}\n\nTOOLS: ${runtime.session.getActiveToolNames().join(", ")}\n`);
initTheme(runtime.services.settingsManager.getTheme(), true);
const mode = new InteractiveMode(runtime, { startupDiagnostics: runtime.diagnostics, modelFallbackMessage: runtime.modelFallbackMessage });
await mode.run();
