// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

import { InfoDict } from "./metainfo.ts";
import { createFileStorage, Storage } from "./storage.ts";

export interface ClientConfig {
  storage?: (info: InfoDict, dir: string) => Storage;
  port?: number;
}

export const defaultClientConfig: Required<ClientConfig> = {
  storage: createFileStorage,
  port: 0,
};

export class Client {
  #listener: Deno.Listener;

  config: Required<ClientConfig>;

  constructor(config: ClientConfig) {
    this.config = Object.assign(defaultClientConfig, config);

    this.#listener = Deno.listen({ port: this.config.port });
    // if config.port was 0, then we get a random free port so we should set
    // that to config.port so we can reference it later
    if (this.#listener.addr.port !== this.config.port) {
      this.config.port = this.#listener.addr.port;
    }

    // TODO: NAT traversal

    // TODO: accept incoming connections
  }
}
