import { parseArgs } from "cli/args";
import { sendToSocket, ensureDaemon, streamFromSocket } from "cli/ipc";
import { formatSendOutput } from "cli/send-output";

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

async function main() {
  switch (action.mode) {
    case "interactive": {
      const { authWithRetry, worldSession } = await import("wow/client");
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
      const cmd = action.json ? "SUBSCRIBE_JSON" : "SUBSCRIBE";
      const stream = await streamFromSocket(cmd, (line) => console.log(line));
      await stream.closed;
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
