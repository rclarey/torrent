// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { Peer } from "../_shared.ts";

export const enum PeerState {
  /** The peer has the whole file */
  seeder = "seeder",
  /** The peer does not have the whole file */
  leecher = "leecher",
}

export interface PeerInfo extends Peer {
  /** Peer's self-selected ID */
  id: Uint8Array;
  /** Whether this peer is a leecher or seeder */
  state: PeerState;
}

export const enum UdpTrackerAction {
  connect = 0,
  announce = 1,
  scrape = 2,
  error = 3,
}
