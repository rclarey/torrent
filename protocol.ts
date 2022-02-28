// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

import { equals } from "https://deno.land/std@0.96.0/bytes/mod.ts#^";
import { writeAll } from "https://deno.land/std@0.96.0/io/util.ts#^";

import { assert } from "./utils.ts";
import { readInt, readN, writeInt } from "./_bytes.ts";

export type Connection = Deno.Reader & Deno.Writer;

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
  // Number.MAX_SAFE_INTEGER as a literal
  keepalive = 9007199254740991,
}

const HANDSHAKE_PSTR = new TextEncoder().encode("BitTorrent protocol");

// deno-fmt-ignore
const HANDSHAKE_HEADER = [
  // length of pstr
  19,
  ...HANDSHAKE_PSTR,
  // extension bytes
  0, 0, 0, 0, 0, 0, 0, 0,
];

export function sendHandshake(
  conn: Deno.Writer,
  infoHash: Uint8Array,
  peerId: Uint8Array,
): Promise<void> {
  const msg = new Uint8Array(68);
  msg.set(HANDSHAKE_HEADER);
  msg.set(infoHash, 28);
  msg.set(peerId, 48);
  return writeAll(conn, msg);
}

export async function startReceiveHandshake(
  conn: Deno.Reader,
): Promise<Uint8Array> {
  const length = (await readN(conn, 1))[0];
  if (length !== 19) {
    throw new Error("PSTR length in handshake is too short");
  }
  const pstr = await readN(conn, 19);
  if (!equals(HANDSHAKE_PSTR, pstr)) {
    throw new Error('PSTR is not "BitTorrent protocol"');
  }

  return readN(conn, 20);
}

export async function endReceiveHandshake(
  conn: Deno.Reader,
): Promise<Uint8Array> {
  return readN(conn, 20);
}

export function sendKeepAlive(conn: Deno.Writer): Promise<void> {
  return writeAll(conn, new Uint8Array(4)); // length 0 message <=> keep-alive
}

export function sendChoke(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  return writeAll(conn, msg);
}

export function sendUnchoke(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.unchoke;
  return writeAll(conn, msg);
}

export function sendInterested(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.interested;
  return writeAll(conn, msg);
}

export function sendUninterested(conn: Deno.Writer): Promise<void> {
  const msg = new Uint8Array(5);
  msg[3] = 1; // length 1
  msg[4] = MsgId.uninterested;
  return writeAll(conn, msg);
}

export function sendHave(conn: Deno.Writer, index: number): Promise<void> {
  const msg = new Uint8Array(9);
  msg[3] = 5;
  msg[4] = MsgId.have;
  writeInt(index, msg, 4, 5);
  return writeAll(conn, msg);
}

export function sendBitfield(conn: Deno.Writer, bf: Uint8Array): Promise<void> {
  const length = 1 + bf.length;
  const msg = new Uint8Array(4 + length);
  writeInt(length, msg, 4, 0);
  msg[4] = MsgId.bitfield;
  msg.set(bf, 5);
  return writeAll(conn, msg);
}

export function sendRequest(
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

export function sendPiece(
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

export function sendCancel(
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

export interface KeepAliveMsg {
  id: MsgId.keepalive;
}

export interface BodylessMsg {
  id: MsgId.choke | MsgId.unchoke | MsgId.interested | MsgId.uninterested;
}

export interface HaveMsg {
  id: MsgId.have;
  index: number;
}

export interface BitfieldMsg {
  id: MsgId.bitfield;
  bitfield: Uint8Array;
}

export interface RequestMsg {
  id: MsgId.request;
  index: number;
  offset: number;
  length: number;
}

export interface PieceMsg {
  id: MsgId.piece;
  index: number;
  offset: number;
  block: Uint8Array;
}

export interface CancelMsg {
  id: MsgId.cancel;
  index: number;
  offset: number;
  length: number;
}

export type PeerMsg =
  | KeepAliveMsg
  | BodylessMsg
  | HaveMsg
  | BitfieldMsg
  | RequestMsg
  | PieceMsg
  | CancelMsg;

export async function readMessage(conn: Connection) {
  try {
    const length = readInt(await readN(conn, 4), 4, 0);
    if (length === 0) {
      return { conn };
    }

    const id = (await readN(conn, 1))[0];

    // choke, unchoke, interested, uninterested
    switch (id) {
      case MsgId.choke:
      case MsgId.unchoke:
      case MsgId.interested:
      case MsgId.uninterested: {
        assert(length === 1);
        return { id };
      }

      case MsgId.have: {
        assert(length === 5);
        return { id, index: readInt(await readN(conn, 4), 4, 0) };
      }

      case MsgId.bitfield: {
        return { id, bitfield: await readN(conn, length - 1) };
      }

      case MsgId.request:
      case MsgId.cancel: {
        assert(length === 13);
        const body = await readN(conn, 12);
        return {
          id,
          index: readInt(body, 4, 0),
          offset: readInt(body, 4, 4),
          length: readInt(body, 4, 8),
        };
      }

      case MsgId.piece: {
        assert(length > 8);
        const body = await readN(conn, 8);
        return {
          id,
          index: readInt(body, 4, 0),
          offset: readInt(body, 4, 4),
          block: await readN(conn, length - 9),
        };
      }

      default: {
        // unrecognized message -> read the whole message but ignore it
        await readN(conn, length - 1);
        return readMessage(conn);
      }
    }
  } catch (e) {
    // TODO logging
    return null;
  }
}
