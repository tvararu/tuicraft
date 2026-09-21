import { parseArgs } from "cli/args";
import { sendToSocket, ensureDaemon } from "cli/ipc";
import { formatSendOutput, daemonCommandFailed } from "cli/send-output";
import skillContent from "../.claude/skills/tuicraft/SKILL.md" with {
  type: "text",
};

const action = parseArgs(Bun.argv.slice(2));

async function waitForEvents(
  wait: number | undefined,
  json: boolean,
): Promise<void> {
  if (wait == null) return;
  const cmd = json ? "READ_WAIT_JSON" : "READ_WAIT";
  const lines = await sendToSocket(`${cmd} ${wait * 1000}`);
  for (const line of lines) console.log(line);
}

function printControlReply(lines: string[]): void {
  for (const line of lines) console.log(line);
  if (daemonCommandFailed(lines)) process.exit(1);
}

async function main() {
  switch (action.mode) {
    case "interactive": {
      const { authWithRetry } = await import("wow/auth");
      const { worldSession } = await import("wow/client");
      const { readConfig } = await import("lib/config");
      const { configPath } = await import("lib/paths");

      if (!(await Bun.file(configPath()).exists())) {
        if (!process.stdin.isTTY) {
          throw new Error(
            "No config found. Run 'tuicraft setup' to create one.",
          );
        }
        const { runSetup } = await import("cli/setup");
        await runSetup([]);
      }

      const cfg = await readConfig();
      const clientCfg = {
        host: cfg.host,
        port: cfg.port,
        account: cfg.account.toUpperCase(),
        password: cfg.password.toUpperCase(),
        character: cfg.character,
        language: cfg.language,
        spellDataDir: cfg.spell_data_dir,
        navigationDataDir: cfg.navigation_data_dir,
        navigationLibrary: cfg.navigation_library,
        jevApiKey: process.env["TYPESAFE_API_KEY"],
      };
      const auth = await authWithRetry(clientCfg);
      const handle = await worldSession(clientCfg, auth);
      const { startTui } = await import("ui/tui");
      await startTui(handle, process.stdin.isTTY ?? false);
      break;
    }
    case "daemon": {
      const { startDaemon } = await import("daemon/server");
      await startDaemon();
      break;
    }
    case "setup": {
      const { runSetup } = await import("cli/setup");
      await runSetup(action.args);
      break;
    }
    case "help": {
      const { helpText } = await import("cli/help");
      console.log(helpText());
      break;
    }
    case "version": {
      const pkg: { version: string } = await import("../package.json");
      console.log(pkg.version);
      break;
    }
    case "say":
    case "yell":
    case "guild":
    case "party": {
      await ensureDaemon();
      const cmd = `${action.mode.toUpperCase()} ${action.message}`;
      const lines = await sendToSocket(cmd);
      for (const line of formatSendOutput(lines, action.json, false))
        console.log(line);
      await waitForEvents(action.wait, action.json);
      break;
    }
    case "slash": {
      await ensureDaemon();
      const lines = await sendToSocket(action.input);
      for (const line of formatSendOutput(lines, action.json, true))
        console.log(line);
      await waitForEvents(action.wait, action.json);
      break;
    }
    case "whisper": {
      await ensureDaemon();
      const lines = await sendToSocket(
        `WHISPER ${action.target} ${action.message}`,
      );
      for (const line of formatSendOutput(lines, action.json, false))
        console.log(line);
      await waitForEvents(action.wait, action.json);
      break;
    }
    case "read": {
      await ensureDaemon();
      const base = action.json ? "READ_JSON" : "READ";
      const cmd =
        action.wait != null
          ? `${action.json ? "READ_WAIT_JSON" : "READ_WAIT"} ${action.wait * 1000}`
          : base;
      const lines = await sendToSocket(cmd);
      for (const line of lines) console.log(line);
      break;
    }
    case "tail": {
      await ensureDaemon();
      const verb = action.json ? "READ_WAIT_JSON" : "READ_WAIT";
      while (true) {
        const lines = await sendToSocket(`${verb} 1000`);
        for (const line of lines) console.log(line);
      }
      break;
    }
    case "start": {
      try {
        const lines = await sendToSocket("STATUS");
        if (lines.includes("CONNECTED")) {
          console.log("Daemon is already running.");
          break;
        }
      } catch {}
      await ensureDaemon();
      const lines = await sendToSocket("STATUS");
      for (const line of lines) console.log(line);
      break;
    }
    case "status": {
      try {
        const lines = await sendToSocket("STATUS");
        for (const line of lines) console.log(line);
      } catch {
        console.log("Daemon is not running.");
      }
      break;
    }
    case "stop": {
      try {
        const lines = await sendToSocket("STOP");
        for (const line of lines) console.log(line);
      } catch {
        console.log("Daemon is not running.");
      }
      break;
    }
    case "who": {
      await ensureDaemon();
      const verb = action.json ? "WHO_JSON" : "WHO";
      const cmd = action.filter ? `${verb} ${action.filter}` : verb;
      const lines = await sendToSocket(cmd);
      for (const line of lines) console.log(line);
      break;
    }
    case "control": {
      await ensureDaemon();
      const cmd = action.json ? "CONTROL_JSON" : "CONTROL";
      const lines = await sendToSocket(cmd);
      for (const line of lines) console.log(line);
      break;
    }
    case "move": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`MOVE ${action.direction} ${action.durationMs}`),
      );
      break;
    }
    case "face": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`FACE ${action.orientation}`));
      break;
    }
    case "target": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`TARGET 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "halt": {
      await ensureDaemon();
      printControlReply(await sendToSocket("HALT"));
      break;
    }
    case "nearby": {
      await ensureDaemon();
      const base = action.json ? "NEARBY_JSON" : "NEARBY";
      const cmd = action.all ? `${base} all` : base;
      const lines = await sendToSocket(cmd);
      for (const line of lines) console.log(line);
      break;
    }
    case "combat":
    case "spells":
    case "tactics":
    case "navigation":
    case "following":
    case "recovery":
    case "quests":
    case "inventory":
    case "loot": {
      await ensureDaemon();
      const verb = `${action.mode.toUpperCase()}${action.json ? "_JSON" : ""}`;
      const lines = await sendToSocket(verb);
      printControlReply(lines);
      break;
    }
    case "cast": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(
          `CAST ${action.spellId} 0x${action.guid.toString(16)}`,
        ),
      );
      break;
    }
    case "attack": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`ATTACK 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "cancel_cast": {
      await ensureDaemon();
      printControlReply(await sendToSocket("CANCEL_CAST"));
      break;
    }
    case "stop_attack": {
      await ensureDaemon();
      printControlReply(await sendToSocket("STOP_ATTACK"));
      break;
    }
    case "fight": {
      await ensureDaemon();
      const framingPart =
        action.framing && action.framing !== "none"
          ? `--framing ${action.framing} `
          : "";
      printControlReply(
        await sendToSocket(
          `FIGHT ${framingPart}0x${action.guid.toString(16)} ${action.instruction}`,
        ),
      );
      break;
    }
    case "open_loot": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`OPEN_LOOT 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "take_loot": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`TAKE_LOOT ${action.slot}`));
      break;
    }
    case "take_money":
    case "release_loot": {
      await ensureDaemon();
      printControlReply(await sendToSocket(action.mode.toUpperCase()));
      break;
    }
    case "talk": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`TALK 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "query_quest":
    case "select_quest":
    case "complete_quest": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`${action.mode.toUpperCase()} ${action.questId}`),
      );
      break;
    }
    case "select_option": {
      await ensureDaemon();
      const code = JSON.stringify(action.code ?? null);
      printControlReply(
        await sendToSocket(`SELECT_OPTION ${action.optionId} ${code}`),
      );
      break;
    }
    case "choose_reward": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`CHOOSE_REWARD ${action.index}`));
      break;
    }
    case "abandon_quest": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`ABANDON_QUEST ${action.slot}`));
      break;
    }
    case "accept_quest":
    case "request_reward":
    case "cancel_interaction": {
      await ensureDaemon();
      printControlReply(await sendToSocket(action.mode.toUpperCase()));
      break;
    }
    case "query_corpse":
    case "release_spirit":
    case "reclaim_corpse": {
      await ensureDaemon();
      printControlReply(await sendToSocket(action.mode.toUpperCase()));
      break;
    }
    case "resurrect": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`RESURRECT ${action.accept ? "accept" : "decline"}`),
      );
      break;
    }
    case "follow": {
      await ensureDaemon();
      const distance =
        action.distance === undefined ? "" : ` ${action.distance}`;
      printControlReply(
        await sendToSocket(`FOLLOW 0x${action.guid.toString(16)}${distance}`),
      );
      break;
    }
    case "goto": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`GOTO ${action.x} ${action.y} ${action.z}`),
      );
      break;
    }
    case "skill": {
      process.stdout.write(skillContent);
      break;
    }
    case "logs": {
      const { logPath } = await import("lib/paths");
      const file = Bun.file(logPath());
      if (await file.exists()) {
        console.log(await file.text());
      } else {
        console.log("No session log found.");
      }
      break;
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
