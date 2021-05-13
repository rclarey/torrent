import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.96.0/testing/asserts.ts#^";
import {
  MultiFileInfoDict,
  parseMetaInfo,
  SingleFileInfoDict,
} from "./metainfo.ts";

Deno.test("MetaInfo - parseMetaInfo() - single file", async () => {
  const file = await Deno.readFile("./test_data/singlefile.torrent");
  const metainfo = parseMetaInfo(file);

  assertNotEquals(metainfo, null);
  assertEquals(metainfo!.comment, "comment");
  assertEquals(metainfo!.announce, "http://example.com/announce");
  assertEquals(metainfo!.encoding, "UTF-8");
  assertEquals(
    metainfo!.createdBy,
    "https://github.com/rclarey/torrent/blob/master/tools/make_torrent.ts",
  );
  assertEquals(metainfo!.creationDate, 1602023427);

  const info = metainfo!.info as SingleFileInfoDict;
  assertEquals(info.pieceLength, 262144);
  assertEquals(info.name, "singlefile.txt");
  assertEquals(info.length, 447135744);
  assertEquals(info.pieces.length, 1706);
  assertEquals(info.private, 0);
});

Deno.test("MetaInfo - parseMetaInfo() - multi file", async () => {
  const file = await Deno.readFile("./test_data/multifile.torrent");
  const metainfo = parseMetaInfo(file);

  assertNotEquals(metainfo, null);
  assertEquals(metainfo!.comment, "comment");
  assertEquals(metainfo!.announce, "http://example.com/announce");
  assertEquals(metainfo!.encoding, "UTF-8");
  assertEquals(
    metainfo!.createdBy,
    "https://github.com/rclarey/torrent/blob/master/tools/make_torrent.ts",
  );
  assertEquals(metainfo!.creationDate, 1599690859);

  const info = metainfo!.info as MultiFileInfoDict;
  assertEquals(info.pieceLength, 524288);
  assertEquals(info.name, "multifile");
  assertEquals(info.pieces.length, 1855);
  assertEquals(info.private, 0);
  assertEquals(info.files.length, 2);

  const [file1, file2] = info.files;
  assertEquals(file1.length, 447135744);
  assertEquals(file1.path.join("/"), "file1.txt");
  assertEquals(file2.length, 525148160);
  assertEquals(file2.path.join("/"), "dir/file2.txt");
});

Deno.test("MetaInfo - parseMetaInfo() - minimal fields", async () => {
  const file = await Deno.readFile("./test_data/minimal.torrent");
  const metainfo = parseMetaInfo(file);

  assertNotEquals(metainfo, null);
  assertEquals(metainfo!.comment, undefined);
  assertEquals(metainfo!.announce, "http://example.com/announce");
  assertEquals(metainfo!.encoding, undefined);
  assertEquals(
    metainfo!.createdBy,
    undefined,
  );
  assertEquals(metainfo!.creationDate, undefined);

  const info = metainfo!.info as SingleFileInfoDict;
  assertEquals(info.pieceLength, 262144);
  assertEquals(info.name, "singlefile.txt");
  assertEquals(info.length, 447135744);
  assertEquals(info.pieces.length, 1706);
  // even though this is missing in the .torrent it gets
  // filled with a default value
  assertEquals(info.private, 0);
});

Deno.test("MetaInfo - parseMetaInfo() - extra fields", async () => {
  const file = await Deno.readFile("./test_data/extra.torrent");
  const metainfo = parseMetaInfo(file);

  assertNotEquals(metainfo, null);
  assertEquals(metainfo!.comment, "comment");
  assertEquals(metainfo!.announce, "http://example.com/announce");
  assertEquals(metainfo!.encoding, "UTF-8");
  assertEquals(
    metainfo!.createdBy,
    "https://github.com/rclarey/torrent/blob/master/tools/make_torrent.ts",
  );
  assertEquals(metainfo!.creationDate, 1602024152);

  const info = metainfo!.info as SingleFileInfoDict;
  assertEquals(info.pieceLength, 262144);
  assertEquals(info.name, "singlefile.txt");
  assertEquals(info.length, 447135744);
  assertEquals(info.pieces.length, 1706);
  assertEquals(info.private, 0);
});

Deno.test("MetaInfo - parseMetaInfo() - missing fields", async () => {
  const file = await Deno.readFile("./test_data/missing.torrent");
  const metainfo = parseMetaInfo(file);
  assertEquals(metainfo, null);
});
