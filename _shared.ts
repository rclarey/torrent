// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

export enum AnnounceEvent {
  /** Indicates the announce request is one performed at regular intervals */
  empty = "empty",
  /** Must be sent with the first request to the tracker */
  started = "started",
  /**
   * Must be sent to the tracker when the download completes, but not if the download was
   * already complete when the client started
   */
  completed = "completed",
  /** Must be sent if the client is shutting down gracefully */
  stopped = "stopped",
}

export const enum CompactValue {
  /** Compact peer list is accepted */
  compact = "1",
  /** Compact peer list is not accepted */
  full = "0",
}

export interface Peer {
  /** IP address of the peer */
  ip: string;
  /** TCP port of the peer */
  port: number;
  /** Peer's self-selected ID */
  id?: Uint8Array;
}

export interface AnnounceInfo {
  /** SHA1 hash of the bencoded info dictionary */
  infoHash: Uint8Array;
  /** Self-selected ID */
  peerId: Uint8Array;
  /**  The IP address at which the client is listening */
  ip: string;
  /** The port at which the client is listening */
  port: number;
  /** Number of bytes uploaded */
  uploaded: BigInt;
  /** Number of bytes downloaded */
  downloaded: BigInt;
  /** Number of bytes the client still has to download */
  left: BigInt;
  /** Indicates the purpose of the request */
  event: AnnounceEvent;
  /** Number of peers that the client would like to receive from the tracker */
  numWant?: number;
  /** Indicates whether or not the client accepts a compact response */
  compact?: CompactValue;
  /**
   * An addition ID meant to allow a client to prove their identity should their IP
   * address change
   */
  key?: Uint8Array;
}

export type ScrapeList = {
  complete: number;
  downloaded: number;
  incomplete: number;
  infoHash: Uint8Array;
}[];
