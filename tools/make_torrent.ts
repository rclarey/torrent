// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { createHash } from "https://deno.land/std@0.95.0/hash/mod.ts#^";

import { bencode } from "../bencode.ts";
import { MultiFileFields } from "../metainfo.ts";
import { readN, spreadUint8Array } from "../_bytes.ts";

let progress: (i: number, total: number) => void = () => {};

// power of 2, where 32kB <= pieceLength <= 1MB
function makePieceFields(size: number): [number, Uint8Array, number] {
  const pieceLength = 2 **
    Math.min(20, Math.max(15, Math.floor(Math.log2(size / 1000))));
  const nPieces = Math.ceil(size / pieceLength);
  const pieceHashes = new Uint8Array(nPieces * 20);
  return [pieceLength, pieceHashes, nPieces];
}

async function collectFiles(
  initialDir: string,
  nParts: number,
): Promise<[MultiFileFields[], number]> {
  const out: MultiFileFields[] = [];
  let size = 0;

  const dirs = [initialDir];
  while (dirs.length !== 0) {
    const dir = dirs.pop()!;
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      const info = await Deno.stat(path);
      if (info.isDirectory) {
        dirs.push(path);
      } else {
        size += info.size;
        out.push({ length: info.size, path: path.split("/").slice(nParts) });
      }
    }
  }

  return [out, size];
}

async function hashMultiFilePieces(
  path: string,
  files: MultiFileFields[],
  size: number,
): Promise<[Uint8Array, number]> {
  const [pieceLength, pieceHashes, nPieces] = makePieceFields(size);
  let content = new Uint8Array(pieceLength);
  let piece = 0;
  let contentOffset = 0;

  progress(0, nPieces);
  for (const file of files) {
    const fd = await Deno.open(`${path}/${file.path.join("/")}`);
    let fileOffset = 0;

    while (fileOffset < file.length) {
      const toRead = content.length - contentOffset;
      const left = file.length - fileOffset;

      if (left < toRead) {
        await readN(
          fd,
          left,
          content.subarray(contentOffset, contentOffset + left),
        );
        contentOffset += left;
        break;
      }

      await readN(fd, toRead, content.subarray(contentOffset));
      const hash = createHash("sha1").update(content).digest();
      spreadUint8Array(new Uint8Array(hash), pieceHashes, 20 * piece);

      progress(piece, nPieces);
      piece += 1;
      fileOffset += toRead;
      contentOffset = 0;

      if (piece === nPieces - 1) {
        content = new Uint8Array(size - (nPieces - 1) * pieceLength);
      }
    }

    fd.close();
  }

  return [pieceHashes, pieceLength];
}

export async function makeTorrent(
  path: string,
  tracker: string,
  comment?: string,
): Promise<Uint8Array> {
  const common = {
    announce: tracker,
    comment,
    "created by":
      "https://github.com/rclarey/torrent/blob/master/tools/make_torrent.ts",
    "creation date": Math.floor(Date.now() / 1000),
    encoding: "UTF-8",
  };
  const parts = path!.split("/");
  const info = await Deno.stat(path);

  if (info.isDirectory) {
    const [files, size] = await collectFiles(path, parts.length);
    const [pieces, pieceLength] = await hashMultiFilePieces(path, files, size);

    return bencode({
      ...common,
      info: {
        files: files as { path: string[]; length: number }[],
        name: parts[parts.length - 1],
        "piece length": pieceLength,
        pieces,
        private: 0,
      },
    });
  }

  const [pieceLength, pieceHashes, nPieces] = makePieceFields(info.size);
  const fd = await Deno.open(path, { read: true });

  for (let i = 0; i < nPieces - 1; i += 1) {
    progress(i, nPieces);
    const toRead = Math.min(pieceLength, info.size - pieceLength * i);
    const content = await readN(fd, toRead);
    const hash = createHash("sha1").update(content).digest();
    spreadUint8Array(new Uint8Array(hash), pieceHashes, 20 * i);
  }
  // last piece might not be the full size
  progress(nPieces - 1, nPieces);
  const toRead = info.size - (nPieces - 1) * pieceLength;
  const content = await readN(fd, toRead);
  const hash = createHash("sha1").update(content).digest();
  spreadUint8Array(new Uint8Array(hash), pieceHashes, 20 * (nPieces - 1));

  fd.close();

  return bencode({
    ...common,
    info: {
      length: info.size,
      name: parts[parts.length - 1],
      "piece length": pieceLength,
      pieces: pieceHashes,
      private: 0,
    },
  });
}

function help() {
  console.log(`
make_torrent
make a .torrent file for a given file or directory of files

USAGE:
\tmake_torrent [-c <comment>] -t <tracker url> <target>

OPTIONS:
\t--help\t\tPrints this message
\t-c <comment>\tAdd the provided comment to the .torrent file
`);
}

if (import.meta.main) {
  const nArgs = Deno.args.length;

  if (nArgs !== 3 && nArgs !== 5) {
    help();
    Deno.exit();
  }

  let path: string;
  let tracker: string;
  let comment: string | undefined;

  for (let i = 0; i < nArgs;) {
    const arg = Deno.args[i];
    if (arg === "-c") {
      if (nArgs !== 5) {
        help();
        Deno.exit();
      }
      comment = Deno.args[i + 1];
      i += 2;
    } else if (arg === "-t") {
      if (nArgs < 3) {
        help();
        Deno.exit();
      }
      tracker = Deno.args[i + 1];
      i += 2;
    } else if (i !== nArgs - 1) {
      help();
      Deno.exit();
    } else {
      try {
        await Deno.stat(arg);
        path = arg;
        i += 1;
      } catch {
        console.log(`file "${arg}" does not exist`);
        help();
        Deno.exit();
      }
    }
  }

  const te = new TextEncoder();
  progress = (n, total) =>
    Deno.stdout.write(
      te.encode(`\rcomputing hash for piece ${n + 1} / ${total}`),
    );
  const parts = path!.split("/");
  const name = parts[parts.length - 1];

  console.log(`making .torrent file for ${name}`);
  const data = await makeTorrent(path!, tracker!, comment);
  const outfile = await Deno.open(
    `${name}.torrent`,
    { create: true, write: true },
  );
  await Deno.writeAll(outfile, data);
  outfile.close();
  console.log(`\noutput -> ${name}.torrent`);
}
