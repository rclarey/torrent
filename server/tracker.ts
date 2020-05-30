// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import {
  serve as serveHttp,
  Server as HttpServer,
} from "https://deno.land/std@0.52.0/http/mod.ts#^";
import { MuxAsyncIterator } from "https://deno.land/std@0.52.0/async/mux_async_iterator.ts#^";
import { equal } from "https://deno.land/std@0.52.0/bytes/mod.ts#^";

import { HttpAnnounceRequest, UdpAnnounceRequest } from "./announce.ts";
import { HttpScrapeRequest, UdpScrapeRequest } from "./scrape.ts";
import {
  AnnounceEvent,
  AnnounceInfo,
  CompactValue,
  UdpTrackerAction,
  UDP_EVENT_MAP,
} from "../types.ts";
import { sendHttpError, sendUdpError } from "./_helpers.ts";
import {
  readInt,
  readBigInt,
  writeInt,
  spreadUint8Array,
  strToUint8Array,
} from "../_bytes.ts";

const CONNECT_MAGIC = 0x41727101980n;
const DEFAULT_WANT = 50;
const DEFAULT_INTERVAL = 600; // 10min

const UDP_CONNECT_LENGTH = 16;
const UDP_ANNOUNCE_LENGTH = 98;
const UDP_SCRAPE_LENGTH = 16;

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
    infoHash: strToUint8Array(params.get("info_hash")!),
    peerId: strToUint8Array(params.get("peer_id")!),
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
    key: maybeKey !== null ? strToUint8Array(maybeKey) : undefined,
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
          strHashes.map(strToUint8Array),
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
          this.udpConn!.send(body, addr);
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
