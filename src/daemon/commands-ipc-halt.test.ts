import { describe, expect, type jest, test } from "bun:test";
import { sendToSocket } from "cli/ipc";
import {
  sendRawCommands,
  sendRawUntilClose,
  useIpcServer,
} from "test/commands-fixtures";

describe("IPC round-trip", () => {
  const ipc = useIpcServer();

  test("HALT preempts coalesced READ_WAIT and drops older MOVE", async () => {
    ipc.start();
    await sendToSocket("MOVE forward 10000", ipc.sockPath);
    ipc.handle.move.mockClear();
    const started = Date.now();
    const lines = await sendRawCommands(ipc.sockPath, [
      "READ_WAIT 8000\nMOVE left 1000\nHALT\n",
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ipc.handle.halt).toHaveBeenCalled();
    expect(ipc.handle.move).not.toHaveBeenCalled();
    expect(lines).toContain("OK");
  });

  test("HALT drops older CAST and keeps later GOTO", async () => {
    ipc.start();
    const lines = await sendRawUntilClose(ipc.sockPath, [
      "CAST 585 0xa\nHALT\nGOTO 1 2 3\n",
    ]);
    expect(ipc.handle.cast).not.toHaveBeenCalled();
    expect(ipc.handle.halt).toHaveBeenCalled();
    expect(ipc.handle.goTo).toHaveBeenCalledWith(1, 2, 3);
    expect(lines).toContain("OK");
  });

  test("HALT discards older directed commands before a newer walk", async () => {
    ipc.start();
    const actions: string[] = [];
    ipc.handle.halt.mockImplementation(() => {
      actions.push("halt");
    });
    Object.assign(ipc.handle, {
      faceGuid: () => actions.push("face"),
      walkToward: async (_target: unknown, yards: number) => {
        actions.push(`walk:${yards}`);
        return {
          pose: {
            mapId: 530,
            orientation: 0,
            source: "predicted",
            updatedAt: 0,
            x: 0,
            y: 0,
            z: 0,
          },
          status: "completed",
          traveled: yards,
        };
      },
    });
    await sendRawUntilClose(ipc.sockPath, [
      "FACE_GUID 1\nWALK_TOWARD 1 1\nHALT\nWALK_TOWARD 2 2\n",
    ]);
    expect(actions).toEqual(["halt", "walk:2"]);
  });

  test("disconnect aborts an active directed walk", async () => {
    ipc.start();
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    Object.assign(ipc.handle, {
      walkToward: (_target: unknown, _yards: number, signal?: AbortSignal) => {
        signal?.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    const closed = Promise.withResolvers<void>();
    const client = await Bun.connect({
      socket: {
        close() {
          closed.resolve();
        },
        data() {},
        error(_socket, error) {
          closed.reject(error);
        },
      },
      unix: ipc.sockPath,
    });
    client.write("WALK_TOWARD 10 1\n");
    client.flush();
    await started.promise;
    client.terminate();
    await closed.promise;
    await aborted.promise;
  }, 2000);

  test("HALT drops older CYCLE", async () => {
    ipc.start();
    const lines = await sendRawUntilClose(ipc.sockPath, ["CYCLE 0xa\nHALT\n"]);
    expect(ipc.handle.startCycle).not.toHaveBeenCalled();
    expect(ipc.handle.halt).toHaveBeenCalled();
    expect(lines).toEqual(["OK"]);
  });

  test("HALT drops older recovery mutations but retains a corpse query and newer response", async () => {
    ipc.start();
    const actions: string[] = [];
    Object.assign(ipc.handle, {
      queryCorpse: () => {
        actions.push("query");
      },
      reclaimCorpse: () => {
        actions.push("reclaim");
      },
      releaseSpirit: () => {
        actions.push("release");
      },
      respondResurrection: (accept: boolean) => {
        actions.push(accept ? "accept" : "decline");
      },
    });
    await sendRawUntilClose(ipc.sockPath, [
      "RELEASE_SPIRIT\nRECLAIM_CORPSE\nRESURRECT accept\nQUERY_CORPSE\nHALT\nRESURRECT decline\n",
    ]);
    expect(actions).toEqual(["query", "decline"]);
  });

  test("gossip JSON code cannot inject a second IPC command", async () => {
    ipc.start();
    const codes: Array<string | undefined> = [];
    Object.assign(ipc.handle, {
      selectGossipOption: (_id: number, gossipCode?: string) => {
        codes.push(gossipCode);
      },
    });
    const code = '  say "hello"\nHALT\r\n  ';
    const lines = await sendToSocket(
      `SELECT_OPTION 0 ${JSON.stringify(code)}`,
      ipc.sockPath,
    );
    expect(lines).toEqual(["OK"]);
    expect(codes).toEqual([code]);
    expect(ipc.handle.halt).not.toHaveBeenCalled();
  });

  test("HALT drops old quest mutations but retains metadata and a new cancel", async () => {
    ipc.start();
    const actions: string[] = [];
    Object.assign(ipc.handle, {
      abandonQuest: () => {
        actions.push("abandon");
      },
      acceptQuest: () => {
        actions.push("accept");
      },
      cancelInteraction: () => {
        actions.push("cancel");
      },
      chooseQuestReward: () => {
        actions.push("choose_reward");
      },
      completeQuest: () => {
        actions.push("complete");
      },
      queryQuest: () => {
        actions.push("query");
      },
      requestQuestReward: () => {
        actions.push("request_reward");
      },
      selectGossipOption: () => {
        actions.push("option");
      },
      selectQuest: () => {
        actions.push("select");
      },
      talk: () => {
        actions.push("talk");
      },
    });
    await sendRawUntilClose(ipc.sockPath, [
      "TALK 1\nSELECT_OPTION 0 null\nSELECT_QUEST 1\nACCEPT_QUEST\nCOMPLETE_QUEST 1\nREQUEST_REWARD\nCHOOSE_REWARD 0\nABANDON_QUEST 0\nCANCEL_INTERACTION\nQUERY_QUEST 1\nHALT\nCANCEL_INTERACTION\n",
    ]);
    expect(actions).toEqual(["query", "cancel"]);
  });

  test("HALT drops older loot mutations and keeps a newer open", async () => {
    ipc.start();
    const actions: string[] = [];
    Object.assign(ipc.handle, {
      getInventoryState: () => {
        actions.push("inventory");
        return { status: "unknown" };
      },
      openLoot: (guid: bigint) => {
        actions.push(`open:${guid}`);
      },
      releaseLoot: () => {
        actions.push("release");
      },
      takeLoot: () => {
        actions.push("take");
      },
      takeLootMoney: () => {
        actions.push("money");
      },
    });
    await sendRawUntilClose(ipc.sockPath, [
      "OPEN_LOOT 1\nTAKE_LOOT 0\nTAKE_MONEY\nRELEASE_LOOT\nINVENTORY_JSON\nHALT\nOPEN_LOOT 2\n",
    ]);
    expect(actions).toEqual(["inventory", "open:2"]);
  });

  test("HALT preempts READ_WAIT arriving in a later chunk", async () => {
    ipc.start();
    await sendToSocket("MOVE forward 10000", ipc.sockPath);
    const started = Date.now();
    const lines = await sendRawCommands(
      ipc.sockPath,
      ["READ_WAIT 8000\n", "HALT\n"],
      20,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ipc.handle.halt).toHaveBeenCalled();
    expect(lines).toContain("OK");
  });

  test("HALT stops control before an unresolved WHO resolves", async () => {
    ipc.start();
    await sendToSocket("MOVE forward 10000", ipc.sockPath);
    ipc.handle.move.mockClear();
    const halted = Promise.withResolvers<void>();
    ipc.handle.halt.mockImplementation(() => {
      halted.resolve();
    });
    const pendingWho = Promise.withResolvers<never[]>();
    (ipc.handle.who as ReturnType<typeof jest.fn>).mockImplementation(
      () => pendingWho.promise,
    );
    const started = Date.now();
    const linesPromise = sendRawCommands(
      ipc.sockPath,
      ["WHO\n", "MOVE left 1000\nHALT\n"],
      20,
    );
    await Promise.race([
      halted.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("halt not observed")), 2000);
      }),
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ipc.handle.move).not.toHaveBeenCalled();
    pendingWho.resolve([]);
    const lines = await linesPromise;
    expect(lines).toContain("OK");
    expect(ipc.handle.move).not.toHaveBeenCalled();
  });

  test("HALT keeps STATUS after held WHO without ERR internal", async () => {
    ipc.start();
    await sendToSocket("MOVE forward 10000", ipc.sockPath);
    ipc.handle.move.mockClear();
    const halted = Promise.withResolvers<void>();
    ipc.handle.halt.mockImplementation(() => {
      halted.resolve();
    });
    const pendingWho = Promise.withResolvers<never[]>();
    (ipc.handle.who as ReturnType<typeof jest.fn>).mockImplementation(
      () => pendingWho.promise,
    );
    const linesPromise = sendRawUntilClose(
      ipc.sockPath,
      ["WHO\n", "MOVE left 1000\nHALT\nSTATUS\n"],
      20,
    );
    await Promise.race([
      halted.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("halt not observed")), 2000);
      }),
    ]);
    expect(ipc.handle.move).not.toHaveBeenCalled();
    pendingWho.resolve([]);
    const lines = await linesPromise;
    expect(lines).toContain("OK");
    expect(lines).toContain("CONNECTED");
    expect(lines.some((line) => line.includes("ERR internal"))).toBe(false);
    expect(ipc.handle.move).not.toHaveBeenCalled();
  });

  test("HALT keeps a newer FACE after held WHO", async () => {
    ipc.start();
    await sendToSocket("MOVE forward 10000", ipc.sockPath);
    ipc.handle.move.mockClear();
    const halted = Promise.withResolvers<void>();
    ipc.handle.halt.mockImplementation(() => {
      halted.resolve();
    });
    const pendingWho = Promise.withResolvers<never[]>();
    (ipc.handle.who as ReturnType<typeof jest.fn>).mockImplementation(
      () => pendingWho.promise,
    );
    const linesPromise = sendRawUntilClose(
      ipc.sockPath,
      ["WHO\n", "MOVE left 1000\nHALT\nSTATUS\nFACE 1\n"],
      20,
    );
    await Promise.race([
      halted.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("halt not observed")), 2000);
      }),
    ]);
    pendingWho.resolve([]);
    const lines = await linesPromise;
    expect(lines).toContain("CONNECTED");
    expect(lines.some((line) => line.includes("ERR internal"))).toBe(false);
    expect(ipc.handle.face).toHaveBeenCalledWith(1);
    expect(ipc.handle.move).not.toHaveBeenCalled();
  });
});
