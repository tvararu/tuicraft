import { describe, expect, test } from "bun:test";
import {
  isPreset,
  presetEnvKey,
  presetLanguage,
  presetSpecs,
  presets,
  templateFor,
} from "#factory/soap-presets";

describe("presets", () => {
  test("keeps the original three and adds the t1 service presets", () => {
    expect(presets).toEqual([
      "fresh",
      "eversong10",
      "max80",
      "eversong10-warrior",
      "eversong10-mage",
      "eversong10-hunter",
      "elwynn1",
      "elwynn10",
      "ghostlands20",
    ]);
    expect([...presets].sort() as string[]).toEqual(
      Object.keys(presetSpecs).sort(),
    );
  });

  test("names each template character and start point", () => {
    expect(presetSpecs["eversong10-hunter"]).toMatchObject({
      map: 530,
      template: "Tplhunter",
      x: 8735,
      y: -6685,
    });
    expect(presetSpecs.elwynn10).toMatchObject({
      map: 0,
      template: "Tplgoldshire",
      x: -9455,
      y: 55,
    });
    expect(presetSpecs.ghostlands20.template).toBe("Tplghost");
    expect(presetSpecs.elwynn1.template).toBe("Tplelwynn");
  });

  test("recognises only known names", () => {
    expect(isPreset("elwynn1")).toBe(true);
    expect(isPreset("elwynn2")).toBe(false);
  });

  test("env keys use underscores so soap.env can hold them", () => {
    expect(presetEnvKey("eversong10-hunter")).toBe(
      "TUICRAFT_PRESET_EVERSONG10_HUNTER",
    );
    expect(presetEnvKey("fresh")).toBe("TUICRAFT_PRESET_FRESH");
  });

  test("soap.env overrides the built-in template", () => {
    expect(templateFor("fresh", {})).toBe("Tplfresh");
    expect(templateFor("fresh", { TUICRAFT_PRESET_FRESH: "Other" })).toBe(
      "Other",
    );
    expect(
      templateFor("eversong10-mage", {
        TUICRAFT_PRESET_EVERSONG10_MAGE: "Mage2",
      }),
    ).toBe("Mage2");
  });

  test("Alliance presets speak Common, Horde presets Orcish", () => {
    expect(presetLanguage("elwynn1")).toBe(7);
    expect(presetLanguage("elwynn10")).toBe(7);
    expect(presetLanguage("eversong10-warrior")).toBe(1);
    expect(presetLanguage("fresh")).toBe(1);
  });
});
