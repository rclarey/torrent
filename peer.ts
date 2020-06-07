// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { writeInt, spreadUint8Array, readInt } from "./_bytes.ts";

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

async function readN(reader: Deno.Reader, n: number): Promise<Uint8Array> {
  const out = new Uint8Array(n);
  let nRead = 0;
  while (nRead < n) {
    const m = await reader.read(out.subarray(nRead));
    if (m === null) {
      throw new Error(
        `reached EOF but we expected to read ${n - nRead} more bytes`,
      );
    }
    nRead += m;
  }
  return out;
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

      // TODO handle recognized messages

      // unrecognized message -> read the whole message but ignore it
      await readN(conn, length - 1);
    }
  } catch (e) {
    if (e instanceof Deno.errors.BadResource) {
      yield { id: MsgId.disconnect, conn };
    } else {
      yield { id: MsgId.disconnect, conn, reason: e.message };
    }
  }
}

/*
keep-alive: <len=0000>
choke: <len=0001><id=0>
unchoke: <len=0001><id=1>
interested: <len=0001><id=2>
not interested: <len=0001><id=3>
have: <len=0005><id=4><piece index>
bitfield: <len=0001+X><id=5><bitfield>
request: <len=0013><id=6><index><begin><length>
piece: <len=0009+X><id=7><index><begin><block>
cancel: <len=0013><id=8><index><begin><length>
 */
