import { openDbc, u32, type DbcFile } from "wow/dbc";

export type FactionRelation = "friendly" | "hostile" | "neutral" | "unknown";

export type FactionTemplate = {
  id: number;
  faction: number;
  flags: number;
  ourMask: number;
  friendlyMask: number;
  hostileMask: number;
  enemyFactions: number[];
  friendFactions: number[];
};

const LAYOUT = {
  file: "FactionTemplate.dbc",
  fields: 14,
  recordSize: 56,
} as const;

export class FactionTemplateCatalog {
  private readonly table: DbcFile;
  private readonly cache = new Map<number, FactionTemplate>();

  constructor(table: DbcFile) {
    this.table = table;
  }

  get(id: number): FactionTemplate | undefined {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = this.table.byId.get(id);
    if (row === undefined) return undefined;
    const def = decodeTemplate(this.table, row);
    this.cache.set(id, def);
    return def;
  }

  relation(
    sourceTemplateId: number,
    targetTemplateId: number,
  ): FactionRelation {
    const source = this.get(sourceTemplateId);
    const target = this.get(targetTemplateId);
    if (!source || !target) return "unknown";
    const friendly = isFriendlyTo(source, target);
    const hostile = isHostileTo(source, target);
    if (friendly && hostile) return "unknown";
    if (friendly) return "friendly";
    if (hostile) return "hostile";
    return "neutral";
  }
}

export async function loadFactionTemplates(
  directory: string,
): Promise<FactionTemplateCatalog> {
  return new FactionTemplateCatalog(await openDbc(directory, LAYOUT));
}

function idList(file: DbcFile, row: number, start: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const id = u32(file, row, start + i);
    if (id === 0) continue;
    ids.push(id);
  }
  return ids;
}

function decodeTemplate(file: DbcFile, row: number): FactionTemplate {
  return {
    id: u32(file, row, 0),
    faction: u32(file, row, 1),
    flags: u32(file, row, 2),
    ourMask: u32(file, row, 3),
    friendlyMask: u32(file, row, 4),
    hostileMask: u32(file, row, 5),
    enemyFactions: idList(file, row, 6),
    friendFactions: idList(file, row, 10),
  };
}

function containsFaction(ids: number[], faction: number): boolean {
  for (const id of ids) {
    if (id === faction) return true;
  }
  return false;
}

function isFriendlyTo(
  source: FactionTemplate,
  target: FactionTemplate,
): boolean {
  if (source.faction === target.faction) return true;
  if (target.faction !== 0) {
    if (containsFaction(source.enemyFactions, target.faction)) return false;
    if (containsFaction(source.friendFactions, target.faction)) return true;
  }
  return (
    (source.friendlyMask & target.ourMask) !== 0 ||
    (source.ourMask & target.friendlyMask) !== 0
  );
}

function isHostileTo(
  source: FactionTemplate,
  target: FactionTemplate,
): boolean {
  if (target.faction !== 0) {
    if (containsFaction(source.enemyFactions, target.faction)) return true;
    if (containsFaction(source.friendFactions, target.faction)) return false;
  }
  return (source.hostileMask & target.ourMask) !== 0;
}
