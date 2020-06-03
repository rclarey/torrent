// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import {
  serve as serveHttp,
  Server as HttpServer,
  ServerRequest as HttpRequest,
} from "https://deno.land/std@0.52.0/http/mod.ts#^";
import { MuxAsyncIterator } from "https://deno.land/std@0.52.0/async/mux_async_iterator.ts#^";
import { equal } from "https://deno.land/std@0.52.0/bytes/mod.ts#^";

import {
  AnnounceEvent,
  AnnounceInfo,
  CompactValue,
  PeerInfo,
  PeerState,
  ScrapeList,
  UDP_EVENT_MAP,
  UdpTrackerAction,
} from "../types.ts";
import { bencode } from "../bencode.ts";
import { sendHttpError, sendUdpError } from "./_helpers.ts";
import {
  readBigInt,
  readInt,
  spreadUint8Array,
  readStringAsBytes,
  writeInt,
} from "../_bytes.ts";

const CONNECT_MAGIC = 0x41727101980n;
const DEFAULT_WANT = 50;
const DEFAULT_INTERVAL = 600; // 10min

const UDP_CONNECT_LENGTH = 16;
const UDP_ANNOUNCE_LENGTH = 98;
const UDP_SCRAPE_LENGTH = 16;

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
  uploaded!: bigint;
  /** Number of bytes downloaded */
  downloaded!: bigint;
  /** Number of bytes the client still has to download */
  left!: bigint;
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

type ScrapeInfo = {
  complete: number;
  downloaded: number;
  incomplete: number;
};

export abstract class ScrapeRequest {
  /** Requested info hashes */
  infoHashes!: Uint8Array[];
  /** Send aggregate info to the requesting client */
  abstract respond(list: ScrapeList): Promise<void>;
  /** Send a failure response to the requesting client */
  abstract reject(reason: string): Promise<void>;
}

export class HttpScrapeRequest extends ScrapeRequest {
  /**
   * @param httpRequest - The underlying HTTP request
   * @param infoHashes - Requested info hashes
   */
  constructor(
    public httpRequest: HttpRequest,
    public infoHashes: Uint8Array[],
  ) {
    super();
  }

