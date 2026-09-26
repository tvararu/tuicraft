import { bytes } from "#test-support/hex";

export const DESTROY_WHOLE_STACK = bytes("ff 24 00 000000");
export const DESTROY_TWO_OF_STACK = bytes("ff 1d 02 000000");
export const INVENTORY_FULL_ON_REWARD = bytes(
  "32 0000000000000000 0000000000000000 00",
);
