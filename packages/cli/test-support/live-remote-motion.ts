import { describe, expect, test } from "bun:test";
import type { RemotePose, WorldHandle } from "@tuicraft/core";
import { readConfig } from "@tuicraft/core/lib/config";
import { authHandshake, worldSession } from "@tuicraft/core/session";
import { must } from "@tuicraft/core/test-support/must";
import {
  near,
  SUNSTRIDER_SPAWN,
  standAt,
  waitUntil,
} from "#test-support/live-helpers";

function config(n: 1 | 2) {
  return {
    account: Bun.env[`WOW_ACCOUNT_${n}`] ?? "",
    character: Bun.env[`WOW_CHARACTER_${n}`] ?? "",
    host: Bun.env["WOW_HOST"] ?? "t1",
    language: Number.parseInt(Bun.env["WOW_LANGUAGE"] ?? "1", 10),
    password: Bun.env[`WOW_PASSWORD_${n}`] ?? "",
    port: Number.parseInt(Bun.env["WOW_PORT"] ?? "3724", 10),
    ...navigation,
  };
}

const navigation = await readConfig()
  .then((cfg) => ({
    navigationDataDir: cfg.navigation_data_dir,
    navigationLibrary: cfg.navigation_library,
  }))
  .catch(() => ({}));

const config1 = config(1);
const config2 = config(2);

describe("remote movement", () => {
  test("observer receives a moving character's remote pose", async () => {
    const auth1 = await authHandshake(config1);
    const auth2 = await authHandshake(config2);
    const handle1 = await worldSession(config1, auth1);
    let handle2: WorldHandle | undefined;
    let restore: (() => Promise<void>) | undefined;
    const poses: RemotePose[] = [];
    const unsubscribe = handle1.onRemoteMotionEvent((e) => {
      if (e.type === "pose") poses.push(e.pose);
    });

    try {
      const excursion = await standAt(
        handle1,
        config1.character,
        SUNSTRIDER_SPAWN,
      );
      restore = excursion.restore;
      handle2 = await worldSession(config2, auth2);
      const peer = handle2.getControlState().selfGuid;
      const summonedAt = Date.now();
      poses.length = 0;
      handle1.sendWhisper(config1.character, `.summon ${config2.character}`);
      await waitUntil(() => {
        const pose = handle2?.getControlState().serverPose;
        return (
          pose !== undefined &&
          pose.updatedAt >= summonedAt &&
          near(pose, SUNSTRIDER_SPAWN, 5)
        );
      });
      await waitUntil(() =>
        poses.some(
          (p) =>
            p.guid === peer &&
            p.invalid === undefined &&
            near(p.position, SUNSTRIDER_SPAWN, 5),
        ),
      );
      const heading = must(SUNSTRIDER_SPAWN.orientation);
      handle2.face(heading);
      await waitUntil(() =>
        poses.some(
          (p) =>
            p.guid === peer &&
            p.source === "observer" &&
            Math.abs((p.position.orientation ?? 0) - heading) < 0.01,
        ),
      );
      poses.length = 0;
      const started = Date.now();
      handle2.move("forward", 1500);
      await waitUntil(() =>
        poses.some((p) => p.guid === peer && p.motion === "moving"),
      );
      await waitUntil(() =>
        poses.some(
          (p) =>
            p.guid === peer &&
            p.source === "observer" &&
            p.motion === "stationary",
        ),
      );
      const moving = must(
        poses.find((p) => p.guid === peer && p.motion === "moving"),
      );
      expect(moving.flags).toBe(1);
      expect(moving.extraFlags).toBe(0);
      expect(moving.moverTime).toBeGreaterThan(0);
      expect(moving.receivedAt).toBeGreaterThanOrEqual(started);
      const latest = must(
        handle1.getRemotePoses().find((p) => p.guid === peer),
      );
      expect(latest.motion).toBe("stationary");
      expect(latest.invalid).toBeUndefined();
    } finally {
      unsubscribe();
      await restore?.();
      handle2?.close();
      handle1.close();
      await Promise.all([handle2?.closed, handle1.closed]);
    }
  }, 30_000);
});
