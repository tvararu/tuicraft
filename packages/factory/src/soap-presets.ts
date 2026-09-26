export type Faction = "horde" | "alliance";
export type PresetSpec = {
  template: string;
  faction: Faction;
  map: number;
  x: number;
  y: number;
  z: number;
};

const eversong = { map: 530, x: 8735, y: -6685, z: 70.5 } as const;

export const presetSpecs = {
  elwynn1: {
    faction: "alliance",
    map: 0,
    template: "Tplelwynn",
    x: -8949.95,
    y: -132.49,
    z: 83.53,
  },
  elwynn10: {
    faction: "alliance",
    map: 0,
    template: "Tplgoldshire",
    x: -9455,
    y: 55,
    z: 56.8,
  },
  eversong10: { ...eversong, faction: "horde", template: "Tpleversong" },
  "eversong10-hunter": { ...eversong, faction: "horde", template: "Tplhunter" },
  "eversong10-mage": { ...eversong, faction: "horde", template: "Tplmage" },
  "eversong10-warrior": {
    ...eversong,
    faction: "horde",
    template: "Tplwarrior",
  },
  fresh: {
    faction: "horde",
    map: 530,
    template: "Tplfresh",
    x: 10_349.6,
    y: -6357.29,
    z: 33.4,
  },
  ghostlands20: {
    faction: "horde",
    map: 530,
    template: "Tplghost",
    x: 7575,
    y: -6835,
    z: 89.1,
  },
  max80: {
    faction: "horde",
    map: 571,
    template: "Tplmax",
    x: 5807.98,
    y: 588.49,
    z: 660.94,
  },
} as const satisfies Record<string, PresetSpec>;

export type Preset = keyof typeof presetSpecs;

export const presets: Preset[] = [
  "fresh",
  "eversong10",
  "max80",
  "eversong10-warrior",
  "eversong10-mage",
  "eversong10-hunter",
  "elwynn1",
  "elwynn10",
  "ghostlands20",
];

const languages: Record<Faction, number> = { alliance: 7, horde: 1 };

export function isPreset(name: string): name is Preset {
  return Object.hasOwn(presetSpecs, name);
}

export function presetEnvKey(preset: Preset): string {
  return `TUICRAFT_PRESET_${preset.toUpperCase().replaceAll("-", "_")}`;
}

export function templateFor(
  preset: Preset,
  env: Record<string, string>,
): string {
  return env[presetEnvKey(preset)] || presetSpecs[preset].template;
}

export function presetLanguage(preset: Preset): number {
  return languages[presetSpecs[preset].faction];
}
