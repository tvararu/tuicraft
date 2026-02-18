import { parseArgs } from "node:util";
import { authHandshake, worldSession } from "client";
import { startTui } from "tui";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    host: { type: "string", default: "t1" },
    port: { type: "string", default: "3724" },
    account: { type: "string" },
    password: { type: "string" },
    character: { type: "string" },
    language: { type: "string", default: "1" },
  },
});

if (!values.account || !values.password || !values.character) {
  console.error(
    "Usage: bun src/index.ts --account <account> --password <password> --character <name> [--host <host>] [--port <port>]",
  );
  process.exit(1);
}

const config = {
  host: values.host!,
  port: parseInt(values.port!, 10),
  account: values.account.toUpperCase(),
  password: values.password.toUpperCase(),
  character: values.character,
  language: parseInt(values.language!, 10),
};

async function main() {
  console.log(
    `Connecting to ${config.host}:${config.port} as ${config.account}...`,
  );
  const auth = await authHandshake(config);
  console.log(`Authenticated. Realm: ${auth.realmHost}:${auth.realmPort}`);
  const handle = await worldSession(config, auth);
  console.log(`Logged in as ${config.character}.`);
  await startTui(handle, process.stdin.isTTY ?? false);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
