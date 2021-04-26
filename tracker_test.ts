import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.95.0/testing/asserts.ts#^";
import { serve } from "https://deno.land/std@0.95.0/http/mod.ts#^";

import { announce, scrape } from "./tracker.ts";
import { AnnounceEvent, UdpTrackerAction } from "./types.ts";
import { spreadUint8Array, writeInt } from "./_bytes.ts";

async function httpAnnounceFullServer() {
  const te = new TextEncoder();
  const s = serve("127.0.0.1:3000");
  const { value: req } = await s[Symbol.asyncIterator]().next();
  assertEquals(
    req.url,
    "/?compact=1&info_hash=abcdefghijklmnopqrst&peer_id=ABCDEFGHIJKLMNOPQRST&ip=192.168.0.30&port=6883&uploaded=1&downloaded=2&left=3&event=empty&numwant=50",
  );
  await req.respond({
    body: te.encode(
      "d" +
        "8:complete" +
        "i0e" +
        "10:incomplete" +
        "i1e" +
        "8:interval" +
        "i900e" +
        "5:peers" +
        "l" +
        "d" +
        "4:port" +
        "i6881e" +
        "2:ip" +
        "12:192.168.0.42" +
        "7:peer id" +
        "20:abcdefghijklmnopqrst" +
        "e" +
        "e" +
        "e",
    ),
  });
  s.close();
}
async function httpAnnounceCompactServer() {
  const te = new TextEncoder();
  const s = serve("127.0.0.1:3000");
  const { value: req } = await s[Symbol.asyncIterator]().next();
  assertEquals(
    req.url,
    "/?compact=1&info_hash=abcdefghijklmnopqrst&peer_id=ABCDEFGHIJKLMNOPQRST&ip=192.168.0.30&port=6883&uploaded=1&downloaded=2&left=3&event=empty&numwant=50",
  );
  await req.respond({
    body: Uint8Array.from([
      ...te.encode(
        "d" +
          "8:complete" +
          "i0e" +
          "10:incomplete" +
          "i1e" +
          "8:interval" +
          "i900e" +
          "5:peers" +
          "6:",
      ),
      ...[192, 168, 0, 42, (8080 / 256) | 0, 8080 % 256],
      ...te.encode("e"),
    ]),
  });
  s.close();
}

async function httpScrapeServer() {
  const te = new TextEncoder();
  const s = serve("127.0.0.1:3000");
  const { value: req } = await s[Symbol.asyncIterator]().next();
  assertEquals(req.url, "/scrape?info_hash=abcdefghijklmnopqrst");
  await req.respond({
    body: te.encode(
      "d" +
        "5:files" +
        "d" +
        "20:abcdefghijklmnopqrst" +
        "d" +
        "8:complete" +
        "i4e" +
        "10:downloaded" +
        "i5e" +
        "10:incomplete" +
        "i6e" +
        "e" +
        "e" +
        "e",
    ),
  });
  s.close();
}

async function httpMalformedServer() {
  const te = new TextEncoder();
  const s = serve("127.0.0.1:3000");
  const { value: req } = await s[Symbol.asyncIterator]().next();
  await req.respond({
    body: te.encode("Not Found"),
  });
  s.close();
}

async function httpFailureServer() {
  const te = new TextEncoder();
  const s = serve("127.0.0.1:3000");
  const { value: req } = await s[Symbol.asyncIterator]().next();
  await req.respond({
    body: te.encode("d14:failure reason18:something happenede"),
  });
  s.close();
}

async function udpAnnounceServer() {
  const conn = Deno.listenDatagram({ port: 3000, transport: "udp" });

  const [connectReq, clientAddr1] = await conn.receive();
  const connectRes = new Uint8Array(16);
  spreadUint8Array(connectReq.subarray(12, 16), connectRes, 4);
  crypto.getRandomValues(connectRes.subarray(8, 16));
  await conn.send(connectRes, clientAddr1);

  const [announceReq, clientAddr2] = await conn.receive();
  const announceRes = new Uint8Array(26);
  writeInt(UdpTrackerAction.announce, announceRes, 4, 0);
  spreadUint8Array(announceReq.subarray(12, 16), announceRes, 4);
  writeInt(900, announceRes, 4, 8); // interval
  writeInt(1, announceRes, 4, 12); // incomplete
  writeInt(0, announceRes, 4, 16); // complete
  spreadUint8Array([192, 168, 0, 42], announceRes, 20); // IP
  writeInt(8080, announceRes, 2, 24); // port
  await conn.send(announceRes, clientAddr2);
  conn.close();
}

async function udpScrapeServer() {
  const conn = Deno.listenDatagram({ port: 3000, transport: "udp" });

  const [connectReq, clientAddr1] = await conn.receive();
  const connectRes = new Uint8Array(16);
  spreadUint8Array(connectReq.subarray(12, 16), connectRes, 4);
  crypto.getRandomValues(connectRes.subarray(8, 16));
  await conn.send(connectRes, clientAddr1);

  const [scrapeReq, clientAddr2] = await conn.receive();
  const scrapeRes = new Uint8Array(26);
  writeInt(UdpTrackerAction.scrape, scrapeRes, 4, 0);
  spreadUint8Array(scrapeReq.subarray(12, 16), scrapeRes, 4);
  writeInt(4, scrapeRes, 4, 8); // complete
  writeInt(5, scrapeRes, 4, 12); // downloaded
  writeInt(6, scrapeRes, 4, 16); // incomplete
  await conn.send(scrapeRes, clientAddr2);
  conn.close();
}

