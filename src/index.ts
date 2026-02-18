import { parseArgs, sendToSocket, ensureDaemon } from "cli";

const action = parseArgs(Bun.argv.slice(2));

async function main() {
  switch (action.mode) {
    case "interactive": {
      const { authHandshake, worldSession } = await import("client");
      const { readConfig } = await import("config");
      const cfg = await readConfig();
      const clientCfg = {
        host: cfg.host,
        port: cfg.port,
        account: cfg.account.toUpperCase(),
        password: cfg.password.toUpperCase(),
        character: cfg.character,
        language: cfg.language,
      };
      const auth = await authHandshake(clientCfg);
      const handle = await worldSession(clientCfg, auth);
      const { startTui } = await import("tui");
      await startTui(handle, process.stdin.isTTY ?? false);
      break;
    }
    case "daemon": {
      const { startDaemon } = await import("daemon");
      await startDaemon();
      break;
    }
    case "setup": {
      const { runSetup } = await import("setup");
      await runSetup(action.args);
      break;
    }
    case "help": {
      const { helpText } = await import("help");
      console.log(helpText());
      break;
    }
    case "say":
    case "yell":
    case "guild":
    case "party": {
      await ensureDaemon();
      const cmd = `${action.mode.toUpperCase()} ${action.message}`;
      const lines = await sendToSocket(cmd);
      if (action.json) {
        console.log(JSON.stringify({ status: "ok" }));
      } else {
        for (const line of lines) console.log(line);
      }
      break;
    }
    case "whisper": {
      await ensureDaemon();
      const lines = await sendToSocket(
        `WHISPER ${action.target} ${action.message}`,
      );
      if (action.json) {
        console.log(JSON.stringify({ status: "ok" }));
      } else {
        for (const line of lines) console.log(line);
      }
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
      const { logPath } = await import("paths");
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
