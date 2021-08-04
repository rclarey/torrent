// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

import { writeAll } from "https://deno.land/std@0.96.0/io/util.ts#^";
import { basename, join, relative, sep } from 'https://deno.land/x/std@0.98.0/path/mod.ts#^'

import { bencode } from "../bencode.ts";
import { MultiFileFields } from "../metainfo.ts";
import { readN } from "../_bytes.ts";

let progress: (i: number, total: number) => void = () => {};

// power of 2, where 32kB <= pieceLength <= 1MB
function makePieceFields(size: number) {
  const pieceLength = 2 **
    Math.min(20, Math.max(15, Math.floor(Math.log2(size / 1000))));
  const nPieces = Math.ceil(size / pieceLength);
  const pieceHashes = new Uint8Array(nPieces * 20);

  return {
    pieceLength,
    pieceHashes,
    nPieces,
    hashAndStore: async (content: Uint8Array, i: number) => {
      const hash = await crypto.subtle.digest("SHA-1", content);
      pieceHashes.set(new Uint8Array(hash), 20 * i);
    },
  };
}

async function collectFiles(
  initialDir: string,
): Promise<[MultiFileFields[], number]> {
  const out: MultiFileFields[] = [];
  let size = 0;

  const dirs = [initialDir];
  while (dirs.length !== 0) {
    const dir = dirs.pop()!;
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      const info = await Deno.stat(path);
      if (info.isDirectory) {
        dirs.push(path);
      } else {
        size += info.size;
        out.push({ length: info.size, path: relative(initialDir, path).split(sep), });
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
  const { pieceLength, pieceHashes, nPieces, hashAndStore } = makePieceFields(
    size,
  );
  console.log("using piece length", pieceLength);
  let content = new Uint8Array(pieceLength);
  let piece = 0;
  let contentOffset = 0;

  progress(0, nPieces);
  const ps = new Array<Promise<void>>(nPieces);
  for (const file of files) {
    const fd = await Deno.open(join(path, ...file.path));
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
      ps[piece] = hashAndStore(content, piece);

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

  await Promise.all(ps);
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
  const name = basename(path);
  const info = await Deno.stat(path);

  if (info.isDirectory) {
    const [files, size] = await collectFiles(path);
    const [pieces, pieceLength] = await hashMultiFilePieces(path, files, size);

    return bencode({
      ...common,
      info: {
        files: files as { path: string[]; length: number }[],
        name,
        "piece length": pieceLength,
        pieces,
        private: 0,
      },
    });
  }

  const { pieceLength, pieceHashes, nPieces, hashAndStore } = makePieceFields(
    info.size,
  );
  console.log("using piece length", pieceLength);
  const fd = await Deno.open(path, { read: true });

  const ps = new Array<Promise<void>>(nPieces);
  for (let i = 0; i < nPieces; i += 1) {
    progress(i, nPieces);
    const toRead = Math.min(pieceLength, info.size - pieceLength * i);
    const content = await readN(fd, toRead);
    ps[i] = hashAndStore(content, i);
  }

  fd.close();
  await Promise.all(ps);

  return bencode({
    ...common,
    info: {
      length: info.size,
      name,
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
  const name = basename(path!);

  console.log(`making .torrent file for ${name}`);
  const data = await makeTorrent(path!, tracker!, comment);
  const outfile = await Deno.open(`${name}.torrent`, {
    create: true,
    write: true,
  });
  await writeAll(outfile, data);
  outfile.close();
  console.log(`\noutput -> ${name}.torrent`);
}