  /** Send aggregate info to the requesting client */
  respond(list: ScrapeList): Promise<void> {
    try {
      const files = new Map<Uint8Array, ScrapeInfo>(
        list.map((
          { infoHash, ...rest },
        ) => [infoHash, rest]),
      );
      const body = bencode({ files });
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

export interface UdpScrapeParams {
  /** Requested info hashes */
  infoHashes: Uint8Array[];
  /** Unique ID used to identify this transaction */
  transactionId: Uint8Array;
  /** Unique ID used to identify a particular client */
  connectionId: Uint8Array;
  /** Address of the requesting client */
  addr: Deno.Addr;
  /** Underlying UDP socket */
  conn: Deno.DatagramConn;
}

export class UdpScrapeRequest extends ScrapeRequest {
  /** Unique ID used to identify this transaction */
  transactionId!: Uint8Array;
  /** Unique ID used to identify a particular client */
  connectionId!: Uint8Array;
  /** Address of the requesting client */
  addr!: Deno.Addr;
  /** Underlying UDP socket */
  conn!: Deno.DatagramConn;

  constructor(params: UdpScrapeParams) {
    super();
    Object.assign(this, params);
  }

  /** Send aggregate info to the requesting client */
  respond(list: ScrapeList): Promise<void> {
    try {
      const body = new Uint8Array(8 + 12 * list.length);

      writeInt(UdpTrackerAction.scrape, body, 4, 0);
      spreadUint8Array(this.transactionId, body, 4);
      let i = 0;
      for (const file of list) {
        writeInt(file.complete, body, 4, 8 + 12 * i);
        writeInt(file.downloaded, body, 4, 12 + 12 * i);
        writeInt(file.incomplete, body, 4, 16 + 12 * i);
        i += 1;
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

function validateAnnounceParams(
  params: URLSearchParams,
): AnnounceInfo | null {
  if (
    !params.has("info_hash") ||
    !params.has("peer_id") ||
    !params.has("ip") ||
    !params.has("port") ||
    !params.has("uploaded") ||
    !params.has("downloaded") ||
    !params.has("left") ||
    !params.has("event")
  ) {
    return null;
  }

  const maybeEvent = params.get("event");
  const maybeNumWant = params.get("num_want");
  const maybeCompact = params.get("compact");
  const maybeKey = params.get("key");
  return {
    infoHash: readStringAsBytes(params.get("info_hash")!),
    peerId: readStringAsBytes(params.get("peer_id")!),
    ip: params.get("ip")!,
    port: Number(params.get("port")!),
    uploaded: BigInt(params.get("uploaded")!),
    downloaded: BigInt(params.get("downloaded")!),
    left: BigInt(params.get("left")!),
    event: maybeEvent && ![...Object.keys(AnnounceEvent)].includes(maybeEvent)
      ? maybeEvent as AnnounceEvent
      : AnnounceEvent.empty,
    numWant: maybeNumWant !== null ? Number(maybeNumWant) : undefined,
    compact: maybeCompact !== null ? maybeCompact as CompactValue : undefined,
    key: maybeKey !== null ? readStringAsBytes(maybeKey) : undefined,
  };
}

export type TrackerRequest =
  | HttpAnnounceRequest
  | HttpScrapeRequest
  | UdpAnnounceRequest
  | UdpScrapeRequest;

export interface ServerParams {
  /** Underlying HTTP server */
  httpServer?: HttpServer;
  /** Underlying UDP socket */
  udpConn?: Deno.DatagramConn;
  /** Number of seconds to advise clients wait between regular requests */
  interval: number;
  /** List of allowed info hashes. If undefined then accept all incoming info hashes */
  filterList?: Uint8Array[];
}

export class TrackerServer implements AsyncIterable<TrackerRequest> {
  /** Set of connection IDs currently in use by UDP connections */
  connectionIds: Set<bigint>;
  /** Number of seconds to advise clients wait between regular requests */
  interval!: number;
  /** List of allowed info hashes. If undefined then accept all incoming info hashes */
  filterList?: Uint8Array[];
  /** Underlying HTTP server */
  httpServer?: HttpServer;
  /** Underlying UDP socket */
  udpConn?: Deno.DatagramConn;

  constructor(params: ServerParams) {
    this.connectionIds = new Set<bigint>();
    Object.assign(this, params);
  }

  private filteredHash(infoHash: Uint8Array): boolean {
    if (!this.filterList) {
      return false;
    }
    return !this.filterList.find((x) => equal(x, infoHash));
  }

  private async *iterateHttpRequests(): AsyncIterableIterator<
    HttpAnnounceRequest | HttpScrapeRequest
  > {
    for await (const httpRequest of this.httpServer!) {
      const match = httpRequest.url.match(/\/(announce|scrape|stats)\??/);
      if (!match) {
        // ignore
        continue;
      }

      const params = new URLSearchParams(
        httpRequest.url.slice(httpRequest.url.indexOf("?")),
      );

      if (match[1] === "announce") {
        const valid = validateAnnounceParams(params);

        if (valid === null) {
          sendHttpError(httpRequest, "bad announce parameters");
          continue;
        }

        if (this.filteredHash(valid.infoHash)) {
          sendHttpError(
            httpRequest,
            "info_hash is not in the list of supported info hashes",
          );
          continue;
        }

        yield new HttpAnnounceRequest({
          httpRequest,
          interval: this.interval,
          ...valid,
          compact: valid.compact ?? CompactValue.full,
          numWant: valid.numWant
            ? Math.min(valid.numWant, DEFAULT_WANT)
            : DEFAULT_WANT,
        });
      } else if (match[1] === "scrape") {
        const strHashes = params.getAll("info_hash") ?? [];
        yield new HttpScrapeRequest(
          httpRequest,
          strHashes.map(readStringAsBytes),
        );
      } else {
        // TODO
      }
    }
  }

  private async *iterateUdpRequests(): AsyncIterableIterator<
    UdpAnnounceRequest | UdpScrapeRequest
  > {
    while (true) {
      try {
        const [data, addr] = await this.udpConn!.receive();
        const frontMatter = readBigInt(data, 8, 0);
        const action = readInt(data, 4, 8);

        // if frontMatter === magic, then its a connect request
        // otherwise it's the announce request
        if (
          frontMatter === CONNECT_MAGIC && action === UdpTrackerAction.connect
        ) {
          const transactionId = data.subarray(12, 16);
          if (data.length < UDP_CONNECT_LENGTH) {
            sendUdpError(
              this.udpConn!,
              addr,
              transactionId,
              "malformed connect request",
            );
          }

          const connectionId = crypto.getRandomValues(new Uint8Array(8));
          const numConnId = readBigInt(connectionId, 8, 0);
          this.connectionIds.add(numConnId);
          // remove id as valid after 2 min
          setTimeout(() => this.connectionIds.delete(numConnId), 120000);

          const body = new Uint8Array(16);
          writeInt(UdpTrackerAction.connect, body, 4, 0);
          spreadUint8Array(transactionId, body, 4);
          spreadUint8Array(connectionId, body, 8);
          await this.udpConn!.send(body, addr);
          continue;
        }

        const connectionId = data.subarray(0, 8);
        if (!this.connectionIds.has(readBigInt(connectionId, 8, 0))) {
          // ignore
          continue;
        }

        const transactionId = data.subarray(12, 16);
        if (action === UdpTrackerAction.announce) {
          if (data.length < UDP_ANNOUNCE_LENGTH) {
            sendUdpError(
              this.udpConn!,
              addr,
              transactionId,
              "malformed announce request",
            );
          }

          const infoHash = data.subarray(16, 36);
          if (this.filteredHash(infoHash)) {
            sendUdpError(
              this.udpConn!,
              addr,
              transactionId,
              "info_hash is not in the list of supported info hashes",
            );
          }

          yield new UdpAnnounceRequest({
            addr,
            infoHash,
            transactionId,
            connectionId,
            interval: this.interval,
            conn: this.udpConn!,
            peerId: data.subarray(36, 56),
            downloaded: readBigInt(data, 8, 56),
            left: readBigInt(data, 8, 64),
            uploaded: readBigInt(data, 8, 72),
            event: UDP_EVENT_MAP[readInt(data, 4, 80)],
            ip: Array.from(data.subarray(84, 88)).map(String).join("."),
            key: data.subarray(88, 92),
            numWant: Math.min(DEFAULT_WANT, readInt(data, 4, 92)),
            port: readInt(data, 4, 96),
          });
        } else if (action === UdpTrackerAction.scrape) {
          if (data.length < UDP_SCRAPE_LENGTH) {
            sendUdpError(
              this.udpConn!,
              addr,
              transactionId,
              "malformed scrape request",
            );
          }

          const infoHashes: Uint8Array[] = [];
          for (let i = 16; i < data.length; i += 20) {
            infoHashes.push(data.subarray(i, i + 20));
          }

          yield new UdpScrapeRequest({
            infoHashes,
            addr,
            transactionId,
            connectionId,
            conn: this.udpConn!,
          });
        }
      } catch {}
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<TrackerRequest> {
    if (this.httpServer && this.udpConn) {
      const mux = new MuxAsyncIterator<TrackerRequest>();
      mux.add(this.iterateUdpRequests());
      mux.add(this.iterateHttpRequests());
      return mux.iterate();
    } else if (this.httpServer) {
      return this.iterateHttpRequests();
    } else if (this.udpConn) {
      return this.iterateUdpRequests();
    }

    throw new Error("must listen for at least one of HTTP or UDP");
  }
}

export interface ServeOptions {
  /** Enable HTTP server. Defaults to true*/
  http?: boolean;
  /** Enable UDP server. Defaults to true*/
  udp?: boolean;
  /** List of allowed info hashes. If undefined then accept all incoming info hashes */
  filterList?: Uint8Array[];
  /** Number of seconds to advise clients wait between regular requests. Defaults to 60 */
  interval?: number;
}

/** Create a tracker server */
export function serveTracker(opts: ServeOptions = {}): TrackerServer {
  let httpServer: HttpServer | undefined;
  let udpConn: Deno.DatagramConn | undefined;
  if (opts.http !== false) {
    httpServer = serveHttp({ port: 80 });
  }
  if (opts.udp !== false) {
    udpConn = Deno.listenDatagram({ port: 6969, transport: "udp" });
  }

  const server = new TrackerServer({
    httpServer,
    udpConn,
    filterList: opts.filterList,
    interval: opts.interval ?? DEFAULT_INTERVAL,
  });

  return server;
}
