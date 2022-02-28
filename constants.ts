// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

export const ANNOUNCE_DEFAULT_WANT = 50;
export const ANNOUNCE_DEFAULT_INTERVAL = 600; // 10min

export const UDP_ANNOUNCE_REQ_LENGTH = 98;
export const UDP_SCRAPE_REQ_LENGTH = 16;

export const UDP_ANNOUNCE_RES_LENGTH = 20;
export const UDP_SCRAPE_RES_LENGTH = 8;

export const UDP_CONNECT_LENGTH = 16;
export const UDP_ERROR_LENGTH = 9;
export const UDP_MAX_ATTEMPTS = 8;
// deno-fmt-ignore
export const UDP_CONNECT_MAGIC = Uint8Array.from([0, 0, 0, 23, 39, 16, 25, 128]);

export const FETCH_TIMEOUT = 1000 * 10;
