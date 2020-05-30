// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { bdecode } from "./bencode.ts";
import {
  AnnounceEvent,
  AnnounceInfo,
  Peer,
  ScrapeList,
  UdpTrackerAction,
  UDP_EVENT_MAP,
} from "./types.ts";
import {
  equal,
  writeBigInt,
  writeInt,
  spreadUint8Array,
  readInt,
} from "./_bytes.ts";

const FETCH_TIMEOUT = 1000 * 10;
const UDP_CONNECT_MAGIC = 0x41727101980n;
const UDP_CONNECT_LENGTH = 16;
const UDP_ANNOUNCE_LENGTH = 20;

/** An error thrown when a request times out */
export class TimeoutError extends Error {
  constructor() {
    super("request timed out");
  }
}

function withTimeout<T>(func: () => Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(
      () => reject(new TimeoutError()),
      timeout,
    );
    func().then((r) => {
      clearTimeout(to);
      resolve(r);
    });
  });
}

function timedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return withTimeout(
    () => fetch(url, { ...init, cache: "no-store" }),
    FETCH_TIMEOUT,
  );
}

function validateHttpScrape(data: Uint8Array): ScrapeList {
  const td = new TextDecoder();
  const {
    files,
    ["failure reason"]: reason,
  } = bdecode(data) as any;

  if (reason) {
    throw new Error(td.decode(reason));
  }

  if (typeof files === "object") {
    let list: ScrapeList = [];
    for (const [key, val] of Object.entries(files)) {
      const { complete, incomplete, downloaded } = val as any;
      if (
        typeof complete === "number" && typeof incomplete === "number" &&
        typeof downloaded === "number"
      ) {
        list.push({
          complete,
          downloaded,
          incomplete,
          infoHash: Uint8Array.from(key, (c) => c.charCodeAt(0)),
        });
      } else {
        throw new Error("unknown response format");
      }
    }

    return list;
  }

  throw new Error("unknown response format");
}

