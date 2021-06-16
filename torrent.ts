// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

import {
  Deferred,
  deferred,
} from "https://deno.land/std@0.96.0/async/deferred.ts#^";

import { Storage } from "./storage.ts";
import { Metainfo } from "./metainfo.ts";
import { announce } from "./tracker.ts";
import { AnnounceEvent, AnnounceInfo, CompactValue } from "./types.ts";

export interface TorrentParams {
  ip: string;
  metainfo: Metainfo;
  peerId: Uint8Array;
  port: number;
  storage: Storage;
}

const enum TorrentState {
  starting,
  downloading,
  seeding,
}

function totalSize(metainfo: Metainfo): number {
  if ("length" in metainfo.info) {
    return metainfo.info.length;
  }
  return metainfo.info.files.reduce((acc, file) => acc + file.length, 0);
}

export class Torrent {
  #announceSignal!: Deferred<void>;
  #announceInfo: AnnounceInfo;

  state = TorrentState.starting;
  metainfo: Metainfo;
  peerId: Uint8Array;
  storage: Storage;

  constructor({ ip, metainfo, peerId, port, storage }: TorrentParams) {
    this.metainfo = metainfo;
    this.peerId = peerId;
    this.storage = storage;

    this.#announceInfo = {
      infoHash: metainfo.infoHash,
      peerId,
      ip,
      port,
      uploaded: 0,
      downloaded: 0,
      left: totalSize(metainfo),
      event: AnnounceEvent.started,
      numWant: 50,
      compact: CompactValue.compact,
      key: crypto.getRandomValues(new Uint8Array(20)),
    };

    this.doAnnounce();
  }

  private async doAnnounce() {
    let interval = 0;
    while (true) {
      try {
        console.log(this.#announceInfo.event);
        const res = await announce(this.metainfo.announce, this.#announceInfo);
        interval = res.interval;
        this.#announceInfo.numWant = 0;
        this.#announceInfo.event = AnnounceEvent.empty;

        console.log(res);
      } catch {
        // TODO: log error
      }

      this.#announceSignal = deferred();
      const to = setTimeout(
        this.#announceSignal.resolve,
        interval * 1000,
      );
      await this.#announceSignal;
      // clear timeout in case announceSignal was resolved early
      clearTimeout(to);
    }
  }

  async requestPeers() {
    this.#announceInfo.numWant = 50;
    this.#announceSignal.resolve();
  }

  async download(): Promise<void> {}
}
