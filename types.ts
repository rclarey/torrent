// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

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

// Mapping from AnnounceEvent to int
export const UDP_EVENT_MAP = [
  AnnounceEvent.empty,
  AnnounceEvent.completed,
  AnnounceEvent.started,
  AnnounceEvent.stopped,
];

export enum CompactValue {
  /** Compact peer list is accepted */
  compact = "1",
  /** Compact peer list is not accepted */
  full = "0",
}

export interface AnnouncePeer {
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
  uploaded: number;
  /** Number of bytes downloaded */
  downloaded: number;
  /** Number of bytes the client still has to download */
  left: number;
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

export type ScrapeData = {
  /** Number of peers who have the whole file */
  complete: number;
  /** Number of completed downloads */
  downloaded: number;
  /** Number of peers who do not yet have the whole file */
  incomplete: number;
  /** Info hash for the file */
  infoHash: Uint8Array;
};

export enum AnnouncePeerState {
  /** The peer has the whole file */
  seeder = "seeder",
  /** The peer does not have the whole file */
  leecher = "leecher",
}

export interface AnnouncePeerInfo extends AnnouncePeer {
  /** Peer's self-selected ID */
  id: Uint8Array;
  /** Whether this peer is a leecher or seeder */
  state: AnnouncePeerState;
}

export enum UdpTrackerAction {
  connect = 0,
  announce = 1,
  scrape = 2,
  error = 3,
}
