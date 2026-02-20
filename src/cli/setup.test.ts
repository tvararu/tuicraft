import { test, expect, describe } from "bun:test";
import { PassThrough } from "node:stream";
import { parseSetupFlags, runSetupWizard } from "cli/setup";

describe("parseSetupFlags", () => {
  test("extracts all flags", () => {
    const args = [
      "--account",
      "x",
      "--password",
      "y",
      "--character",
      "Xia",
      "--host",
      "t1",
      "--port",
      "3724",
    ];
    const cfg = parseSetupFlags(args);
    expect(cfg.account).toBe("x");
    expect(cfg.password).toBe("y");
    expect(cfg.character).toBe("Xia");
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
  });

  test("uses defaults for missing optional flags", () => {
    const args = ["--account", "x", "--password", "y", "--character", "Xia"];
    const cfg = parseSetupFlags(args);
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
    expect(cfg.language).toBe(1);
    expect(cfg.timeout_minutes).toBe(30);
  });

  test("throws if required flags missing", () => {
    expect(() => parseSetupFlags(["--account", "x"])).toThrow();
  });

  test("throws on invalid --port value", () => {
    expect(() =>
      parseSetupFlags([
        "--account",
        "x",
        "--password",
        "y",
        "--character",
        "Z",
        "--port",
        "abc",
      ]),
    ).toThrow("Invalid --port value: abc");
  });
});

type MockRl = {
  output: PassThrough;
  question: (prompt: string, cb: (answer: string) => void) => void;
  close: () => void;
};

function setupMock(
  lines: string[],
  echoAnswer: (output: PassThrough, answer: string) => void,
): { factory: Parameters<typeof runSetupWizard>[0]; captured: () => string } {
  let lineIndex = 0;
  let buf = "";
  const output = new PassThrough();
  output.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
  });
  const mockRl: MockRl = {
    output,
    question(prompt: string, cb: (answer: string) => void) {
      const answer = lines[lineIndex++]!;
      if (prompt) output.write(prompt);
      echoAnswer(output, answer);
      cb(answer);
    },
    close() {},
  };
  const factory = (() => mockRl) as unknown as Parameters<
    typeof runSetupWizard
  >[0];
  return { factory, captured: () => buf };
}

describe("runSetupWizard password masking", () => {
  const lines = ["testuser", "s3cretP@ss", "Anatol", "t1", "3724", "1"];

  test("masks character-by-character echo", async () => {
    const { factory, captured } = setupMock(lines, (output, answer) => {
      for (const ch of answer) output.write(ch);
    });
    const cfg = await runSetupWizard(factory);

    expect(cfg.password).toBe("s3cretP@ss");
    expect(captured()).not.toContain("s3cretP@ss");
    expect(captured()).toContain("*".repeat("s3cretP@ss".length));
    expect(captured()).toContain("Password");
  });

  test("masks chunked echo (paste)", async () => {
    const { factory, captured } = setupMock(lines, (output, answer) => {
      output.write(answer);
    });
    const cfg = await runSetupWizard(factory);

    expect(cfg.password).toBe("s3cretP@ss");
    expect(captured()).not.toContain("s3cretP@ss");
    expect(captured()).toContain("*".repeat("s3cretP@ss".length));
    expect(captured()).toContain("Password");
  });
});
