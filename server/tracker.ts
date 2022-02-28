// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import {
  serve as serveHttp,
  Server as HttpServer,
  ServerRequest as HttpRequest,
} from "https://deno.land/std@0.96.0/http/mod.ts#^";
import { MuxAsyncIterator } from "https://deno.land/std@0.96.0/async/mux_async_iterator.ts#^";
import { equals } from "https://deno.land/std@0.96.0/bytes/mod.ts#^";

import {
  AnnounceEvent,
  AnnounceInfo,
  AnnouncePeerInfo,
  AnnouncePeerState,
  CompactValue,
  ScrapeData,
  UDP_EVENT_MAP,
  UdpTrackerAction,
} from "../types.ts";
import { bencode } from "../bencode.ts";
import {
  ANNOUNCE_DEFAULT_INTERVAL,
  ANNOUNCE_DEFAULT_WANT,
  UDP_ANNOUNCE_REQ_LENGTH,
  UDP_CONNECT_LENGTH,
  UDP_CONNECT_MAGIC,
  UDP_SCRAPE_REQ_LENGTH,
} from "../constants.ts";
import { sendHttpError, sendUdpError } from "./_helpers.ts";
import { decodeBinaryData, readInt, writeInt } from "../_bytes.ts";

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
  uploaded!: number;
  /** Number of bytes downloaded */
  downloaded!: number;
  /** Number of bytes the client still has to download */
  left!: number;
  /** Indicates the purpose of the request */
  event!: AnnounceEvent;
  /** Number of peers that the client would like to receive from the tracker */
  numWant!: number;
  /** Number of seconds to advise clients wait between regular requests */
  interval!: number;
  /** Indicates whether or not the client accepts a compact response */
  compact!: CompactValue;
  /** Send a list of peers to the requesting client */
  abstract respond(peers: AnnouncePeerInfo[]): Promise<void>;
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

function countPeers(peers: AnnouncePeerInfo[]): [number, number] {
  return peers.reduce(
    (counts, { state }) => {
      counts[state === AnnouncePeerState.seeder ? 0 : 1] += 1;
      return counts;
    },
    [0, 0],
  );
}

