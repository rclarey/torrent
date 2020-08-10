// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

export { equal } from "https://deno.land/std@0.64.0/bytes/mod.ts#^";

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

export function readBigInt(
  arr: Uint8Array,
  nBytes: number,
  offset: number,
): bigint {
  let n = 0n;
  for (const byte of arr.subarray(offset, offset + nBytes)) {
    n <<= 8n;
    n += BigInt(byte);
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

export function writeBigInt(
  n: bigint,
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
    const byte = Number(remaining % 256n);
    remaining = remaining / 256n;
    arr[ind] = byte;
    ind -= 1;
  }
}

export function spreadUint8Array(
  from: Uint8Array | number[],
  to: Uint8Array,
  offset: number,
): void {
  if (from.length + offset > to.length) {
    throw new Error(
      `attempt to spread ${from.length} bytes with offset ${offset}, but array on had length ${to.length}`,
    );
  }

  for (const [ind, value] of from.entries()) {
    to[ind + offset] = value;
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
