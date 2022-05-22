// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import { Metainfo } from "./metainfo.ts";
import { Connection } from "./protocol.ts";

export interface PeerParams {
  id: string;
  conn: Connection;
  metainfo: Metainfo;
}

export class Peer {
  id: string;
  conn: Connection;
  bitfield: Uint8Array;

  isChoking = true;
  isInterested = false;
  amChoking = true;
  amInterested = false;

  constructor({ id, conn, metainfo }: PeerParams) {
    this.id = id;
    this.conn = conn;
    this.bitfield = new Uint8Array(Math.ceil(metainfo.info.pieces.length / 8));
  }
}
