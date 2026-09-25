import { runPrecheck } from "factory/precheck";
import { runReap } from "factory/reaper";
import { runSetup } from "factory/setup";
import { runSoap } from "factory/soap-cli";

type Command = (args: string[]) => Promise<number>;

const commands: Record<string, Command> = {
  precheck: runPrecheck,
  reap: runReap,
  setup: runSetup,
  soap: runSoap,
};

const usage = `usage: bun src/factory/main.ts <command>

  precheck <worker|reviewer|merger|qa>   exit 0 when the role has work
  soap <create|delete|sweep|list> ...    per-run game accounts on t1
  reap [--dry-run]                        worktree and account backstop
  setup <labels|automations> [--apply]   create labels and automations`;

const [name, ...rest] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  console.error(usage);
  process.exit(2);
}
process.exit(await command(rest));
