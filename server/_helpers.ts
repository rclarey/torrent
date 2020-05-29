// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import {
  ServerRequest as HttpRequest,
} from "https://deno.land/std@0.52.0/http/mod.ts#^";

import { bencode } from "../bencode.ts";
import { UdpTrackerAction } from "./_shared.ts";

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
): BigInt {
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

export function sendHttpError(
  httpRequest: HttpRequest,
  reason: string,
): Promise<void> {
  const te = new TextEncoder();
  const body = bencode({
    "failure reason": te.encode(reason),
  });
  return httpRequest.respond({ body });
}

export async function sendUdpError(
  conn: Deno.DatagramConn,
  addr: Deno.Addr,
  transactionId: Uint8Array,
  reason: string,
): Promise<void> {
  try {
    const message = new TextEncoder().encode(reason);
    const body = new Uint8Array(8 + message.byteLength);
    writeInt(UdpTrackerAction.error, body, 4, 0);
    spreadUint8Array(transactionId, body, 4);
    spreadUint8Array(message, body, 8);
    await conn.send(body, addr);
  } catch {}
}

export function strToUint8Array(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
