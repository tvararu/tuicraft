export function packDbc(
  fieldCount: number,
  rows: number[][],
  strings: Uint8Array = new Uint8Array([0]),
): Uint8Array {
  const recordSize = fieldCount * 4;
  const header = 20;
  const buf = new Uint8Array(
    header + rows.length * recordSize + strings.byteLength,
  );
  const view = new DataView(buf.buffer);
  buf[0] = 0x57;
  buf[1] = 0x44;
  buf[2] = 0x42;
  buf[3] = 0x43;
  view.setUint32(4, rows.length, true);
  view.setUint32(8, fieldCount, true);
  view.setUint32(12, recordSize, true);
  view.setUint32(16, strings.byteLength, true);
  let offset = header;
  for (const row of rows) {
    for (let col = 0; col < fieldCount; col++) {
      view.setUint32(offset + col * 4, row[col] ?? 0, true);
    }
    offset += recordSize;
  }
  buf.set(strings, offset);
  return buf;
}
