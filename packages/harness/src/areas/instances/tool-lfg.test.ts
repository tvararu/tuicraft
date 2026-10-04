import { describe, expect, jest, test } from "bun:test";
import { elapse, withFakeTimers } from "@peon/core/test-support/fake-time";
import {
  attempt,
  lfg,
  NOW,
  queueAvailable,
  world,
} from "#harness/areas/instances/tool-lfg-fixture";

describe("dungeon lfg queue", () => {
  test("queue with no dungeon picks the first unlocked random entry", async () => {
    const t = await world({ lfg: queueAvailable() });
    const join = jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith({
      comment: "",
      entries: [0x06_00_00_0c],
      roles: 8,
    });
    expect(settled).toMatchObject({ status: "DONE" });
    expect(settled.detail.toLowerCase()).toContain("queued");
  });

  test("queue alone says solo with the party size", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    expect(settled).toMatchObject({ status: "DONE" });
    expect(settled.detail).toMatch(/solo/i);
    expect(settled.detail).toContain("1");
  });

  test("queue in a group says party with the party size", async () => {
    const t = await world({
      lfg: queueAvailable(),
      party: { inGroup: true, leader: null, names: ["Ann", "Tom", "Lee"] },
    });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    expect(settled).toMatchObject({ status: "DONE" });
    expect(settled.detail).toMatch(/party/i);
    expect(settled.detail).toContain("4");
  });

  test("queue requests the dungeon list first when the list is empty", async () => {
    const t = await world();
    const dungeons = jest
      .spyOn(t.handle.lfg.act, "requestDungeons")
      .mockImplementation(() => {
        jest
          .spyOn(t.handle.lfg, "state")
          .mockImplementation(() => queueAvailable());
        return Promise.resolve({
          available: [{ entry: 0x06_00_00_0c, id: 12 }],
          locks: [
            {
              entry: 0x06_00_00_0c,
              id: 12,
              reason: "none",
              status: 0,
              type: 6,
            },
          ],
          status: "ok",
        });
      });
    const join = jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    expect(dungeons).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledTimes(1);
    expect(settled).toMatchObject({ status: "DONE" });
  });

  test("queue maps roles to bits and renders a refusal with the reason", async () => {
    const t = await world({ lfg: queueAvailable() });
    const join = jest
      .spyOn(t.handle.lfg.act, "join")
      .mockResolvedValue({ reason: "deserter", status: "refused" });
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["tank", "healer"],
    });
    expect(join).toHaveBeenCalledWith({
      comment: "",
      entries: [0x06_00_00_0c],
      roles: 6,
    });
    expect(settled).toMatchObject({ reason: "deserter", status: "REFUSED" });
    expect(settled.detail.toLowerCase()).toContain("deserter");
  });

  test("queue with no unlocked random entry is refused", async () => {
    const t = await world({
      lfg: lfg({
        available: [{ entry: 0x06_00_00_0c, id: 12 }],
        locks: [
          {
            entry: 0x06_00_00_0c,
            id: 12,
            reason: "too_low_level",
            status: 2,
            type: 6,
          },
        ],
        locksAt: NOW,
      }),
    });
    jest
      .spyOn(t.handle.lfg.act, "requestDungeons")
      .mockResolvedValue({ available: [], locks: [], status: "ok" });
    const join = jest.spyOn(t.handle.lfg.act, "join");
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    expect(join).not.toHaveBeenCalled();
    expect(settled).toMatchObject({
      reason: "no_random_dungeon",
      status: "REFUSED",
    });
  });

  test("status while queued says party with the party size", async () => {
    const t = await world({
      lfg: { ...queueAvailable(), status: "queued" },
      party: { inGroup: true, leader: null, names: ["Ann", "Tom"] },
    });
    const { text } = await attempt(t, { do: "status" });
    expect(text).toMatch(/party/i);
    expect(text).toContain("3");
  });

  test("queue while already queued is refused", async () => {
    const t = await world({ lfg: { ...queueAvailable(), status: "queued" } });
    const join = jest.spyOn(t.handle.lfg.act, "join");
    const { settled } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    expect(join).not.toHaveBeenCalled();
    expect(settled).toMatchObject({
      reason: "already_queued",
      status: "REFUSED",
    });
  });

  test("queue by id reuses the named dungeon", async () => {
    const t = await world({
      lfg: lfg({
        available: [],
        locks: [{ entry: 300, id: 300, reason: "none", status: 0, type: 1 }],
        locksAt: NOW,
      }),
    });
    const join = jest
      .spyOn(t.handle.lfg.act, "join")
      .mockResolvedValue({ queued: [300], roleCheck: false, status: "ok" });
    const { settled: _byId } = await attempt(t, {
      do: "queue",
      dungeon: 300,
      roles: ["tank"],
    });
    expect(join).toHaveBeenCalledWith({
      comment: "",
      entries: [300],
      roles: 2,
    });
  });
});

