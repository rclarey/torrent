// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import {
  ServerRequest as HttpRequest,
} from "https://deno.land/std@0.96.0/http/mod.ts#^";

import { bencode } from "../bencode.ts";
import { UdpTrackerAction } from "../types.ts";
import { writeInt } from "../_bytes.ts";

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
    body.set(transactionId, 4);
    body.set(message, 8);
    await conn.send(body, addr);
  } catch {
    // do nothing
  }
}
