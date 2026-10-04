import { describe, expect, test } from "bun:test";
import { areaRig } from "#test-support/area-rig";
import {
  raidGroupLeftBody,
  raidGroupListBody,
  raidReadyCheckBody,
  raidReadyConfirmBody,
} from "#test-support/areas/raid";
import type { RaidEvent } from "#wow/areas/raid/store-roster";
import { GameOpcode } from "#wow/protocol/opcodes";

const PEON = 0x30n;
const TOM = 0x10n;
const ANN = 0x20n;
const BOB = 0x40n;

function rigWithGroup() {
  const rig = areaRig("raid", { selfGuid: PEON });
  const events: RaidEvent[] = [];
  rig.handle.onEvent((event) => {
    events.push(event);
  });
  rig.inject(
    GameOpcode.SMSG_GROUP_LIST,
    raidGroupListBody({
      counter: 1,
      leader: TOM,
      members: [
        { guid: PEON, name: "Peon" },
        { guid: TOM, name: "Tom" },
        { guid: ANN, name: "Ann" },
        { guid: BOB, name: "Bob", status: 0 },
      ],
      type: 0,
    }),
  );
  events.length = 0;
  return { events, rig };
}

function start(rig: ReturnType<typeof rigWithGroup>["rig"], guid = TOM) {
  rig.inject(GameOpcode.MSG_RAID_READY_CHECK, raidReadyCheckBody(guid));
}

function confirm(
  rig: ReturnType<typeof rigWithGroup>["rig"],
  guid: bigint,
  state: number,
) {
  rig.inject(
    GameOpcode.MSG_RAID_READY_CHECK_CONFIRM,
    raidReadyConfirmBody(guid, state),
  );
}

describe("ready check store", () => {
  test("a start opens a check and names the initiator", () => {
    const { events, rig } = rigWithGroup();
    try {
      start(rig);
      expect(events).toEqual([
        { initiator: TOM, name: "Tom", type: "ready_check_started" },
      ]);
      expect(rig.handle.state().readyCheck).toMatchObject({
        answers: new Map(),
        finishedAt: undefined,
        initiator: TOM,
        ownAnswer: undefined,
        startedAt: 0,
      });
    } finally {
      rig.dispose();
    }
  });

  test("a confirm records ready, not ready and offline answers", () => {
    const { events, rig } = rigWithGroup();
    try {
      start(rig, PEON);
      events.length = 0;
      confirm(rig, ANN, 1);
      confirm(rig, TOM, 0);
      confirm(rig, BOB, 0);
      expect(events).toEqual([
        { answer: "ready", guid: ANN, name: "Ann", type: "ready_check_answer" },
        {
          answer: "not_ready",
          guid: TOM,
          name: "Tom",
          type: "ready_check_answer",
        },
        {
          answer: "offline",
          guid: BOB,
          name: "Bob",
          type: "ready_check_answer",
        },
      ]);
      expect(rig.handle.state().readyCheck?.answers.get(BOB)).toBe("offline");
    } finally {
      rig.dispose();
    }
  });

  test("a new start clears the earlier answers", () => {
    const { rig } = rigWithGroup();
    try {
      start(rig, PEON);
      confirm(rig, ANN, 1);
      start(rig, TOM);
      const check = rig.handle.state().readyCheck;
      expect(check?.answers.size).toBe(0);
      expect(check?.initiator).toBe(TOM);
    } finally {
      rig.dispose();
    }
  });

  test("a confirm with no open check or from a stranger is ignored", () => {
    const { events, rig } = rigWithGroup();
    try {
      confirm(rig, ANN, 1);
      start(rig);
      events.length = 0;
      confirm(rig, 0x99n, 1);
      expect(events).toEqual([]);
      expect(rig.handle.state().readyCheck?.answers.size).toBe(0);
    } finally {
      rig.dispose();
    }
  });

  test("a finish stamps the check and summarises the answers", () => {
    const { events, rig } = rigWithGroup();
    try {
      start(rig, PEON);
      confirm(rig, ANN, 1);
      confirm(rig, TOM, 0);
      confirm(rig, BOB, 0);
      events.length = 0;
      rig.inject(GameOpcode.MSG_RAID_READY_CHECK_FINISHED, new Uint8Array(0));
      expect(events).toEqual([
        {
          notReady: ["Tom"],
          offline: 1,
          pending: 0,
          ready: 1,
          type: "ready_check_finished",
        },
      ]);
      expect(rig.handle.state().readyCheck?.finishedAt).toBe(0);
    } finally {
      rig.dispose();
    }
  });

  test("a finish with no open check emits nothing", () => {
    const { events, rig } = rigWithGroup();
    try {
      rig.inject(GameOpcode.MSG_RAID_READY_CHECK_FINISHED, new Uint8Array(0));
      expect(events).toEqual([]);
    } finally {
      rig.dispose();
    }
  });

  test("an answer after the finish is ignored", () => {
    const { events, rig } = rigWithGroup();
    try {
      start(rig);
      rig.inject(GameOpcode.MSG_RAID_READY_CHECK_FINISHED, new Uint8Array(0));
      events.length = 0;
      confirm(rig, ANN, 1);
      expect(events).toEqual([]);
    } finally {
      rig.dispose();
    }
  });

  test("leaving the group drops the check", () => {
    const { rig } = rigWithGroup();
    try {
      start(rig);
      rig.inject(GameOpcode.SMSG_GROUP_LIST, raidGroupLeftBody(2));
      expect(rig.handle.state().readyCheck).toBeUndefined();
    } finally {
      rig.dispose();
    }
  });

  test("a finished check keeps its roster across later group updates", () => {
    const { rig } = rigWithGroup();
    try {
      start(rig, PEON);
      confirm(rig, ANN, 1);
      rig.inject(GameOpcode.MSG_RAID_READY_CHECK_FINISHED, new Uint8Array(0));
      const finished = rig.handle.state().readyCheck;
      rig.inject(
        GameOpcode.SMSG_GROUP_LIST,
        raidGroupListBody({
          counter: 2,
          leader: TOM,
          members: [
            { guid: PEON, name: "Peon" },
            { guid: TOM, name: "Tom" },
            { guid: 0x50n, name: "Late" },
          ],
          type: 0,
        }),
      );
      const after = rig.handle.state().readyCheck;
      expect(after?.names.get(ANN)).toBe("Ann");
      expect(after?.names.has(0x50n)).toBe(false);
      expect(after?.silent).toEqual(["Tom"]);
      expect(after?.id).toBe(finished?.id);
    } finally {
      rig.dispose();
    }
  });

  test("each start gets a new check id", () => {
    const { rig } = rigWithGroup();
    try {
      start(rig, PEON);
      const first = rig.handle.state().readyCheck?.id;
      start(rig, TOM);
      expect(rig.handle.state().readyCheck?.id).not.toBe(first);
    } finally {
      rig.dispose();
    }
  });
});
