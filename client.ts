// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import { InfoDict, Metainfo } from "./metainfo.ts";
import {
  endReceiveHandshake,
  sendHandshake,
  startReceiveHandshake,
} from "./protocol.ts";
import { createFileStorage, Storage } from "./storage.ts";
import { getIpAddrsAndMapPort } from "./upnp.ts";
import { Torrent } from "./torrent.ts";

export interface ClientConfig {
  storage?: (info: InfoDict, dir: string) => Storage;
  port?: number;
  peerId?: string;
}

export const defaultClientConfig: Required<ClientConfig> = {
  storage: createFileStorage,
  port: 0,
  peerId: "-DT0000-",
};

function peerIdFromPrefix(prefix: string) {
  const peerId = new Uint8Array(20);
  const encoded = new TextEncoder().encode(prefix);
  peerId.set(encoded);
  crypto.getRandomValues(peerId.subarray(encoded.length));
  return peerId;
}

export class Client {
  listener!: Deno.Listener;

  torrents: Map<string, Torrent> = new Map();

  peerId: Uint8Array;

  internalIp!: string;

  externalIp!: string;

  config: Required<ClientConfig>;

  constructor(config: ClientConfig = {}) {
    this.config = Object.assign(defaultClientConfig, config);
    this.peerId = peerIdFromPrefix(this.config.peerId);

    this.run();
  }

  add(metainfo: Metainfo, dir: string): void {
    const hashStr = metainfo.infoHash.toString();
    if (!this.torrents.has(hashStr)) {
      this.torrents.set(
        hashStr,
        new Torrent({
          ip: this.externalIp,
          metainfo,
          peerId: this.peerId,
          port: this.config.port,
          storage: this.config.storage(metainfo.info, dir),
        }),
      );
    }
  }

  async run() {
    this.listener = Deno.listen({ port: this.config.port });
    const addr = this.listener.addr as Deno.NetAddr;
    // if config.port was 0, then we get a random free port so we should set
    // that to config.port so we can reference it later
    if (addr.port !== this.config.port) {
      this.config.port = addr.port;
    }

    [this.internalIp, this.externalIp] = await getIpAddrsAndMapPort(
      this.config.port,
    );

    this.acceptConnections();
  }

  private async acceptConnections() {
    for await (const conn of this.listener) {
      try {
        const infoHash = await startReceiveHandshake(conn);
        const torrent = this.torrents.get(infoHash.toString());
        if (!torrent) {
          conn.close();
          continue;
        }

        await sendHandshake(conn, infoHash, this.peerId);
        const peerId = await endReceiveHandshake(conn);

        torrent.addPeer(peerId, conn);
      } catch (e) {
        console.error(e);
        conn.close();
      }
    }
  }
}
