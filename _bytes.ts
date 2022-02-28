// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

export { equals } from "https://deno.land/std@0.96.0/bytes/mod.ts#^";

export async function readN(
  reader: Deno.Reader,
  n: number,
  arr?: Uint8Array,
): Promise<Uint8Array> {
  const out = arr ?? new Uint8Array(n);
  let nRead = 0;
  while (nRead < n) {
    const m = await reader.read(out.subarray(nRead));
    if (m === null) {
      throw new Deno.errors.UnexpectedEof(
        `reached EOF but we expected to read ${n - nRead} more bytes`,
      );
    }
    nRead += m;
  }
  return out;
}

export function readInt(
  arr: Uint8Array,
  nBytes: number,
  offset: number,
): number {
  let n = 0;
  for (const byte of arr.subarray(offset, offset + nBytes)) {
    n <<= 8;
    n += byte;
  }
  return n;
}

export function writeInt(
  n: number,
  arr: Uint8Array,
  nBytes: number,
  offset: number,
): void {
  if (nBytes + offset > arr.length) {
    throw new Error(
      `attempt to write ${nBytes} bytes with offset ${offset}, but array only has length ${arr.length}`,
    );
  }
  let remaining = n;
  let ind = offset + nBytes - 1;
  while (ind >= offset) {
    const byte = remaining % 256;
    remaining = (remaining / 256) | 0;
    arr[ind] = byte;
    ind -= 1;
  }
}

export function decodeBinaryData(s: string): Uint8Array {
  const hash: number[] = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === "%") {
      hash.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      hash.push(s.charCodeAt(i));
      i += 1;
    }
  }

  return Uint8Array.from(hash);
}

export function encodeBinaryData(arr: Uint8Array): string {
  let str = "";
  for (const byte of arr) {
    if (
      (byte > 44 && byte < 58 && byte !== 47) ||
      (byte > 64 && byte < 91) ||
      byte === 95 ||
      (byte > 96 && byte < 123) ||
      byte === 126
    ) {
      str += String.fromCharCode(byte);
    } else {
      str += `%${byte.toString(16)}`;
    }
  }

  return str;
}

export function partition(arr: Uint8Array, n: number): Uint8Array[] {
  const slices: Uint8Array[] = [];
  for (let i = 0; i < arr.length; i += n) {
    slices.push(arr.subarray(i, i + n));
  }

  return slices;
}
