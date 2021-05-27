// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

import { InfoDict } from "./metainfo.ts";
import {
  endReceiveHandshake,
  sendHandshake,
  startReceiveHandshake,
} from "./peer";
import { createFileStorage, Storage } from "./storage.ts";
import { getExternalIpAndMapPort } from "./upnp";

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
  listener: Deno.Listener;

  infoHashes: Set<string> = new Set();

  peerId: Uint8Array;

  externalIp: string | null = null;

  config: Required<ClientConfig>;

  constructor(config: ClientConfig) {
    this.config = Object.assign(defaultClientConfig, config);
    this.peerId = peerIdFromPrefix(this.config.peerId);
  }

  async init() {
    this.listener = Deno.listen({ port: this.config.port });
    // if config.port was 0, then we get a random free port so we should set
    // that to config.port so we can reference it later
    if (this.listener.addr.port !== this.config.port) {
      this.config.port = this.#listener.addr.port;
    }

    // TODO: get internal IP from network interfaces when it is available
    // https://github.com/denoland/deno/issues/8137
    const internalIp = "192.168.0.104";

    // TODO: what to do if this fails?
    this.externalIp = await getExternalIpAndMapPort(
      internalIp,
      this.config.port
    );

    this.acceptConnections();
  }

  private async acceptConnections() {
    for await (const conn of this.listener) {
      try {
        const infoHash = await startReceiveHandshake(conn);
        if (!this.infoHashes.has(infoHash.toString())) {
          conn.close();
          continue;
        }

        await sendHandshake(conn, infoHash, this.peerId);
        const peerId = await endReceiveHandshake(conn);

        // TODO: do something with the new connection
      } catch (e) {
        console.error(e);
        conn.close();
        continue;
      }
    }
  }
}
