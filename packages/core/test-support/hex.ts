export function bytes(hex: string): Uint8Array {
  return Buffer.from(hex.replace(/\s/g, ""), "hex");
}
