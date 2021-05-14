// Copyright (C) 2021 Russell Clarey. All rights reserved. MIT license.

import { writeAll } from "https://deno.land/std@0.96.0/io/util.ts#^";

import { readInt, readN, writeInt } from "./_bytes.ts";

export enum MsgId {
  choke = 0,
  unchoke = 1,
  interested = 2,
  uninterested = 3,
  have = 4,
  bitfield = 5,
  request = 6,
  piece = 7,
  cancel = 8,
  disconnect = 9007199254740991, // max safe int
}

export function keepAlive(conn: Deno.Writer): Promise<void> {
  return writeAll(conn, new Uint8Array(4)); // length 0 message <=> keep-alive
}

export function choke(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  return writeAll(conn, msg);
}

export function unchoke(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.unchoke;
  return writeAll(conn, msg);
}

export function interested(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.interested;
  return writeAll(conn, msg);
}

export function uninterested(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.uninterested;
  return writeAll(conn, msg);
}

export function have(conn: Deno.Writer, index: number): Promise<void> {
  const msg = new Uint8Array(9);
  msg[3] = 5;
  msg[4] = MsgId.have;
  writeInt(index, msg, 4, 5);
  return writeAll(conn, msg);
}

export function bitfield(conn: Deno.Writer, bf: Uint8Array): Promise<void> {
  const length = 1 + bf.length;
  const msg = new Uint8Array(4 + length);
  writeInt(length, msg, 4, 0);
  msg[4] = MsgId.bitfield;
  msg.set(bf, 5);
  return writeAll(conn, msg);
}

export function request(
  conn: Deno.Writer,
  index: number,
  offset: number,
  length: number,
): Promise<void> {
  const msg = new Uint8Array(17);
  msg[3] = 13;
  msg[4] = MsgId.request;
  writeInt(index, msg, 4, 5);
  writeInt(offset, msg, 4, 9);
  writeInt(length, msg, 4, 13);
  return writeAll(conn, msg);
}

export function piece(
  conn: Deno.Writer,
  index: number,
  offset: number,
  block: Uint8Array,
): Promise<void> {
  const length = 9 + block.length;
  const msg = new Uint8Array(4 + length);
  writeInt(length, msg, 4, 0);
  msg[4] = MsgId.piece;
  writeInt(index, msg, 4, 5);
  writeInt(offset, msg, 4, 9);
  msg.set(block, 13);
  return writeAll(conn, msg);
}

export function cancel(
  conn: Deno.Writer,
  index: number,
  offset: number,
  length: number,
): Promise<void> {
  const msg = new Uint8Array(17);
  msg[3] = 13;
  msg[4] = MsgId.cancel;
  writeInt(index, msg, 4, 5);
  writeInt(offset, msg, 4, 9);
  writeInt(length, msg, 4, 13);
  return writeAll(conn, msg);
}

type Connection = Deno.Reader & Deno.Writer;

export interface KeepAliveMsg<T extends Connection> {
  conn: T;
}

export interface BodylessMsg<T extends Connection> {
  id: MsgId.choke | MsgId.unchoke | MsgId.interested | MsgId.uninterested;
  conn: T;
}

export interface HaveMsg<T extends Connection> {
  id: MsgId.have;
  conn: T;
  index: number;
}

export interface BitfieldMsg<T extends Connection> {
  id: MsgId.bitfield;
  conn: T;
  bitfield: Uint8Array;
}

export interface RequestMsg<T extends Connection> {
  id: MsgId.request;
  conn: T;
  index: number;
  offset: number;
  length: number;
}

export interface PieceMsg<T extends Connection> {
  id: MsgId.piece;
  conn: T;
  index: number;
  offset: number;
  block: Uint8Array;
}

export interface CancelMsg<T extends Connection> {
  id: MsgId.cancel;
  conn: T;
  index: number;
  offset: number;
  length: number;
}

export interface DisconnectMsg<T extends Connection> {
  id: MsgId.disconnect;
  conn: T;
  reason?: string;
}

export type PeerMsg<T extends Connection> =
  | KeepAliveMsg<T>
  | BodylessMsg<T>
  | HaveMsg<T>
  | BitfieldMsg<T>
  | RequestMsg<T>
  | PieceMsg<T>
  | CancelMsg<T>
  | DisconnectMsg<T>;

function checkValidLength(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error("malformed message");
  }
}

export async function* iteratePeerMsgs<T extends Connection>(
  conn: T,
): AsyncIterableIterator<PeerMsg<T>> {
  try {
    while (true) {
      const length = readInt(await readN(conn, 4), 4, 0);
      if (length === 0) {
        yield { conn };
        continue;
      }

      const id = (await readN(conn, 1))[0];

      // choke, unchoke, interested, uninterested
      if (id <= MsgId.uninterested) {
        checkValidLength(length, 1);
        yield { id, conn };
      } else if (id === MsgId.have) {
        checkValidLength(length, 5);
        const index = readInt(await readN(conn, 4), 4, 0);
        yield { id, conn, index };
      } else if (MsgId.bitfield) {
        const bitfield = await readN(conn, length - 1);
        yield { id, conn, bitfield };
      } else if (id === MsgId.request || id === MsgId.cancel) {
        checkValidLength(length, 13);
        const arr = await readN(conn, 12);
        yield {
          id,
          conn,
          index: readInt(arr, 4, 0),
          offset: readInt(arr, 4, 4),
          length: readInt(arr, 4, 8),
        };
      } else if (id === MsgId.piece) {
        if (length < 9) {
          throw new Error("malformed message");
        }
        const arr = await readN(conn, 8);
        yield {
          id,
          conn,
          index: readInt(arr, 4, 0),
          offset: readInt(arr, 4, 4),
          block: await readN(conn, length - 9),
        };
      } else {
        // unrecognized message -> read the whole message but ignore it
        await readN(conn, length - 1);
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.BadResource) {
      yield { id: MsgId.disconnect, conn };
    } else {
      yield { id: MsgId.disconnect, conn, reason: e.message };
    }
  }
}
