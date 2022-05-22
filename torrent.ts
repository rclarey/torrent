// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import {
  Deferred,
  deferred,
} from "https://deno.land/std@0.96.0/async/deferred.ts#^";

import { Storage } from "./storage.ts";
import { Metainfo } from "./metainfo.ts";
import { announce } from "./tracker.ts";
import {
  AnnounceEvent,
  AnnounceInfo,
  AnnouncePeer,
  CompactValue,
} from "./types.ts";
import { Peer } from "./peer.ts";
import {
  Connection,
  endReceiveHandshake,
  MsgId,
  readMessage,
  sendBitfield,
  sendHandshake,
  sendPiece,
  startReceiveHandshake,
} from "./protocol.ts";
import { equals } from "./_bytes.ts";
import { validateReceivedBlock, validateRequestedBlock } from "./piece.ts";

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

export class Torrent {
  #announceSignal!: Deferred<void>;
  #announceInfo: AnnounceInfo;

  state = TorrentState.starting;
  metainfo: Metainfo;
  peerId: Uint8Array;
  storage: Storage;
  bitfield: Uint8Array;
  peers = new Map<string, Peer>();

  constructor({ ip, metainfo, peerId, port, storage }: TorrentParams) {
    this.metainfo = metainfo;
    this.peerId = peerId;
    this.storage = storage;
    this.bitfield = new Uint8Array(Math.ceil(metainfo.info.pieces.length / 8));

    this.#announceInfo = {
      infoHash: metainfo.infoHash,
      peerId,
      ip,
      port,
      uploaded: 0,
      downloaded: 0,
      left: metainfo.info.length,
      event: AnnounceEvent.started,
      numWant: 50,
      compact: CompactValue.compact,
      key: crypto.getRandomValues(new Uint8Array(20)),
    };

    this.run();
  }

  addPeer(buffId: Uint8Array, conn: Connection) {
    const id = new TextDecoder().decode(buffId);
    const peer = new Peer({
      id,
      conn,
      metainfo: this.metainfo,
    });
    this.peers.set(id, peer);

    this.handleMessages(peer)
      .catch((e) => {
        console.error(`peer ${peer.id} threw ${e}`);
      })
      .then(() => {
        try {
          peer.conn.close();
        } catch {
          // do nothing
        }
        this.peers.delete(peer.id);
      });

    sendBitfield(conn, this.bitfield);
  }

  requestPeers() {
    this.#announceInfo.numWant = 50;
    this.#announceSignal.resolve();
  }

  private run() {
    // start announcer
    this.doAnnounce();
  }

  private async handleMessages(peer: Peer) {
    while (true) {
      const msg = await readMessage(peer.conn);

      if (!msg) {
        return;
      }

      switch (msg.id) {
        case MsgId.choke: {
          peer.isChoking = true;
          break;
        }

        case MsgId.unchoke: {
          peer.isChoking = false;
          break;
        }

        case MsgId.interested: {
          peer.isInterested = true;
          break;
        }

        case MsgId.uninterested: {
          peer.isInterested = false;
          break;
        }

        case MsgId.have: {
          if (msg.index >= this.metainfo.info.pieces.length) {
            throw new Error(`have message with invalid index ${msg.index}`);
          }
          const byte = msg.index >> 3;
          const bit = msg.index % 8;
          peer.bitfield[byte] |= 128 >> bit;
          break;
        }

        case MsgId.bitfield: {
          peer.bitfield.set(msg.bitfield);
          break;
        }

        case MsgId.request: {
          validateRequestedBlock(this.metainfo.info, msg);
          if (peer.amChoking) {
            // TODO log request from chocked peer. should we drop peer?
            break;
          }
          const block = await this.storage.get(
            msg.index * this.metainfo.info.pieceLength + msg.offset,
            msg.length,
          );
          if (!block) {
            // TODO log request for piece we don't have. should we drop peer?
            break;
          }
          sendPiece(peer.conn, msg.index, msg.offset, block).catch(() => {
            // TODO log error
          });
          break;
        }

        case MsgId.cancel: {
          // TODO
          break;
        }

        case MsgId.piece: {
          validateReceivedBlock(this.metainfo.info, msg);
          const success = await this.storage.set(
            msg.index * this.metainfo.info.pieceLength + msg.offset,
            msg.block,
          );
          if (!success) {
            // TODO log error
          }
          break;
        }
      }
    }
  }

  private handleNewPeers(peers: AnnouncePeer[]) {
    for (const peer of peers) {
      let conn: Deno.Conn;
      (async () => {
        conn = await Deno.connect({ hostname: peer.ip, port: peer.port });
        await sendHandshake(conn, this.metainfo.infoHash, this.peerId);
        const infoHash = await startReceiveHandshake(conn);
        const peerId = await endReceiveHandshake(conn);
        if (
          !equals(infoHash, this.metainfo.infoHash) ||
          (peer.id && !equals(peerId, peer.id))
        ) {
          throw new Error("info hash or peer id does not match expected value");
        }

        this.addPeer(peerId, conn);
      })().catch(() => {
        try {
          conn.close();
        } catch {
          // do nothing
        }
      });
    }
  }

  private async doAnnounce() {
    let interval = 0;
    while (true) {
      try {
        const res = await announce(this.metainfo.announce, this.#announceInfo);
        interval = res.interval;
        this.#announceInfo.numWant = 0;
        this.#announceInfo.event = AnnounceEvent.empty;

        this.handleNewPeers(res.peers);
      } catch {
        // TODO: log error
      }

      this.#announceSignal = deferred();
      const to = setTimeout(this.#announceSignal.resolve, interval * 1000);
      await this.#announceSignal;
      // clear timeout in case announceSignal was resolved early
      clearTimeout(to);
    }
  }
}
