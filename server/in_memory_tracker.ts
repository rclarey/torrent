// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { AnnounceRequest } from "./announce.ts";
import { ScrapeRequest } from "./scrape.ts";
import {
  ServerOptions,
  serveTracker,
} from "./tracker.ts";
import { PeerInfo as BasePeerInfo, PeerState } from "./_shared.ts";
import { AnnounceEvent, ScrapeList } from "../_shared.ts";

const CLEANUP_INTERVAL = 1000 * 60 * 15;

interface PeerInfo extends BasePeerInfo {
  /** The last time this peer sent an announce request */
  lastUpdated: number;
}

function evaluateState(req: AnnounceRequest): PeerState {
  if (req.event === AnnounceEvent.completed || req.left === 0n) {
    return PeerState.seeder;
  }
  return PeerState.leecher;
}

function randomSelection(peers: Map<string, PeerInfo>, n: number): PeerInfo[] {
  if (peers.size <= n) {
    return [...peers.values()];
  }

  const keys = [...peers.keys()];
  const picked = new Set<string>();
  const out: PeerInfo[] = [];
  while (n > 0) {
    const key = keys[(Math.random() * keys.length) | 0];
    if (!picked.has(key)) {
      picked.add(key);
      out.push(peers.get(key)!);
      n -= 1;
    }
  }
  return out;
}

interface FileInfo {
  infoHash: Uint8Array;
  complete: number;
  downloaded: number;
  incomplete: number;
  peers: Map<string, PeerInfo>;
}

async function sweepAndDelete(
  allFiles: Map<string, FileInfo>,
): Promise<void> {
  for (const fileInfo of allFiles.values()) {
    for (const [id, peer] of fileInfo.peers.entries()) {
      if (Date.now() - peer.lastUpdated > CLEANUP_INTERVAL) {
        fileInfo.peers.delete(id);
        if (peer.state === PeerState.seeder) {
          fileInfo.complete -= 1;
        } else {
          fileInfo.incomplete -= 1;
        }
      }
    }

    // preempt ourselves so we don't block the thread
    await Promise.resolve();
  }
}

function handleAnnounce(
  req: AnnounceRequest,
  infoMap: Map<string, FileInfo>,
): Promise<void> {
  const strInfoHash = req.infoHash.toString();
  let fileInfo = infoMap.get(strInfoHash);
  if (!fileInfo) {
    fileInfo = {
      infoHash: req.infoHash,
      complete: 0,
      downloaded: 0,
      incomplete: 0,
      peers: new Map<string, PeerInfo>(),
    };
    infoMap.set(strInfoHash, fileInfo);
  }

  const strPeerId = `${req.ip}:${req.port}`;
  let requester = fileInfo.peers.get(strPeerId);
  if (!requester) {
    const state = evaluateState(req);
    requester = {
      id: req.peerId,
      ip: req.ip,
      lastUpdated: Date.now(),
      port: req.port,
      state,
    };
    fileInfo.peers.set(strPeerId, requester);
    if (state === PeerState.leecher) {
      fileInfo.incomplete += 1;
    } else {
      fileInfo.complete += 1;
    }
  } else {
    const newState = evaluateState(req);
    if (
      requester.state === PeerState.leecher && newState === PeerState.seeder
    ) {
      fileInfo.incomplete -= 1;
      fileInfo.complete += 1;
      fileInfo.downloaded += 1;
    }
    requester.lastUpdated = Date.now();
    requester.state = newState;
  }

  // gracefully remove client
  if (req.event === AnnounceEvent.stopped) {
    const peer = fileInfo.peers.get(strPeerId);
    if (peer) {
      fileInfo.peers.delete(strPeerId);
      if (peer.state === PeerState.seeder) {
        fileInfo.complete -= 1;
      } else {
        fileInfo.incomplete -= 1;
      }
    }

    return req.respond([]);
  }

  return req.respond(randomSelection(fileInfo.peers, req.numWant));
}

function handleScrape(
  req: ScrapeRequest,
  infoMap: Map<string, FileInfo>,
): Promise<void> {
  let hashes = req.infoHashes.map((hash) => hash.toString());
  if (hashes.length === 0) {
    hashes = [...infoMap.keys()];
  }

  const list: ScrapeList = [];
  for (const hash of hashes) {
    const info = infoMap.get(hash);
    if (!info) {
      return req.reject("invalid info_hash");
    }
    const { peers: _, ...rest } = info;
    list.push(rest);
  }
  return req.respond(list);
}

/** Initialize and run a tracker */
export async function runTracker(opts?: ServerOptions): Promise<void> {
  const server = serveTracker(opts);
  const infoMap = new Map<string, FileInfo>();

  // sweep and remove "dead" clients
  setInterval(() => sweepAndDelete(infoMap), CLEANUP_INTERVAL); // 15min

  for await (const req of server) {
    if (req instanceof AnnounceRequest) {
      console.log("got announce");
      handleAnnounce(req, infoMap);
    } else if (req instanceof ScrapeRequest) {
      console.log("got scrape");
      handleScrape(req, infoMap);
    }
  }
}

if (import.meta.main) {
  console.log("Serving tracker ⚡\n- HTTP on port 80\n- UDP on port 6969");
  runTracker({ udp: false });
}
