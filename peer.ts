import { Connection, readMessage } from "./protocol.ts";

export interface PeerParams {
  id: string;
  conn: Connection;
  onDisconnect: (p: Peer) => void;
}

export class Peer {
  #onDisconnect: (p: Peer) => void;

  id: string;
  conn: Connection;

  constructor({ id, conn, onDisconnect }: PeerParams) {
    this.id = id;
    this.conn = conn;
    this.#onDisconnect = onDisconnect;

    this.run();
  }

  private run() {
    this.handleMessages();
  }

  private async handleMessages() {
    while (true) {
      const msg = await readMessage(this.conn);
      if (!msg) {
        this.#onDisconnect(this);
      }
    }
  }
}
