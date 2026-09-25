// Copies *access tokens only* from omp's credential store into a spike-local Pi auth.json.
// The refresh token is deliberately NOT copied: OAuth refresh rotates the refresh token,
// which would silently log omp out. Pi will fail loudly once the access token expires;
// re-run this script (omp keeps the token fresh) to re-sync.
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const agentDir = join(import.meta.dir, "../../../tmp/pi-harness-spike/agent");
const db = new Database(`${process.env.HOME}/.omp/agent/agent.db`, { readonly: true });
const rows = db
	.query("select provider, data from auth_credentials where disabled_cause is null and credential_type = 'oauth' order by updated_at desc")
	.all() as { provider: string; data: string }[];

const wanted = new Set(["openai-codex", "anthropic"]);
const auth: Record<string, unknown> = {};
for (const row of rows) {
	if (!wanted.has(row.provider) || auth[row.provider]) continue;
	const d = JSON.parse(row.data);
	if (d.expires < Date.now()) continue;
	auth[row.provider] = {
		type: "oauth",
		access: d.access,
		refresh: "not-shared-with-omp",
		expires: d.expires,
		...(d.accountId ? { accountId: d.accountId } : {}),
	};
	console.log(`${row.provider}: access token valid until ${new Date(d.expires).toISOString()}`);
}
mkdirSync(agentDir, { recursive: true });
const path = join(agentDir, "auth.json");
writeFileSync(path, JSON.stringify(auth, null, 2));
chmodSync(path, 0o600);
console.log(`wrote ${path} (${Object.keys(auth).join(", ")})`);
