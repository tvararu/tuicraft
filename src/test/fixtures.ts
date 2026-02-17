import { leBytesToBigInt, beBytesToBigInt } from "crypto/srp";

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export const FIXTURE_ACCOUNT = "TEST";
export const FIXTURE_PASSWORD = "TEST";
export const FIXTURE_CHARACTER = "Testchar";

export const salt = fromHex(
  "c9baf3a5728e1d46b0635f2c94d8e711a64b3780cf5269def41a83576ec20b98",
);

export const g = 7n;
export const N = BigInt(
  "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7",
);
export const N_LE = fromHex(
  "b79b3e2a87823cab8f5ebfbf8eb10108535006298b5badbd5b53e1895e644b89",
);

export const clientPrivateKey = leBytesToBigInt(
  fromHex("472b93d61a5ec804f76d3185a90ce25b7834bc60df13974ace52860fa367db19"),
);

export const B = leBytesToBigInt(
  fromHex("216e95e919e445f2d22fca776a133c7e9f2389682c9e5d19ed34a4d9200d350e"),
);
export const B_LE = fromHex(
  "216e95e919e445f2d22fca776a133c7e9f2389682c9e5d19ed34a4d9200d350e",
);

export const expectedA = fromHex(
  "2fb8c7563e1cbe7add815619eae0e13197cb202d170b83c4cc2ffafc0db33721",
);
export const expectedM1 = fromHex("214fdba8149df818e878b0f7627dc6c8f3c06a6d");
export const expectedM2 = beBytesToBigInt(
  fromHex("d647a79c6b71f46b22cc484dd418f9296384d3b5"),
);
export const M2_bytes = fromHex("d647a79c6b71f46b22cc484dd418f9296384d3b5");
export const sessionKey = fromHex(
  "85e4351ee5ae16d2e3c783b49c7a49124e85067b85d5dbb7c9ec645986cb7f6c471b5acabe51e0aa",
);

export const serverSeed = fromHex("deadbeef");
export const clientSeed = fromHex("cafebabe");
