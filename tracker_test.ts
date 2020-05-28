import { assertEquals } from "https://deno.land/std@0.51.0/testing/asserts.ts";
import { serve } from "https://deno.land/std@0.51.0/http/mod.ts";

import { announce } from "./tracker.ts";

Deno.test("announce (http)", async () => {
  async function mockServer() {
    const te = new TextEncoder();
    const s = serve({ port: 3000 });
    const { value: req } = await s[Symbol.asyncIterator]().next();
    assertEquals(
      req.url,
      "/?compact=0&info_hash=abcdefghijklmnopqrst&peer_id=ABCDEFGHIJKLMNOPQRST&ip=192.168.0.30&port=6883&uploaded=1&downloaded=2&left=3&event=empty",
    );
    await req.respond({
      body: te.encode(
        "d" +
          "8:interval" +
          "i900e" +
          "5:peers" +
          "l" +
          "d" +
          "4:port" +
          "i6881e" +
          "2:ip" +
          "12:192.168.0.42" +
          "2:id" +
          "20:abcdefghijklmnopqrst" +
          "e" +
          "e" +
          "e",
      ),
    });
    s.close();
  }
  mockServer();
  const res = await announce("http://127.0.0.1:3000", {
    infoHash: new Uint8Array(20).map((_, i) => 97 + i),
    peerId: new Uint8Array(20).map((_, i) => 65 + i),
    ip: "192.168.0.30",
    port: 6883,
    uploaded: 1n,
    downloaded: 2n,
    left: 3n,
  });
  assertEquals(res, {
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