async function udpMalformedServer() {
  const conn = Deno.listenDatagram({ port: 3000, transport: "udp" });

  const [connectReq, clientAddr1] = await conn.receive();
  const connectRes = new Uint8Array(16);
  spreadUint8Array(connectReq.subarray(12, 16), connectRes, 4);
  crypto.getRandomValues(connectRes.subarray(8, 16));
  await conn.send(connectRes, clientAddr1);

  const [req, clientAddr2] = await conn.receive();
  const res = new Uint8Array(100);
  writeInt(17, res, 4, 0); // invalid action
  spreadUint8Array(req.subarray(12, 16), res, 4);
  await conn.send(res, clientAddr2);
  conn.close();
}

async function udpFailureServer() {
  const conn = Deno.listenDatagram({ port: 3000, transport: "udp" });

  const [connectReq, clientAddr1] = await conn.receive();
  const connectRes = new Uint8Array(16);
  spreadUint8Array(connectReq.subarray(12, 16), connectRes, 4);
  crypto.getRandomValues(connectRes.subarray(8, 16));
  await conn.send(connectRes, clientAddr1);

  const [req, clientAddr2] = await conn.receive();
  const res = new Uint8Array(26);
  writeInt(UdpTrackerAction.error, res, 4, 0);
  spreadUint8Array(req.subarray(12, 16), res, 4);
  spreadUint8Array(new TextEncoder().encode("something happened"), res, 8);
  await conn.send(res, clientAddr2);
  conn.close();
}

Deno.test("HTTP Tracker - announce() - full", async () => {
  const s = httpAnnounceFullServer();

  const res = await announce("http://127.0.0.1:3000", {
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
  await s;
});

Deno.test("HTTP Tracker - announce() - compact", async () => {
  const s = httpAnnounceCompactServer();

  const res = await announce("http://127.0.0.1:3000", {
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
  await s;
});

Deno.test("HTTP Tracker - announce() - bad response", async () => {
  const s = httpMalformedServer();

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
  await s;
});

Deno.test("HTTP Tracker - announce() - failure reason", async () => {
  const s = httpFailureServer();

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

  await assertThrowsAsync(
    doAnnounce,
    Error,
    "tracker sent error: something happened",
  );
  await s;
});

Deno.test("HTTP Tracker - scrape() - ok", async () => {
  const s = httpScrapeServer();

  const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
  const res = await scrape("http://127.0.0.1:3000/announce", [infoHash]);
  assertEquals(res, [
    {
      infoHash,
      complete: 4,
      downloaded: 5,
      incomplete: 6,
    },
  ]);
  await s;
});

Deno.test("HTTP Tracker - scrape() - cannot derive URL", async () => {
  const doScrape = async () => {
    const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
    await scrape("http://127.0.0.1:3000/notannounce", [infoHash]);
  };

  await assertThrowsAsync(doScrape, Error, "Cannot derive scrape URL");
});

Deno.test("HTTP Tracker - scrape() - bad response", async () => {
  const s = httpMalformedServer();

  const doScrape = async () => {
    const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
    await scrape("http://127.0.0.1:3000/announce", [infoHash]);
  };

  await assertThrowsAsync(doScrape, Error, "unknown response format");
  await s;
});

Deno.test("HTTP Tracker - scrape() - failure reason", async () => {
  const s = httpFailureServer();

  const doScrape = async () => {
    const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
    await scrape("http://127.0.0.1:3000/announce", [infoHash]);
  };

  await assertThrowsAsync(
    doScrape,
    Error,
    "tracker sent error: something happened",
  );
  await s;
});

Deno.test("UDP Tracker - announce() - ok", async () => {
  const s = udpAnnounceServer();

  const res = await announce("udp://127.0.0.1:3000", {
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
  await s;
});

Deno.test("UDP Tracker - announce() - bad response", async () => {
  const s = udpMalformedServer();

  const doAnnounce = async () => {
    await announce("udp://127.0.0.1:3000", {
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
  await s;
});

Deno.test("UDP Tracker - announce() - failure reason", async () => {
  const s = udpFailureServer();

  const doAnnounce = async () => {
    await announce("udp://127.0.0.1:3000", {
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

  await assertThrowsAsync(
    doAnnounce,
    Error,
    "tracker sent error: something happened",
  );
  await s;
});

Deno.test("UDP Tracker - scrape() - ok", async () => {
  const s = udpScrapeServer();

  const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
  const res = await scrape("udp://127.0.0.1:3000", [infoHash]);
  assertEquals(res, [
    {
      infoHash,
      complete: 4,
      downloaded: 5,
      incomplete: 6,
    },
  ]);
  await s;
});

Deno.test("UDP Tracker - scrape() - bad response", async () => {
  const s = udpMalformedServer();

  const doScrape = async () => {
    const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
    await scrape("udp://127.0.0.1:3000", [infoHash]);
  };

  await assertThrowsAsync(doScrape, Error, "unknown response format");
  await s;
});

Deno.test("UDP Tracker - scrape() - failure reason", async () => {
  const s = udpFailureServer();

  const doScrape = async () => {
    const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
    await scrape("udp://127.0.0.1:3000", [infoHash]);
  };

  await assertThrowsAsync(
    doScrape,
    Error,
    "tracker sent error: something happened",
  );
  await s;
});

Deno.test("Unknown Tracker - scrape()", async () => {
  const doScrape = async () => {
    const infoHash = new Uint8Array(20).map((_, i) => 97 + i);
    await scrape("ftp://127.0.0.1:3000", [infoHash]);
  };

  await assertThrowsAsync(doScrape, Error, "ftp is not supported");
});

Deno.test("Unknown Tracker - announce()", async () => {
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
