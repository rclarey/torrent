// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import {
  ServerRequest as HttpRequest,
} from "https://deno.land/std@0.52.0/http/mod.ts#^";

import { bencode } from "../bencode.ts";
import {
  ScrapeList,
  UdpTrackerAction,
} from "../types.ts";
import { sendHttpError, sendUdpError } from "./_helpers.ts";
import { spreadUint8Array, writeInt } from "../_bytes.ts";

type ScrapeInfo = {
  complete: number;
  downloaded: number;
  incomplete: number;
};

export abstract class ScrapeRequest {
  /** Requested info hashes */
  infoHashes!: Uint8Array[];
  /** Send aggregate info to the requesting client */
  abstract respond(list: ScrapeList): Promise<void>;
  /** Send a failure response to the requesting client */
  abstract reject(reason: string): Promise<void>;
}

export class HttpScrapeRequest extends ScrapeRequest {
  /**
   * @param httpRequest - The underlying HTTP request
   * @param infoHashes - Requested info hashes
   */
  constructor(
    public httpRequest: HttpRequest,
    public infoHashes: Uint8Array[],
  ) {
    super();
  }

  /** Send aggregate info to the requesting client */
  respond(list: ScrapeList): Promise<void> {
    try {
      const files = new Map<Uint8Array, ScrapeInfo>(
        list.map((
          { infoHash, ...rest },
        ) => [infoHash, rest]),
      );
      const body = bencode({ files });
      return this.httpRequest.respond({ body });
    } catch {
      return this.reject("internal error");
    }
  }

  /** Send a failure response to the requesting client */
  reject(reason: string): Promise<void> {
    return sendHttpError(this.httpRequest, reason);
  }
}

export interface UdpScrapeParams {
  /** Requested info hashes */
  infoHashes: Uint8Array[];
  /** Unique ID used to identify this transaction */
  transactionId: Uint8Array;
  /** Unique ID used to identify a particular client */
  connectionId: Uint8Array;
  /** Address of the requesting client */
  addr: Deno.Addr;
  /** Underlying UDP socket */
  conn: Deno.DatagramConn;
}

export class UdpScrapeRequest extends ScrapeRequest {
  /** Unique ID used to identify this transaction */
  transactionId!: Uint8Array;
  /** Unique ID used to identify a particular client */
  connectionId!: Uint8Array;
  /** Address of the requesting client */
  addr!: Deno.Addr;
  /** Underlying UDP socket */
  conn!: Deno.DatagramConn;

  constructor(params: UdpScrapeParams) {
    super();
    Object.assign(this, params);
  }

  /** Send aggregate info to the requesting client */
  respond(list: ScrapeList): Promise<void> {
    try {
      const body = new Uint8Array(8 + 12 * list.length);

      writeInt(UdpTrackerAction.scrape, body, 4, 0);
      spreadUint8Array(this.transactionId, body, 4);
      let i = 0;
      for (const file of list) {
        writeInt(file.complete, body, 4, 8 + 12 * i);
        writeInt(file.downloaded, body, 4, 12 + 12 * i);
        writeInt(file.incomplete, body, 4, 16 + 12 * i);
        i += 1;
      }

      return this.conn.send(body, this.addr);
    } catch {
      return this.reject("internal error");
    }
  }

  /** Send a failure response to the requesting client */
  reject(reason: string): Promise<void> {
    return sendUdpError(this.conn, this.addr, this.transactionId, reason);
  }
}