describe("dungeon lfg auto answers", () => {
  test("auto answers the next role check with the queued roles and logs one row", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const setRoles = jest
      .spyOn(t.handle.lfg.act, "setRoles")
      .mockResolvedValue({ roles: 8, status: "ok" });
    const { settled: _q } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    t.handle.triggerAreaEvent("lfg", {
      state: 2,
      stateName: "initializing",
      type: "role_check",
    });
    await withFakeTimers(() => elapse(0));
    expect(setRoles).toHaveBeenCalledWith(8);
    const rows = t.rt.log
      .since(0)
      .filter((row) => row.event === "lfg/role_answered");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text.toLowerCase()).toContain("damage");
  });

  test("auto accepts the next proposal and logs one row", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const answer = jest
      .spyOn(t.handle.lfg.act, "answerProposal")
      .mockResolvedValue({ state: 1, status: "ok" });
    const { settled: _q } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    t.handle.triggerAreaEvent("lfg", {
      deadline: NOW + 40_000,
      dungeon: 0x06_00_00_02,
      id: 5,
      selfAccepted: false,
      selfAnswered: false,
      state: 0,
      type: "proposal",
    });
    await withFakeTimers(() => elapse(0));
    expect(answer).toHaveBeenCalledWith(true);
    const rows = t.rt.log
      .since(0)
      .filter((row) => row.event === "lfg/proposal_answered");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text.toLowerCase()).toContain("accepted");
  });
  test("auto answers the next role check and the next proposal", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const setRoles = jest
      .spyOn(t.handle.lfg.act, "setRoles")
      .mockResolvedValue({ roles: 8, status: "ok" });
    const answer = jest
      .spyOn(t.handle.lfg.act, "answerProposal")
      .mockResolvedValue({ state: 1, status: "ok" });
    const { settled: _q } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    t.handle.triggerAreaEvent("lfg", {
      state: 2,
      stateName: "initializing",
      type: "role_check",
    });
    t.handle.triggerAreaEvent("lfg", {
      deadline: NOW + 40_000,
      dungeon: 0x06_00_00_02,
      id: 5,
      selfAccepted: false,
      selfAnswered: false,
      state: 0,
      type: "proposal",
    });
    await withFakeTimers(() => elapse(0));
    expect(setRoles).toHaveBeenCalledWith(8);
    expect(answer).toHaveBeenCalledWith(true);
    const roleRows = t.rt.log
      .since(0)
      .filter((row) => row.event === "lfg/role_answered");
    expect(roleRows).toHaveLength(1);
    const proposalRows = t.rt.log
      .since(0)
      .filter((row) => row.event === "lfg/proposal_answered");
    expect(proposalRows).toHaveLength(1);
  });

  test("auto answers an already-open role check at the join", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: true,
      status: "ok",
    });
    const setRoles = jest
      .spyOn(t.handle.lfg.act, "setRoles")
      .mockResolvedValue({ roles: 8, status: "ok" });
    const { settled: _q } = await attempt(t, {
      do: "queue",
      roles: ["damage"],
    });
    await withFakeTimers(() => elapse(0));
    expect(setRoles).toHaveBeenCalledWith(8);
    const rows = t.rt.log
      .since(0)
      .filter((row) => row.event === "lfg/role_answered");
    expect(rows).toHaveLength(1);
  });

  test("without auto the tool answers nothing", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const setRoles = jest.spyOn(t.handle.lfg.act, "setRoles");
    const answer = jest.spyOn(t.handle.lfg.act, "answerProposal");
    const { settled: _q } = await attempt(t, {
      auto: false,
      do: "queue",
      roles: ["damage"],
    });
    t.handle.triggerAreaEvent("lfg", {
      state: 2,
      stateName: "initializing",
      type: "role_check",
    });
    t.handle.triggerAreaEvent("lfg", {
      deadline: NOW + 40_000,
      dungeon: 0x06_00_00_02,
      id: 5,
      selfAccepted: false,
      selfAnswered: false,
      state: 0,
      type: "proposal",
    });
    await withFakeTimers(() => elapse(0));
    expect(setRoles).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });

  test("an answered role check stops the no-answer leave", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    jest
      .spyOn(t.handle.lfg.act, "setRoles")
      .mockResolvedValue({ roles: 8, status: "ok" });
    const leave = jest.spyOn(t.handle.lfg.act, "leave");
    const { settled: _q } = await attempt(t, {
      auto: false,
      do: "queue",
      roles: ["damage"],
    });
    await withFakeTimers(async () => {
      t.handle.triggerAreaEvent("lfg", {
        state: 2,
        stateName: "initializing",
        type: "role_check",
      });
      await elapse(1000);
      await attempt(t, { do: "roles", roles: ["damage"] });
      await elapse(60_000);
    });
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("dungeon lfg no-answer leave", () => {
  test("a role check with no answer in 60 s calls leave and reports it", async () => {
    const t = await world({ lfg: queueAvailable() });
    jest.spyOn(t.handle.lfg.act, "join").mockResolvedValue({
      queued: [0x06_00_00_0c],
      roleCheck: false,
      status: "ok",
    });
    const leave = jest
      .spyOn(t.handle.lfg.act, "leave")
      .mockResolvedValue({ status: "ok" });
    const { settled: _q } = await attempt(t, {
      auto: false,
      do: "queue",
      roles: ["damage"],
    });
    await withFakeTimers(async () => {
      t.handle.triggerAreaEvent("lfg", {
        state: 2,
        stateName: "initializing",
        type: "role_check",
      });
      await elapse(60_000);
    });
    expect(leave).toHaveBeenCalledTimes(1);
    const rows = t.rt.log
      .since(0)
      .filter((row) => row.event === "lfg/role_unanswered");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toContain("left the queue");
  });
});
