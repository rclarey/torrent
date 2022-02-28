// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import { bdecode, bdecodeBytestringMap, Bencodeable } from "./bencode.ts";
import {
  FETCH_TIMEOUT,
  UDP_ANNOUNCE_RES_LENGTH,
  UDP_CONNECT_LENGTH,
  UDP_CONNECT_MAGIC,
  UDP_ERROR_LENGTH,
  UDP_MAX_ATTEMPTS,
  UDP_SCRAPE_RES_LENGTH,
} from "./constants.ts";
import {
  AnnounceEvent,
  AnnounceInfo,
  AnnouncePeer,
  CompactValue,
  ScrapeData,
  UDP_EVENT_MAP,
  UdpTrackerAction,
} from "./types.ts";
import { encodeBinaryData, equals, readInt, writeInt } from "./_bytes.ts";
import { arr, inst, num, obj, or, undef } from "./valid.ts";
import { withTimeout } from "./utils.ts";

function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return withTimeout(
    () => fetch(url, { ...init, cache: "no-store" }),
    FETCH_TIMEOUT,
  );
}

const validateScrapeData = obj({
  complete: num,
  downloaded: num,
  incomplete: num,
});

function parseHttpScrape(data: Uint8Array): ScrapeData[] {
  let decoded: Map<Uint8Array, Bencodeable> | { failureReason: string };
  try {
    decoded = bdecodeBytestringMap(data);
  } catch {
    throw new Error("unknown response format");
  }

  if ("failureReason" in decoded) {
    throw new Error(`tracker sent error: ${decoded.failureReason}`);
  }

  return [...decoded.entries()].map(([infoHash, data]) => {
    if (!validateScrapeData(data)) {
      throw new Error("unknown response format");
    }
    return { ...data, infoHash };
  });
}

async function scrapeHttp(
  url: string,
  infoHashes: Uint8Array[],
): Promise<ScrapeData[]> {
  if (infoHashes.length > 0) {
    const strHashes = infoHashes.map(encodeBinaryData);
    url += `?info_hash=${strHashes.join("&info_hash=")}`;
  }
  const res = await timedFetch(url);
  return parseHttpScrape(new Uint8Array(await res.arrayBuffer()));
}

function deriveUdpError(action: UdpTrackerAction, arr: Uint8Array): Error {
  if (action === UdpTrackerAction.error && arr.length >= UDP_ERROR_LENGTH) {
    const reason = new TextDecoder().decode(arr.subarray(8));
    return new Error(`tracker sent error: ${reason}`);
  }
  return new Error("unknown response format");
}

export async function withConnect<T>(
  url: string,
  reqBody: Uint8Array,
  func: (response: Uint8Array) => T,
): Promise<T> {
  const match = url.match(/udp:\/\/(.+?):(\d+)\/?/);
  if (!match) {
    throw new Error("bad url");
  }
  const serverAddr: Deno.Addr = {
    hostname: match[1],
    port: Number(match[2]),
    transport: "udp",
  };
  const socket = Deno.listenDatagram({
    port: 6961,
    transport: "udp",
    hostname: "0.0.0.0",
  });
  let retryAttempt = 0;
  let connectionId: Uint8Array | null = null;
  let connTimer: number | undefined;

  while (retryAttempt < UDP_MAX_ATTEMPTS) {
    if (connectionId === null) {
      const connectBody = new Uint8Array(16);
      connectBody.set(UDP_CONNECT_MAGIC, 0);
      writeInt(UdpTrackerAction.connect, connectBody, 4, 8);
      const transactionId = crypto.getRandomValues(
        connectBody.subarray(12, 16),
      );

      let res: Uint8Array;
      try {
        res = await withTimeout(async () => {
          await socket.send(connectBody, serverAddr);
          return (await socket.receive())[0];
        }, 1000 * 15 * 2 ** retryAttempt);
      } catch {
        retryAttempt += 1;
        continue;
      }

      const action = readInt(res, 4, 0) as UdpTrackerAction;
      const resTransId = res.subarray(4, 8);

      if (!equals(transactionId, resTransId)) {
        // not our transaction id -> ignore
        continue;
      }

      if (
        res.length < UDP_CONNECT_LENGTH ||
        action !== UdpTrackerAction.connect
      ) {
        socket.close();
        throw deriveUdpError(action, res);
      }

      // connection is valid for one minute
      connectionId = res.subarray(8, 16);
      connTimer = setTimeout(() => (connectionId = null), 1000 * 60);
    } else {
      reqBody.set(connectionId, 0);
      const transactionId = crypto.getRandomValues(reqBody.subarray(12, 16));

      let res: Uint8Array;
      try {
        res = await withTimeout(async () => {
          await socket.send(reqBody, serverAddr);
          return (await socket.receive())[0];
        }, 1000 * 15 * 2 ** retryAttempt);
      } catch {
        retryAttempt += 1;
        continue;
      }

      const resTransId = res.subarray(4, 8);
      if (!equals(transactionId, resTransId)) {
        // not our transaction id -> ignore
        continue;
      }

      // we have our result! now we can apply func
      socket.close();
      clearTimeout(connTimer);
      return func(res);
    }
  }

  socket.close();
  clearTimeout(connTimer);
  throw new Error("could not connect to tracker");
}

