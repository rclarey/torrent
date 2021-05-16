// Copyright (C) 2021 Russell Clarey. All rights reserved. MIT license.

import { Storage } from "./storage.ts";

export interface TorrentParams {
  storage: Storage;
}

const enum TorrentState {
  starting,
  downloading,
  seeding,
}

export class Torrent {
  state = TorrentState.starting;

  constructor({}: TorrentParams) {
  }

  async requestPeers() {
  }

  async download(): Promise<void> {
  }
}
