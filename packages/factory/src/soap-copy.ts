export type SoapResult = { ok: boolean; text: string };
export type Names = { account: string; character: string };
export type Run = (command: string) => Promise<SoapResult>;
export type CopyTiming = {
  attempts: number;
  tries: number;
  pollMs: number;
  sleep: (ms: number) => Promise<unknown>;
};

export const copyTiming: CopyTiming = {
  attempts: 3,
  pollMs: 250,
  sleep: (ms) => Bun.sleep(ms),
  tries: 20,
};

const pinfoAccountLine = /Account:\s*([A-Za-z0-9_]+)/;
const copyTargetMissing = /Account '.*' does not exist/i;

export function pinfoAccount(text: string): string | undefined {
  return text.match(pinfoAccountLine)?.[1];
}

async function copyOnce(
  run: Run,
  command: string,
  { tries, pollMs, sleep }: CopyTiming,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const res = await run(command);
    if (res.ok) return;
    if (!copyTargetMissing.test(res.text))
      throw new Error(`pdump copy: ${res.text}`);
    await sleep(pollMs);
  }
  throw new Error(`${command}: account never became visible`);
}

async function waitForCharacter(
  run: Run,
  { account, character }: Names,
  { tries, pollMs, sleep }: CopyTiming,
): Promise<{ found: boolean; text: string }> {
  let text = "";
  for (let i = 0; i < tries; i++) {
    text = (await run(`pinfo ${character}`)).text;
    const owner = pinfoAccount(text);
    if (owner === account) return { found: true, text };
    if (owner)
      throw new Error(
        `pinfo ${character} names account ${owner}, expected ${account}`,
      );
    await sleep(pollMs);
  }
  return { found: false, text };
}

export async function copyConfirmed(
  run: Run,
  template: string,
  names: Names,
  timing = copyTiming,
): Promise<number> {
  const command = `pdump copy ${template} ${names.account} ${names.character}`;
  let last = "";
  for (let attempt = 1; attempt <= timing.attempts; attempt++) {
    await copyOnce(run, command, timing);
    const { found, text } = await waitForCharacter(run, names, timing);
    if (found) return attempt;
    last = text;
  }
  throw new Error(
    `pdump copy ${template}: ${names.character} missing on ${names.account} after ${timing.attempts} attempts: ${last}`,
  );
}
