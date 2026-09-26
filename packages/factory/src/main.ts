import { runStatus } from "#factory/board";
import { runPace } from "#factory/pace";
import { runSamePatch } from "#factory/patch";
import { runLandings, runPrecheck } from "#factory/precheck";
import { runQaChanges } from "#factory/qa-changes";
import { runReap } from "#factory/reaper";
import { runSetup } from "#factory/setup";
import { runSoap } from "#factory/soap-cli";
import { runSquashMessage } from "#factory/squash";

type Command = (args: string[]) => Promise<number>;

const commands: Record<string, Command> = {
  landings: runLandings,
  pace: runPace,
  precheck: runPrecheck,
  "qa-changes": runQaChanges,
  reap: runReap,
  "same-patch": runSamePatch,
  setup: runSetup,
  soap: runSoap,
  "squash-message": runSquashMessage,
  status: runStatus,
};

const usage = `usage: bun packages/factory/src/main.ts <command>

  pace [default|max]                      show or set the factory pace
  precheck <role> [--dry-run]             exit 0 when the role has work
  status <issue> [<status>]               show or set the card's board Status
  landings                                JSON of live merger landing markers
  qa-changes <prev> <sha>                 JSON of commits -> PRs -> issues
  same-patch <base>..<old> <base>..<new>  exit 0 when -U0 patches match
  squash-message <pr>                     JSON subject and body to land
  soap <create|delete|sweep|list> ...    per-run game accounts on t1
  soap <health|truth|setup|reset> ...    t1 service reads and setup
  reap [--dry-run]                        worktree, account, prompt backstop
  setup <automations|wrapper> [--apply]  automations, omp wrapper link`;

const [name, ...rest] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  console.error(usage);
  process.exit(2);
}
process.exit(await command(rest));