function scrapeUdp(
  url: string,
  infoHashes: Uint8Array[],
): Promise<ScrapeData[]> {
  const body = new Uint8Array(16 + 20 * infoHashes.length);
  writeInt(UdpTrackerAction.scrape, body, 4, 8);
  for (const [i, hash] of infoHashes.entries()) {
    body.set(hash, 16 + 20 * i);
  }

  return withConnect(url, body, (result) => {
    const action = readInt(result, 4, 0);

    if (
      result.length < UDP_SCRAPE_RES_LENGTH ||
      action !== UdpTrackerAction.scrape
    ) {
      throw deriveUdpError(action, result);
    }

    const nHashes = ((result.length - UDP_SCRAPE_RES_LENGTH) / 12) | 0;
    const list: ScrapeData[] = [];
    for (const [i, infoHash] of infoHashes.slice(0, nHashes).entries()) {
      list.push({
        complete: readInt(result, 4, 8 + 12 * i),
        downloaded: readInt(result, 4, 12 + 12 * i),
        incomplete: readInt(result, 4, 16 + 12 * i),
        infoHash,
      });
    }

    return list;
  });
}

/**
 * Make a scrape request to the tracker URL
 *
 * Passing an empty array for `infoHashes` requests info for all torrents
 */
export function scrape(
  url: string,
  infoHashes: Uint8Array[],
): Promise<ScrapeData[]> {
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

    case "udp": {
      return scrapeUdp(url, infoHashes);
    }

    default:
      throw new Error(`${protocol} is not supported for trackers`);
  }
}

function readCompactPeers(peers: Uint8Array): AnnouncePeer[] {
  const decodedPeers: AnnouncePeer[] = [];
  for (let i = 0; i < peers.length - 5; i += 6) {
    decodedPeers.push({
      ip: peers.subarray(i, i + 4).join("."),
      port: (peers[i + 4] << 8) + peers[i + 5],
    });
  }
  return decodedPeers;
}

export interface AnnounceResponse {
  /** Number of peers that have the whole file */
  complete: number;
  /** Number of peers that do not have the whole file */
  incomplete: number;
  /** Number of seconds the client is advised to wait between regular requests */
  interval: number;
  /** List of peers that the client can connect to */
  peers: AnnouncePeer[];
}

const validateHttpAnnounce = obj({
  complete: num,
  incomplete: num,
  interval: num,
  peers: or(
    inst(Uint8Array),
    arr(
      obj({
        ip: inst(Uint8Array),
        port: num,
        "peer id": or(undef, inst(Uint8Array)),
      }),
    ),
  ),
});

function parseHttpAnnounce(data: Uint8Array): AnnounceResponse {
  const td = new TextDecoder();
  let decoded: Bencodeable;
  try {
    decoded = bdecode(data);
  } catch {
    throw new Error("unknown response format");
  }

  if (
    typeof decoded === "object" &&
    "failure reason" in decoded &&
    decoded["failure reason"] instanceof Uint8Array
  ) {
    throw new Error(
      `tracker sent error: ${td.decode(decoded["failure reason"])}`,
    );
  }

  if (!validateHttpAnnounce(decoded)) {
    throw new Error("unknown response format");
  }

  if (decoded.peers instanceof Uint8Array) {
    return {
      ...decoded,
      peers: readCompactPeers(decoded.peers),
    };
  }

  return {
    ...decoded,
    peers: decoded.peers.map(({ ip, port, ["peer id"]: id }) => ({
      ip: td.decode(ip),
      port,
      id,
    })),
  };
}

function makeUrl(base: string, params: Record<string, string>): string {
  let url = base;
  let prefix = "?";
  for (const [key, value] of Object.entries(params)) {
    url += `${prefix}${key}=${value}`;
    prefix = "&";
  }
  return url;
}

async function announceHttp(
  baseUrl: string,
  info: AnnounceInfo,
): Promise<AnnounceResponse> {
  const url = makeUrl(baseUrl, {
    compact: CompactValue.compact,
    info_hash: encodeBinaryData(info.infoHash),
    peer_id: encodeBinaryData(info.peerId),
    ip: info.ip,
    port: info.port.toString(),
    uploaded: info.uploaded.toString(),
    downloaded: info.downloaded.toString(),
    left: info.left.toString(),
    event: info.event ?? AnnounceEvent.empty,
    numwant: info.numWant?.toString() ?? "50",
  });

  const res = await timedFetch(url);
  return parseHttpAnnounce(new Uint8Array(await res.arrayBuffer()));
}

const NEGATIVE_ONE = 2 ** 32 - 1;

function announceUdp(
  url: string,
  info: AnnounceInfo,
): Promise<AnnounceResponse> {
  const ipParts = info.ip.split(".").map(Number);
  if (ipParts.length !== 4 || ipParts.some((n) => Number.isNaN(n))) {
    throw new Error("Bad peer ip passed to announce");
  }

  const body = new Uint8Array(98);
  writeInt(UdpTrackerAction.announce, body, 4, 8);
  body.set(info.infoHash, 16);
  body.set(info.peerId, 36);
  writeInt(info.downloaded, body, 8, 56);
  writeInt(info.left, body, 8, 64);
  writeInt(info.uploaded, body, 8, 72);
  writeInt(UDP_EVENT_MAP.indexOf(info.event), body, 4, 80);
  body.set(ipParts, 84);
  if (info.key) {
    body.set(info.key, 88);
  }
  // -1 in this context means "give me the default amount"
  writeInt(info.numWant ?? NEGATIVE_ONE, body, 4, 92);
  writeInt(info.port, body, 2, 96);

  return withConnect(url, body, (result) => {
    const action = readInt(result, 4, 0);

    if (
      result.length < UDP_ANNOUNCE_RES_LENGTH ||
      action !== UdpTrackerAction.announce
    ) {
      throw deriveUdpError(action, result);
    }

    const interval = readInt(result, 4, 8);
    const incomplete = readInt(result, 4, 12);
    const complete = readInt(result, 4, 16);
    const peers = readCompactPeers(result.subarray(20));

    if (!peers) {
      throw new Error("unknown peer format");
    }

    return { interval, complete, incomplete, peers };
  });
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
