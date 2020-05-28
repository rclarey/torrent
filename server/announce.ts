// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import {
  ServerRequest as HttpRequest,
} from "https://deno.land/std@0.52.0/http/mod.ts#^";

import { bencode } from "../bencode.ts";
import {
  AnnounceEvent,
  AnnounceInfo,
  CompactValue,
} from "../_shared.ts";
import {
  PeerInfo,
  PeerState,
  UdpTrackerAction,
} from "./_shared.ts";
import {
  writeInt,
  spreadUint8Array,
  sendHttpError,
  sendUdpError,
} from "./_helpers.ts";

export abstract class AnnounceRequest implements AnnounceInfo {
  /** SHA1 hash of the bencoded info dictionary */
  infoHash!: Uint8Array;
  /** Self-selected ID */
  peerId!: Uint8Array;
  /**  The IP address at which the client is listening */
  ip!: string;
  /** The port at which the client is listening */
  port!: number;
  /** Number of bytes uploaded */
  uploaded!: BigInt;
  /** Number of bytes downloaded */
  downloaded!: BigInt;
  /** Number of bytes the client still has to download */
  left!: BigInt;
  /** Indicates the purpose of the request */
  event!: AnnounceEvent;
  /** Number of peers that the client would like to receive from the tracker */
  numWant!: number;
  /** Number of seconds to advise clients wait between regular requests */
  interval!: number;
  /** Indicates whether or not the client accepts a compact response */
  compact?: CompactValue;
  /** Send a list of peers to the requesting client */
  abstract respond(peers: PeerInfo[]): Promise<void>;
  /** Send a failure response to the requesting client */
  abstract reject(reason: string): Promise<void>;
}

export interface HttpAnnounceParams extends AnnounceInfo {
  /** Number of peers that the client would like to receive from the tracker */
  numWant: number;
  /** Number of seconds to advise clients wait between regular requests */
  interval: number;
  /** Indicates whether or not the client accepts a compact response */
  compact: CompactValue;
  /** The underlying HTTP request */
  httpRequest: HttpRequest;
}

function countPeers(peers: PeerInfo[]): [number, number] {
  return peers.reduce((counts, { state }) => {
    counts[state === PeerState.seeder ? 0 : 1] += 1;
    return counts;
  }, [0, 0]);
}

export class HttpAnnounceRequest extends AnnounceRequest {
  /** Indicates whether or not the client accepts a compact response */
  compact!: CompactValue;
  /** The underlying HTTP request */
  httpRequest!: HttpRequest;
  /**
   * An addition ID meant to allow a client to prove their identity should their IP
   * address change
   */
  key?: Uint8Array;

  constructor(fields: HttpAnnounceParams) {
    super();
    Object.assign(this, fields);
  }

  /** Send a list of peers to the requesting client */
  respond(peers: PeerInfo[]): Promise<void> {
    try {
      const te = new TextEncoder();
      const [complete, incomplete] = countPeers(peers);

      let body: Uint8Array;
      if (this.compact === CompactValue.compact) {
        const compactPeers = new Uint8Array(6 * peers.length);
        for (const [i, peer] of peers.entries()) {
          const [p1, p2, p3, p4] = peer.ip.split(".");
          compactPeers[6 * i] = Number(p1);
          compactPeers[6 * i + 1] = Number(p2);
          compactPeers[6 * i + 2] = Number(p3);
          compactPeers[6 * i + 3] = Number(p4);
          compactPeers[6 * i + 4] = Number((peer.port / 256) | 0);
          compactPeers[6 * i + 5] = Number(peer.port % 256);
        }
        body = bencode({
          complete,
          incomplete,
          interval: this.interval,
          peers: compactPeers,
        });
      } else {
        body = bencode({
          complete,
          incomplete,
          interval: this.interval,
          peers: peers.map(({ port, id, ip }) => ({
            ip: te.encode(ip),
            "peer id": id,
            port,
          })),
        });
      }

      return this.httpRequest.respond({ body });
    } catch {
      return this.reject("internal error");
    }
  }

  /** Send a failure response to the requesting client */
  reject(reason: string): Promise<void> {
    return sendHttpError(this.httpRequest, reason);
  }
}

export interface UdpAnnounceParams extends AnnounceInfo {
  /** Number of peers that the client would like to receive from the tracker */
  numWant: number;
  /** Number of seconds to advise clients wait between regular requests */
  interval: number;
  /**
   * An addition ID meant to allow a client to prove their identity should their IP
   * address change
   */
  key: Uint8Array;
  /** Unique ID used to identify this transaction */
  transactionId: Uint8Array;
  /** Unique ID used to identify a particular client */
  connectionId: Uint8Array;
  /** Address of the requesting client */
  addr: Deno.Addr;
  /** Underlying UDP socket */
  conn: Deno.DatagramConn;
}

export class UdpAnnounceRequest extends AnnounceRequest {
  /**
   * An addition ID meant to allow a client to prove their identity should their IP
   * address change
   */
  key!: Uint8Array;
  /** Unique ID used to identify this transaction */
  transactionId!: Uint8Array;
  /** Unique ID used to identify a particular client */
  connectionId!: Uint8Array;
  /** Address of the requesting client */
  addr!: Deno.Addr;
  /** Underlying UDP socket */
  conn!: Deno.DatagramConn;

  constructor(params: UdpAnnounceParams) {
    super();
    Object.assign(this, params);
  }

  /** Send a list of peers to the requesting client */
  respond(peers: PeerInfo[]): Promise<void> {
    try {
      const body = new Uint8Array(20 + 6 * peers.length);
      const [complete, incomplete] = countPeers(peers);

      writeInt(UdpTrackerAction.announce, body, 4, 0);
      spreadUint8Array(this.transactionId, body, 4);
      writeInt(this.interval, body, 4, 8);
      writeInt(incomplete, body, 4, 12);
      writeInt(complete, body, 4, 16);

      for (const [i, peer] of peers.entries()) {
        const parts = peer.ip.split(".").map(Number);
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
          throw new Error("Bad peer ip");
        }
        spreadUint8Array(parts, body, 20 + i * 6);
        writeInt(peer.port, body, 2, 24 + i * 6);
      }

      return this.conn.send(body, this.addr);
    } catch {
      return this.reject("internal error");
    }
  }

  /** Send a failure response to the requesting client */
  reject(reason: string): Promise<void> {
    return sendUdpError(this.conn, this.addr, this.transactionId, reason);
  }
}
