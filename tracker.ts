// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { bdecode } from "./bencode.ts";
import {
  AnnounceEvent,
  AnnounceInfo,
  Peer,
  ScrapeList,
} from "./types.ts";

const FETCH_TIMEOUT = 1000 * 10;

/** An error thrown when a fetch request times out */
export class TimeoutError extends Error {
  constructor() {
    super("fetch request timed out");
  }
}

function timedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new TimeoutError()), FETCH_TIMEOUT);
    fetch(
      url,
      { ...init, cache: "no-store" },
    ).then((r) => {
      clearTimeout(to);
      resolve(r);
    });
  });
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

interface AnnounceBody {
  complete: number;
  incomplete: number;
  interval: number;
  peers: Peer[];
}

function validateHttpAnnounce(data: Uint8Array): AnnounceBody {
  const td = new TextDecoder();
  const {
    complete,
    incomplete,
    interval,
    peers,
    ["failure reason"]: reason,
  } = bdecode(data) as any;

  if (
    typeof complete === "number" && typeof incomplete === "number" &&
    typeof interval === "number"
  ) {
    if (peers instanceof Uint8Array && peers.length % 6 === 0) {
      const decodedPeers: Peer[] = [];
      for (let i = 0; i < peers.length; i += 6) {
        decodedPeers.push({
          ip: peers.subarray(i, i + 4).join("."),
          port: (peers[i + 4] << 8) + peers[i + 5],
        });
      }
      return {
        complete,
        incomplete,
        interval,
        peers: decodedPeers,
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

export interface AnnounceResponse {
  /** Number of seconds the client is advised to wait between regular requests */
  interval: number;
  /** List of peers that the client can connect to */
  peers: Peer[];
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

/** Make an announce request to the tracker URL */
export function announce(
  url: string,
  req: AnnounceInfo,
): Promise<AnnounceResponse> {
  const protocol = url.slice(0, url.indexOf("://"));
  switch (protocol) {
    case "http":
    case "https": {
      return announceHttp(url, req);
    }

    case "udp": // TODO
    default:
      throw new Error(`${protocol} is not supported for trackers`);
  }
}
