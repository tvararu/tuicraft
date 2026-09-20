import type { PacketReader } from "./packet";
import { MovementFlag, MovementFlagExtra, UpdateFlag } from "./entity-fields";

export type MovementData = {
  updateFlags: number;
  x: number;
  y: number;
  z: number;
  orientation: number;
  walkSpeed?: number;
  runSpeed?: number;
  runBackSpeed?: number;
  movementFlags?: number;
};

export function parseMovementBlock(r: PacketReader): MovementData {
  const updateFlags = r.uint16LE();
  let x = 0;
  let y = 0;
  let z = 0;
  let orientation = 0;
  let walkSpeed: number | undefined;
  let runSpeed: number | undefined;
  let runBackSpeed: number | undefined;
  let movementFlags: number | undefined;

  if (updateFlags & UpdateFlag.LIVING) {
    const flags = r.uint32LE();
    movementFlags = flags;
    const movementFlagsExtra = r.uint16LE();
    r.skip(4);
    x = r.floatLE();
    y = r.floatLE();
    z = r.floatLE();
    orientation = r.floatLE();

    if (flags & MovementFlag.ON_TRANSPORT) {
      r.packedGuid();
      r.skip(16);
      r.skip(4);
      r.skip(1);
      if (movementFlagsExtra & MovementFlagExtra.INTERPOLATED_MOVEMENT) {
        r.skip(4);
      }
    }

    if (
      flags & (MovementFlag.SWIMMING | MovementFlag.FLYING) ||
      movementFlagsExtra & MovementFlagExtra.ALWAYS_ALLOW_PITCHING
    ) {
      r.skip(4);
    }

    r.skip(4);

    if (flags & MovementFlag.FALLING) {
      r.skip(16);
    }

    if (flags & MovementFlag.SPLINE_ELEVATION) {
      r.skip(4);
    }

    walkSpeed = r.floatLE();
    runSpeed = r.floatLE();
    runBackSpeed = r.floatLE();
    for (let i = 0; i < 6; i++) r.skip(4);

    if (flags & MovementFlag.SPLINE_ENABLED) {
      const splineFlags = r.uint32LE();
      if (splineFlags & 0x00008000) {
        r.skip(12);
      } else if (splineFlags & 0x00010000) {
        r.skip(8);
      } else if (splineFlags & 0x00020000) {
        r.skip(4);
      }
      r.skip(4);
      r.skip(4);
      r.skip(4);
      r.skip(4);
      r.skip(4);
      r.skip(4);
      r.skip(4);
      const nodeCount = r.uint32LE();
      for (let i = 0; i < nodeCount; i++) r.skip(12);
      r.skip(1);
      r.skip(12);
    }
  } else if (updateFlags & UpdateFlag.POSITION) {
    r.packedGuid();
    x = r.floatLE();
    y = r.floatLE();
    z = r.floatLE();
    r.skip(12);
    orientation = r.floatLE();
    r.skip(4);
  } else if (updateFlags & UpdateFlag.HAS_POSITION) {
    x = r.floatLE();
    y = r.floatLE();
    z = r.floatLE();
    orientation = r.floatLE();
  }

  if (updateFlags & UpdateFlag.HIGH_GUID) {
    r.skip(4);
  }
  if (updateFlags & UpdateFlag.LOW_GUID) {
    r.skip(4);
  }
  if (updateFlags & UpdateFlag.HAS_ATTACKING_TARGET) {
    r.packedGuid();
  }
  if (updateFlags & UpdateFlag.TRANSPORT) {
    r.skip(4);
  }
  if (updateFlags & UpdateFlag.VEHICLE) {
    r.skip(4);
    r.skip(4);
  }
  if (updateFlags & UpdateFlag.ROTATION) {
    r.skip(8);
  }

  return {
    updateFlags,
    x,
    y,
    z,
    orientation,
    walkSpeed,
    runSpeed,
    runBackSpeed,
    movementFlags,
  };
}
