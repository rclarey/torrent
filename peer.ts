// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { writeInt, spreadUint8Array, readInt, readN } from "./_bytes.ts";

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

export function keepAlive(conn: Deno.Conn): Promise<void> {
  return Deno.writeAll(conn, new Uint8Array(4)); // length 0 message <=> keep-alive
}

export function choke(conn: Deno.Conn): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  return Deno.writeAll(conn, msg);
}

export function unchoke(conn: Deno.Conn): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.unchoke;
  return Deno.writeAll(conn, msg);
}

export function interested(conn: Deno.Conn): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.interested;
  return Deno.writeAll(conn, msg);
}

export function uninterested(conn: Deno.Conn): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.uninterested;
  return Deno.writeAll(conn, msg);
}

export function have(conn: Deno.Conn, index: number): Promise<void> {
  const msg = new Uint8Array(9);
  msg[3] = 5;
  msg[4] = MsgId.have;
  writeInt(index, msg, 4, 5);
  return Deno.writeAll(conn, msg);
}

export function bitfield(conn: Deno.Conn, bf: Uint8Array): Promise<void> {
  const length = 1 + bf.length;
  const msg = new Uint8Array(4 + length);
  writeInt(length, msg, 4, 0);
  msg[4] = MsgId.bitfield;
  spreadUint8Array(bf, msg, 5);
  return Deno.writeAll(conn, msg);
}

export function request(
  conn: Deno.Conn,
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
  return Deno.writeAll(conn, msg);
}

export function piece(
  conn: Deno.Conn,
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
  spreadUint8Array(block, msg, 13);
  return Deno.writeAll(conn, msg);
}

export function cancel(
  conn: Deno.Conn,
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
  return Deno.writeAll(conn, msg);
}

export interface KeepAliveMsg {
  conn: Deno.Conn;
}

export interface BodylessMsg {
  id: MsgId.choke | MsgId.unchoke | MsgId.interested | MsgId.uninterested;
  conn: Deno.Conn;
}

export interface HaveMsg {
  id: MsgId.have;
  conn: Deno.Conn;
  index: number;
}

export interface BitfieldMsg {
  id: MsgId.bitfield;
  conn: Deno.Conn;
  bitfield: Uint8Array;
}

export interface RequestMsg {
  id: MsgId.request;
  conn: Deno.Conn;
  index: number;
  offset: number;
  length: number;
}

export interface PieceMsg {
  id: MsgId.piece;
  conn: Deno.Conn;
  index: number;
  offset: number;
  block: Uint8Array;
}

export interface CancelMsg {
  id: MsgId.cancel;
  conn: Deno.Conn;
  index: number;
  offset: number;
  length: number;
}

export interface DisconnectMsg {
  id: MsgId.disconnect;
  conn: Deno.Conn;
  reason?: string;
}

export type PeerMsg =
  | KeepAliveMsg
  | BodylessMsg
  | HaveMsg
  | BitfieldMsg
  | RequestMsg
  | PieceMsg
  | CancelMsg
  | DisconnectMsg;

function checkValidLength(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error("malformed message");
  }
}

export async function* iteratePeerMsgs(
  conn: Deno.Conn,
): AsyncIterableIterator<PeerMsg> {
  try {
    while (true) {
      const length = readInt(await readN(conn, 4), 4, 0);
      if (length === 0) {
        yield { conn };
        continue;
      }

      const id = (await readN(conn, 1))[0];
      switch (id) {
        case MsgId.choke:
        case MsgId.unchoke:
        case MsgId.interested:
        case MsgId.uninterested: {
          checkValidLength(length, 1);
          yield { id, conn };
        }

        case MsgId.have: {
          checkValidLength(length, 5);
          const index = readInt(await readN(conn, 4), 4, 0);
          yield { id, conn, index };
        }

        case MsgId.bitfield: {
          const bitfield = await readN(conn, length - 1);
          yield { id, conn, bitfield };
        }

        case MsgId.request:
        case MsgId.cancel: {
          checkValidLength(length, 13);
          const arr = await readN(conn, 12);
          yield {
            id,
            conn,
            index: readInt(arr, 4, 0),
            offset: readInt(arr, 4, 4),
            length: readInt(arr, 4, 8),
          };
        }

        case MsgId.piece: {
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
        }

        default: {
          // unrecognized message -> read the whole message but ignore it
          await readN(conn, length - 1);
        }
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