async function scrapeHttp(
  url: string,
  infoHashes: Uint8Array[],
): Promise<ScrapeList> {
  try {
    if (infoHashes.length > 0) {
      const strHashes = infoHashes.map((hash) => String.fromCharCode(...hash));
      url += `?info_hash=${strHashes.join("&info_hash=")}`;
    }
    const res = await timedFetch(url);
    return validateHttpScrape(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    throw new Error(`scrape failed: ${e.message}`);
  }
}

/**
 * Make a scrape request to the tracker URL
 *
 * Passing an empty array for `infoHashes` requests info for all torrents
 */
export function scrape(
  url: string,
  infoHashes: Uint8Array[],
): Promise<ScrapeList> {
  const protocol = url.slice(0, url.indexOf("://"));
  switch (protocol) {
    case "http":
    case "https": {
      const ind = url.lastIndexOf("/") + 1;
      // https://wiki.theory.org/index.php/BitTorrentSpecification#Tracker_.27scrape.27_Convention
      if (url.slice(ind, ind + 8) !== "announce") {
        throw new Error(`Cannot derive scrape URL from ${url}`);
      }
      return scrapeHttp(
        `${url.slice(0, ind)}scrape${url.slice(ind + 8)}`,
        infoHashes,
      );
    }

    case "udp": // TODO
    default:
      throw new Error(`${protocol} is not supported for trackers`);
  }
}

function readCompactPeers(peers: Uint8Array): Peer[] | null {
  if (peers.length % 6 === 0) {
    const decodedPeers: Peer[] = [];
    for (let i = 0; i < peers.length; i += 6) {
      decodedPeers.push({
        ip: peers.subarray(i, i + 4).join("."),
        port: (peers[i + 4] << 8) + peers[i + 5],
      });
    }
    return decodedPeers;
  }
  return null;
}

export interface AnnounceResponse {
  /** Number of peers that have the whole file */
  complete: number;
  /** Number of peers that do not have the whole file */
  incomplete: number;
  /** Number of seconds the client is advised to wait between regular requests */
  interval: number;
  /** List of peers that the client can connect to */
  peers: Peer[];
}

function validateHttpAnnounce(data: Uint8Array): AnnounceResponse {
  const td = new TextDecoder();
  let decoded: any;
  try {
    decoded = bdecode(data);
  } catch {
    throw new Error("unknown response format");
  }
  const {
    complete,
    incomplete,
    interval,
    peers,
    ["failure reason"]: reason,
  } = decoded;

  if (
    typeof complete === "number" && typeof incomplete === "number" &&
    typeof interval === "number"
  ) {
    let compactPeers = peers instanceof Uint8Array
      ? readCompactPeers(peers)
      : null;
    if (compactPeers) {
      return {
        complete,
        incomplete,
        interval,
        peers: compactPeers,
      };
    } else if (Array.isArray(peers)) {
      return {
        complete,
        incomplete,
        interval,
        peers: peers.map((p) => ({
          port: p.port,
          id: p["peer id"],
          ip: td.decode(p.ip),
        })),
      };
    }
    // fallthrough
  }

  if (reason instanceof Uint8Array) {
    throw new Error(td.decode(reason));
  }

  throw new Error("unknown response format");
}
async function announceHttp(
  url: string,
  info: AnnounceInfo,
): Promise<AnnounceResponse> {
  const params = new URLSearchParams({
    compact: "1",
    info_hash: String.fromCharCode(...info.infoHash),
    peer_id: String.fromCharCode(...info.peerId),
    ip: info.ip,
    port: info.port.toString(),
    uploaded: info.uploaded.toString(),
    downloaded: info.downloaded.toString(),
    left: info.left.toString(),
    event: info.event ?? AnnounceEvent.empty,
    numwant: info.numWant?.toString() ?? "50",
  });

  try {
    const res = await timedFetch(`${url}?${params}`);
    return validateHttpAnnounce(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    throw new Error(`announce failed: ${e.message}`);
  }
}

const MAX_RETRY_ATTEMPTS = 8;

async function withConnect<T>(
  url: string,
  func: (
    socket: Deno.DatagramConn,
    addr: Deno.Addr,
    connectionId: Uint8Array,
  ) => Promise<T>,
): Promise<T> {
  const match = url.match(/udp:\/\/(.+?):(\d+)\/?/);
  if (!match) {
    throw new Error("bad url");
  }
  const serverAddr = {
    hostname: match[1],
    port: Number(match[2]),
    transport: "udp" as "udp",
  };
  const transactionId = new Uint8Array(4);
  const socket = Deno.listenDatagram({ port: 6961, transport: "udp" });
  let retryAttempt = 0;
  let connectionId: Uint8Array | null = null;

  while (retryAttempt < MAX_RETRY_ATTEMPTS) {
    try {
      if (connectionId === null) {
        crypto.getRandomValues(transactionId);
        const body = new Uint8Array(16);
        writeBigInt(UDP_CONNECT_MAGIC, body, 8, 0);
        writeInt(UdpTrackerAction.connect, body, 4, 8);
        spreadUint8Array(transactionId, body, 12);

        const res = await withTimeout(async (): Promise<Uint8Array> => {
          await socket.send(body, serverAddr);
          return (await socket.receive())[0];
        }, 1000 * 15 * (2 ** retryAttempt));

        const action = readInt(res, 4, 0) as UdpTrackerAction;
        const resTransId = res.subarray(4, 8);
        connectionId = res.subarray(8, 16);
        if (
          res.length < UDP_CONNECT_LENGTH ||
          action !== UdpTrackerAction.connect ||
          !equal(transactionId, resTransId)
        ) {
          // retry connection
          connectionId = null;
          continue;
        }

        // connection is valid for one minute
        setTimeout(() => connectionId = null, 1000 * 60);
      } else {
        crypto.getRandomValues(transactionId);
        return withTimeout(async () => {
          const r = await func(socket, serverAddr, connectionId!);
          socket.close();
          return r;
        }, 1000 * 15 * (2 ** retryAttempt));
      }
    } catch (e) {
      // allows func to throw other errors to indicate retry without increasing timeout
      if (e instanceof TimeoutError) {
        retryAttempt += 1;
      }
    }
  }

  socket.close();
  throw new TimeoutError();
}

async function announceUdp(
  url: string,
  info: AnnounceInfo,
): Promise<AnnounceResponse> {
  const ipParts = info.ip.split(".").map(Number);
  if (ipParts.length !== 4 || ipParts.some((n) => Number.isNaN(n))) {
    throw new Error("Bad peer ip");
  }

  const body = new Uint8Array(98);
  writeInt(UdpTrackerAction.announce, body, 4, 8);
  const transactionId = crypto.getRandomValues(body.subarray(12, 16));
  spreadUint8Array(info.infoHash, body, 16);
  spreadUint8Array(info.peerId, body, 36);
  writeBigInt(info.downloaded, body, 8, 56);
  writeBigInt(info.left, body, 8, 64);
  writeBigInt(info.uploaded, body, 8, 72);
  writeInt(UDP_EVENT_MAP.indexOf(info.event), body, 4, 80);
  spreadUint8Array(ipParts, body, 84);
  if (info.key) {
    spreadUint8Array(info.key, body, 88);
  }
  // since we only write the bottom 4 bytes, Number.MAX_SAFE_INTEGER is
  // equivalent to -1 as a 32-bit int, which in this context means
  // "give me the default amount"
  writeInt(info.numWant ?? Number.MAX_SAFE_INTEGER, body, 4, 92);
  writeInt(info.port, body, 2, 96);

  const res = await withConnect(
    url,
    async (socket, addr, connectionId): Promise<Uint8Array> => {
      spreadUint8Array(connectionId, body, 0);
      await socket.send(body, addr);
      const [result] = await socket.receive();
      const action = readInt(result, 4, 0);
      const resTransId = result.subarray(4, 8);

      if (
        result.length < UDP_ANNOUNCE_LENGTH ||
        action !== UdpTrackerAction.announce ||
        !equal(transactionId, resTransId)
      ) {
        throw new Error("malformed response");
      }

      return result;
    },
  );

  const interval = readInt(res, 4, 8);
  const incomplete = readInt(res, 4, 12);
  const complete = readInt(res, 4, 16);
  const peers = readCompactPeers(res.subarray(20));
  if (!peers) {
    throw new Error("unknown response format");
  }

  return { interval, complete, incomplete, peers };
}

/** Make an announce request to the tracker URL */
export function announce(
  url: string,
  info: AnnounceInfo,
): Promise<AnnounceResponse> {
  const protocol = url.slice(0, url.indexOf("://"));
  switch (protocol) {
    case "http":
    case "https": {
      return announceHttp(url, info);
    }

    case "udp": {
      return announceUdp(url, info);
    }

    default:
      throw new Error(`${protocol} is not supported for trackers`);
  }
}