export class HttpAnnounceRequest extends AnnounceRequest {
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
  respond(peers: AnnouncePeerInfo[]): Promise<void> {
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
  async respond(peers: AnnouncePeerInfo[]): Promise<void> {
    try {
      const body = new Uint8Array(20 + 6 * peers.length);
      const [complete, incomplete] = countPeers(peers);

      writeInt(UdpTrackerAction.announce, body, 4, 0);
      body.set(this.transactionId, 4);
      writeInt(this.interval, body, 4, 8);
      writeInt(incomplete, body, 4, 12);
      writeInt(complete, body, 4, 16);

      for (const [i, peer] of peers.entries()) {
        const parts = peer.ip.split(".").map(Number);
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
          throw new Error("Bad peer ip");
        }
        body.set(parts, 20 + i * 6);
        writeInt(peer.port, body, 2, 24 + i * 6);
      }

      await this.conn.send(body, this.addr);
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
  abstract respond(list: ScrapeData[]): Promise<void>;
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
  respond(list: ScrapeData[]): Promise<void> {
    try {
      const files = new Map<Uint8Array, ScrapeInfo>(
        list.map(({ infoHash, ...rest }) => [infoHash, rest]),
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
  async respond(list: ScrapeData[]): Promise<void> {
    try {
      const body = new Uint8Array(8 + 12 * list.length);

      writeInt(UdpTrackerAction.scrape, body, 4, 0);
      body.set(this.transactionId, 4);
      let i = 0;
      for (const file of list) {
        writeInt(file.complete, body, 4, 8 + 12 * i);
        writeInt(file.downloaded, body, 4, 12 + 12 * i);
        writeInt(file.incomplete, body, 4, 16 + 12 * i);
        i += 1;
      }

      await this.conn.send(body, this.addr);
    } catch {
      return this.reject("internal error");
    }
  }

  /** Send a failure response to the requesting client */
  reject(reason: string): Promise<void> {
    return sendUdpError(this.conn, this.addr, this.transactionId, reason);
  }
}

interface ParsedParams {
  ip: string;
  params: URLSearchParams;
  infoHashes: Uint8Array[];
  peerId: Uint8Array | null;
  key: Uint8Array | null;
}

function parseParams(req: HttpRequest): ParsedParams {
  let peerId: Uint8Array | null = null;
  let key: Uint8Array | null = null;
  const infoHashes: Uint8Array[] = [];
  const queryStr = req.url
    .replace(/[^?]*\?/, "")
    .replace(/(?:^|&)info_hash=([^&]+)/g, (_, hash) => {
      infoHashes.push(decodeBinaryData(hash));
      return "&";
    })
    .replace(/(?:^|&)peer_id=([^&]+)/g, (_, id) => {
      peerId = decodeBinaryData(id);
      return "&";
    })
    .replace(/(?:^|&)key=([^&]+)/g, (_, keyData) => {
      key = decodeBinaryData(keyData);
      return "&";
    });

  let ip = (req.conn.remoteAddr as Deno.NetAddr).hostname;
  if (req.headers.has("X-Forwarded-For")) {
    ip = req.headers.get("X-Forwarded-For")!.split(", ")[0];
  }

  return {
    params: new URLSearchParams(queryStr),
    ip,
    infoHashes,
    peerId,
    key,
  };
}

function validateAnnounceParams({
  ip,
  params,
  peerId,
  infoHashes,
  key,
}: ParsedParams): AnnounceInfo | null {
  if (
    peerId === null ||
    infoHashes.length !== 1 ||
    !params.has("port") ||
    !params.has("uploaded") ||
    !params.has("downloaded") ||
    !params.has("left")
  ) {
    return null;
  }

  const maybeEvent = params.get("event");
  const maybeNumWant = params.get("num_want");
  const maybeCompact = params.get("compact");
  return {
    peerId,
    infoHash: infoHashes[0],
    ip: params.get("ip") ?? ip,
    port: Number(params.get("port")!),
    uploaded: Number(params.get("uploaded")!),
    downloaded: Number(params.get("downloaded")!),
    left: Number(params.get("left")!),
    event: maybeEvent && Object.keys(AnnounceEvent).includes(maybeEvent)
      ? (maybeEvent as AnnounceEvent)
      : AnnounceEvent.empty,
    numWant: maybeNumWant !== null ? Number(maybeNumWant) : undefined,
    compact: maybeCompact !== null ? (maybeCompact as CompactValue) : undefined,
    key: key ?? undefined,
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
  connectionIds = new Set<string>();
  /** Number of seconds to advise clients wait between regular requests */
  interval!: number;
  /** List of allowed info hashes. If undefined then accept all incoming info hashes */
  filterList?: Uint8Array[];
  /** Underlying HTTP server */
  httpServer?: HttpServer;
  /** Underlying UDP socket */
  udpConn?: Deno.DatagramConn;

  constructor(params: ServerParams) {
    Object.assign(this, params);
  }

  private filteredHash(infoHash: Uint8Array): boolean {
    if (!this.filterList) {
      return false;
    }
    return !this.filterList.find((x) => equals(x, infoHash));
  }

  private async *iterateHttpRequests(): AsyncIterableIterator<
    HttpAnnounceRequest | HttpScrapeRequest
  > {
    for await (const httpRequest of this.httpServer!) {
      try {
        const match = httpRequest.url.match(/\/(announce|scrape|stats)\??/);
        if (!match) {
          // ignore
          continue;
        }

        const parsed = parseParams(httpRequest);

        if (match[1] === "announce") {
          const valid = validateAnnounceParams(parsed);

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
            numWant: valid.numWant ?? ANNOUNCE_DEFAULT_WANT,
          });
        } else if (match[1] === "scrape") {
          yield new HttpScrapeRequest(httpRequest, parsed.infoHashes);
        } else {
          // TODO
        }
      } catch (e) {
        // TODO log or something
        console.log(e);
      }
    }
  }

  private async *iterateUdpRequests(): AsyncIterableIterator<
    UdpAnnounceRequest | UdpScrapeRequest
  > {
    while (true) {
      try {
        const [data, addr] = await this.udpConn!.receive();
        const frontMatter = data.subarray(0, 8);
        const action = readInt(data, 4, 8);

        // if frontMatter === magic, then its a connect request
        // otherwise it's the announce request
        if (
          equals(frontMatter, UDP_CONNECT_MAGIC) &&
          action === UdpTrackerAction.connect
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
          const strConnId = connectionId.toString();
          this.connectionIds.add(strConnId);
          // remove id as valid after 2 min
          setTimeout(() => this.connectionIds.delete(strConnId), 120000);

          const body = new Uint8Array(16);
          writeInt(UdpTrackerAction.connect, body, 4, 0);
          body.set(transactionId, 4);
          body.set(connectionId, 8);
          await this.udpConn!.send(body, addr);
          continue;
        }

        const connectionId = data.subarray(0, 8);
        if (!this.connectionIds.has(connectionId.toString())) {
          // ignore
          continue;
        }

        const transactionId = data.subarray(12, 16);
        if (action === UdpTrackerAction.announce) {
          if (data.length < UDP_ANNOUNCE_REQ_LENGTH) {
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
            downloaded: readInt(data, 8, 56),
            left: readInt(data, 8, 64),
            uploaded: readInt(data, 8, 72),
            event: UDP_EVENT_MAP[readInt(data, 4, 80)],
            ip: Array.from(data.subarray(84, 88)).map(String).join("."),
            key: data.subarray(88, 92),
            numWant: Math.min(ANNOUNCE_DEFAULT_WANT, readInt(data, 4, 92)),
            port: readInt(data, 4, 96),
          });
        } else if (action === UdpTrackerAction.scrape) {
          if (data.length < UDP_SCRAPE_REQ_LENGTH) {
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
      } catch {
        // do nothing
      }
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
  /** HTTP server options */
  http?: {
    disable?: boolean;
    port?: number;
  };
  /** UDP server options */
  udp?: {
    disable?: boolean;
    port?: number;
  };
  /** List of allowed info hashes. If undefined then accept all incoming info hashes */
  filterList?: Uint8Array[];
  /** Number of seconds to advise clients wait between regular requests. Defaults to 60 */
  interval?: number;
}

/** Create a tracker server */
export function serveTracker(opts: ServeOptions = {}): TrackerServer {
  let httpServer: HttpServer | undefined;
  let udpConn: Deno.DatagramConn | undefined;
  if (opts.http?.disable !== true) {
    httpServer = serveHttp({ port: opts.http?.port ?? 80 });
  }
  if (opts.udp?.disable !== true) {
    udpConn = Deno.listenDatagram({
      port: opts.udp?.port ?? 6969,
      transport: "udp",
    });
  }

  const server = new TrackerServer({
    httpServer,
    udpConn,
    filterList: opts.filterList,
    interval: opts.interval ?? ANNOUNCE_DEFAULT_INTERVAL,
  });

  return server;
}
