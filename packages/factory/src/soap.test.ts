import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { serializeConfig } from "@tuicraft/core/lib/config";
import {
  accountAgeHours,
  accountName,
  assertFactory,
  characterName,
  envelope,
  factoryAccount,
  hasTriple,
  navConfig,
  newNames,
  newPassword,
  parseEnv,
  parseResponse,
} from "#factory/soap";
import { pinfoAccount } from "#factory/soap-copy";

describe("names", () => {
  test("account is FAC + 8 hex seconds + 2 random, uppercase", () => {
    expect(accountName(0x6a_b6_e0_5f, "5a")).toBe("FAC6AB6E05F5A");
    expect(accountName(0x1, "0f")).toBe("FAC000000010F");
  });

  test("character maps hex digits to a-p", () => {
    expect(characterName("FAC6AB6E05F5A")).toBe("Fgklgoafpfk");
  });

  test("new names match the sweep regex and carry the time", () => {
    const now = 0x6a_b6_e0_5f * 1000 + 999;
    const { account, character } = newNames(now, () => "5a");
    expect(account).toBe("FAC6AB6E05F5A");
    expect(character).toBe("Fgklgoafpfk");
    expect(factoryAccount.test(account)).toBe(true);
  });

  test("triple letters are detected case-insensitively", () => {
    expect(hasTriple("Faaab")).toBe(true);
    expect(hasTriple("Fffab")).toBe(true);
    expect(hasTriple("Faabb")).toBe(false);
  });

  test("random part is regenerated on a triple", () => {
    const randoms = ["00", "12"];
    const { account } = newNames(
      0x6a_b6_e0_50 * 1000,
      () => randoms.shift() ?? "34",
    );
    expect(account).toBe("FAC6AB6E05012");
  });

  test("seconds advance when the time digits hold a triple", () => {
    const { account, character } = newNames(0x6a_aa_00_00 * 1000, () => "12");
    expect(hasTriple(character)).toBe(false);
    expect(Number.parseInt(account.slice(3, 11), 16)).toBeGreaterThan(
      0x6a_aa_00_00,
    );
  });

  test("password is 16 alphanumerics", () => {
    expect(newPassword()).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});

describe("factory guard", () => {
  test.each([
    "ADMIN",
    "DEITY",
    "X",
    "Y",
    "AUCTIONHOUSE",
    "TCFACTORY",
    "TCPRESETS",
    "RNDBOT001",
    "FACTORY",
  ])("refuses %s", (name) => expect(() => assertFactory(name)).toThrow());

  test("refuses near misses", () => {
    expect(() => assertFactory("FAC6AB6E05F5")).toThrow();
    expect(() => assertFactory("FAC6AB6E05F5AB")).toThrow();
    expect(() => assertFactory("fac6ab6e05f5a")).toThrow();
    expect(() => assertFactory("FAC6AB6E05G5A")).toThrow();
  });

  test("accepts factory accounts", () => {
    expect(() => assertFactory("FAC6AB6E05F5A")).not.toThrow();
  });
});

describe("accountAgeHours", () => {
  test("reads the seconds back from the name", () => {
    const now = (0x6a_b6_e0_5f + 3 * 3600) * 1000;
    expect(accountAgeHours("FAC6AB6E05F5A", now)).toBe(3);
  });

  test("refuses non-factory names", () => {
    expect(() => accountAgeHours("TCFACTORY")).toThrow();
  });
});

describe("SOAP", () => {
  test("envelope escapes & < >", () => {
    expect(envelope("say a&b <c>")).toContain(
      "<command>say a&amp;b &lt;c&gt;</command>",
    );
  });

  test("result is ok with carriage-return entities stripped", () => {
    const xml = `<SOAP-ENV:Body><ns1:executeCommandResponse><result>Account created: FAC6AB6E05F5A&#xD;
</result></ns1:executeCommandResponse></SOAP-ENV:Body>`;
    expect(parseResponse(xml)).toEqual({
      ok: true,
      text: "Account created: FAC6AB6E05F5A",
    });
  });

  test("fault is not ok and carries the fault string", () => {
    const xml = `<SOAP-ENV:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>Character 'Fgklgoafpfk' does not exist.&#xD;
</faultstring></SOAP-ENV:Fault>`;
    expect(parseResponse(xml)).toEqual({
      ok: false,
      text: "Character 'Fgklgoafpfk' does not exist.",
    });
  });

  test("unrecognised body is not ok", () => {
    expect(parseResponse("").ok).toBe(false);
    expect(parseResponse("<html>401</html>")).toEqual({
      ok: false,
      text: "<html>401</html>",
    });
  });

  test("entities in the text are decoded", () => {
    expect(parseResponse("<result>a &lt;b&gt; &amp; c</result>").text).toBe(
      "a <b> & c",
    );
  });
});

describe("pinfoAccount", () => {
  test("reads the owning account", () => {
    const text = `| Player Fgklgoafpfk (offline) (guid: 2515)
| Account: FAC6AB6E05F5A (ID: 309),
   GMLevel: 0
| Level: 10 (0/7600 XP (7600 XP left))`;
    expect(pinfoAccount(text)).toBe("FAC6AB6E05F5A");
  });

  test("returns undefined without an Account line", () => {
    expect(
      pinfoAccount("Character 'Fgklgoafpfk' does not exist."),
    ).toBeUndefined();
  });
});

describe("parseEnv", () => {
  test("reads KEY=VALUE lines and strips quotes", () => {
    const env = parseEnv(
      `TUICRAFT_SOAP_URL=http://t1:7878/\n# note\nTUICRAFT_SOAP_USER="TCFACTORY"\n\n`,
    );
    expect(env).toEqual({
      TUICRAFT_SOAP_URL: "http://t1:7878/",
      TUICRAFT_SOAP_USER: "TCFACTORY",
    });
  });
});

describe("navConfig", () => {
  const patched = "/store/0123456789abcdef/libnamigator.so";

  test("uses the patched library and copies only the data paths", async () => {
    const dir = await mkdtemp(`${tmpdir()}/soap-nav-`);
    try {
      const path = `${dir}/config.toml`;
      await writeFile(
        path,
        serializeConfig({
          account: "ME",
          character: "Me",
          host: "t1",
          language: 1,
          navigation_data_dir: "/data/nav",
          navigation_library: "/home/me/old/libnamigator.so",
          password: "secret",
          port: 3724,
          spell_data_dir: "/data/spells",
          timeout_minutes: 30,
        }),
      );
      expect(await navConfig(path, async () => patched)).toEqual({
        navigation_data_dir: "/data/nav",
        navigation_library: patched,
        spell_data_dir: "/data/spells",
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("sets the patched library without a maintainer config", async () => {
    expect(
      await navConfig("/missing/config.toml", async () => patched),
    ).toEqual({ navigation_library: patched });
  });

  test("refuses when the patched library is missing", async () => {
    const missing = () => Promise.reject(new Error("run mise namigator:build"));
    await expect(navConfig("/missing/config.toml", missing)).rejects.toThrow(
      "run mise namigator:build",
    );
  });
});
