import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.52.0/testing/asserts.ts#^";
import { serve } from "https://deno.land/std@0.52.0/http/mod.ts#^";

import { announce, scrape } from "./tracker.ts";
import { AnnounceEvent } from "./types.ts";

Deno.test("announce (HTTP) - full", async () => {
  async function mockServer() {
    const te = new TextEncoder();
    const s = serve("127.0.0.1:3000");
    const { value: req } = await s[Symbol.asyncIterator]().next();
    assertEquals(
      req.url,
      "/announce?compact=1&info_hash=abcdefghijklmnopqrst&peer_id=ABCDEFGHIJKLMNOPQRST&ip=192.168.0.30&port=6883&uploaded=1&downloaded=2&left=3&event=empty&numwant=50",
    );
    await req.respond({
      body: te.encode(
        "d" +
          "8:complete" + "i0e" +
          "10:incomplete" + "i1e" +
          "8:interval" + "i900e" +
          "5:peers" + "l" +
          "d" +
          "4:port" + "i6881e" +
          "2:ip" + "12:192.168.0.42" +
          "7:peer id" + "20:abcdefghijklmnopqrst" +
          "e" +
          "e" +
          "e",
      ),
    });
    s.close();
  }
  mockServer();

  const res = await announce("http://127.0.0.1:3000/announce", {
    infoHash: new Uint8Array(20).map((_, i) => 97 + i),
    peerId: new Uint8Array(20).map((_, i) => 65 + i),
    ip: "192.168.0.30",
    port: 6883,
    uploaded: 1n,
    downloaded: 2n,
    left: 3n,
    event: AnnounceEvent.empty,
  });
  assertEquals(res, {
    complete: 0,
    incomplete: 1,
    interval: 900,
    peers: [
      {
        port: 6881,
        ip: "192.168.0.42",
        id: new Uint8Array(20).map((_, i) => 97 + i),
      },
    ],
  });
});

Deno.test("announce (HTTP) - compact", async () => {
  async function mockServer() {
    const te = new TextEncoder();
    const s = serve("127.0.0.1:3000");
    const { value: req } = await s[Symbol.asyncIterator]().next();
    assertEquals(
      req.url,
      "/announce?compact=1&info_hash=abcdefghijklmnopqrst&peer_id=ABCDEFGHIJKLMNOPQRST&ip=192.168.0.30&port=6883&uploaded=1&downloaded=2&left=3&event=empty&numwant=50",
    );
    await req.respond({
      body: Uint8Array.from([
        ...te.encode(
          "d" +
            "8:complete" + "i0e" +
            "10:incomplete" + "i1e" +
            "8:interval" + "i900e" +
            "5:peers" + "6:",
        ),
        ...[192, 168, 0, 42, (8080 / 256) | 0, 8080 % 256],
        ...te.encode("e"),
      ]),
    });
    s.close();
  }
  mockServer();

  const res = await announce("http://127.0.0.1:3000/announce", {
    infoHash: new Uint8Array(20).map((_, i) => 97 + i),
    peerId: new Uint8Array(20).map((_, i) => 65 + i),
    ip: "192.168.0.30",
    port: 6883,
    uploaded: 1n,
    downloaded: 2n,
    left: 3n,
    event: AnnounceEvent.empty,
  });
  assertEquals(res, {
    complete: 0,
    incomplete: 1,
    interval: 900,
    peers: [
      {
        port: 8080,
        ip: "192.168.0.42",
      },
    ],
  });
});

Deno.test("announce (HTTP) - bad response", async () => {
  async function mockServer() {
    const te = new TextEncoder();
    const s = serve("127.0.0.1:3000");
    const { value: req } = await s[Symbol.asyncIterator]().next();
    await req.respond({
      body: te.encode("Not Found"),
    });
    s.close();
  }
  mockServer();

  const doAnnounce = async () => {
    await announce("http://127.0.0.1:3000", {
      infoHash: new Uint8Array(20).map((_, i) => 97 + i),
      peerId: new Uint8Array(20).map((_, i) => 65 + i),
      ip: "192.168.0.30",
      port: 6883,
      uploaded: 1n,
      downloaded: 2n,
      left: 3n,
      event: AnnounceEvent.empty,
    });
  };

  await assertThrowsAsync(doAnnounce, Error, "unknown response format");
});

Deno.test("announce (HTTP) - failure reason", async () => {
  async function mockServer() {
    const te = new TextEncoder();
    const s = serve("127.0.0.1:3000");
    const { value: req } = await s[Symbol.asyncIterator]().next();
    await req.respond({
      body: te.encode("d14:failure reason18:something happenede"),
    });
    s.close();
  }
  mockServer();

  const doAnnounce = async () => {
    await announce("http://127.0.0.1:3000", {
      infoHash: new Uint8Array(20).map((_, i) => 97 + i),
      peerId: new Uint8Array(20).map((_, i) => 65 + i),
      ip: "192.168.0.30",
      port: 6883,
      uploaded: 1n,
      downloaded: 2n,
      left: 3n,
      event: AnnounceEvent.empty,
    });
  };

  await assertThrowsAsync(doAnnounce, Error, "failed: something happened");
});

Deno.test("announce (unknown)", async () => {
  const doAnnounce = async () => {
    await announce("ftp://127.0.0.1:3000", {
      infoHash: new Uint8Array(20).map((_, i) => 97 + i),
      peerId: new Uint8Array(20).map((_, i) => 65 + i),
      ip: "192.168.0.30",
      port: 6883,
      uploaded: 1n,
      downloaded: 2n,
      left: 3n,
      event: AnnounceEvent.empty,
    });
  };

  await assertThrowsAsync(doAnnounce, Error, "ftp is not supported");
});

Deno.test("scrape (HTTP)", async () => {
  async function mockServer() {
    const te = new TextEncoder();
    const s = serve("127.0.0.1:3000");
    const { value: req } = await s[Symbol.asyncIterator]().next();
    assertEquals(
      req.url,
      "/scrape?info_hash=abcdefghijklmnopqrst",
    );
    await req.respond({
      body: te.encode(
        "d" +
          "5:files" + "d" +
          "20:abcdefghijklmnopqrst" + "d" +
          "8:complete" + "i4e" +
          "10:downloaded" + "i5e" +
          "10:incomplete" + "i6e" +
          "e" +
          "e" +
          "e",
      ),
    });
    s.close();
  }
  mockServer();

  const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
  const res = await scrape("http://127.0.0.1:3000/announce", [infoHash]);
  assertEquals(res, [{
    infoHash,
    complete: 4,
    downloaded: 5,
    incomplete: 6,
  }]);
});
