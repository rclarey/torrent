// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import {
  dirname,
  join,
  relative,
  SEP,
} from "https://deno.land/std@0.96.0/path/mod.ts#^";
import { writeAll } from "https://deno.land/std@0.96.0/io/util.ts#^";

import type { InfoDict } from "./metainfo.ts";
import { readN } from "./_bytes.ts";

/** A method of persisting the downloaded files, e.g. on the local filesystem */
export interface StorageMethod {
  get(
    path: string[],
    offset: number,
    length: number,
  ): Promise<Uint8Array | null>;
  /** return value indicates whether the call was successful or not */
  set(path: string[], offset: number, bytes: Uint8Array): Promise<boolean>;
  /** returns whether or not the file already exists */
  exists(path: string[]): Promise<boolean>;
}

export const BLOCK_SIZE = 1024 * 16;

const OPEN_OPTIONS = {
  read: true,
  write: true,
  create: true,
};

export class Storage {
  #method: StorageMethod;
  #info: InfoDict;
  #dirPath: string[];

  #written: boolean[] = [];

  constructor(method: StorageMethod, info: InfoDict, dirPath: string) {
    this.#method = method;
    this.#info = info;
    this.#dirPath = relative(Deno.cwd(), dirPath).split(SEP);
    if (this.#dirPath[0] === "") {
      this.#dirPath = this.#dirPath.slice(1);
    }
  }

  async get(offset: number, length: number): Promise<Uint8Array | null> {
    this.checkIfValidBlock(offset, length);

    const bytes = new Uint8Array(length);
    const success = await this.findAndDo(
      offset,
      bytes,
      async (path, fileOffset, slice) => {
        const got = await this.#method.get(path, fileOffset, slice.length);
        if (got) {
          slice.set(got);
        }
        return !!got;
      },
    );

    return success ? bytes : null;
  }

  async set(offset: number, bytes: Uint8Array): Promise<boolean> {
    this.checkIfValidBlock(offset, bytes.length);

    const index = offset / BLOCK_SIZE;
    if (this.#written[index]) {
      // TODO log error

      // return true because it signals that this block is set successfully (since it already was set)
      return true;
    }

    const success = await this.findAndDo(
      offset,
      bytes,
      (path, fileOffset, slice) => this.#method.set(path, fileOffset, slice),
    );

    if (success) {
      this.#written[index] = true;
    }

    return success;
  }

  private checkIfValidBlock(offset: number, length: number): void {
    if (offset % BLOCK_SIZE !== 0) {
      // TODO log error
      throw new Error(`invalid block offset: ${offset}`);
    }

    const nPiece = Math.floor(offset / this.#info.pieceLength);
    const pieceLength = nPiece === this.#info.pieces.length - 1
      ? this.#info.length % this.#info.pieceLength
      : this.#info.pieceLength;
    const numBlocks = Math.ceil(pieceLength / BLOCK_SIZE);
    const pieceOffset = offset -
      Math.max(0, nPiece - 1) * this.#info.pieceLength;
    const nBlock = Math.floor(pieceOffset / BLOCK_SIZE);

    if (nPiece === this.#info.pieces.length - 1 && nBlock === numBlocks - 1) {
      const lastBlockLength =
        (this.#info.length % this.#info.pieceLength) % BLOCK_SIZE || BLOCK_SIZE;
      if (length !== lastBlockLength) {
        // TODO log error
        throw new Error(`invalid last block length: ${length}`);
      }
    } else if (length !== BLOCK_SIZE) {
      // TODO log error
      throw new Error(`invalid block length: ${length}`);
    }
  }

  private async findAndDo(
    offset: number,
    bytes: Uint8Array,
    action: (
      path: string[],
      offset: number,
      arr: Uint8Array,
    ) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      if (!("files" in this.#info)) {
        return await action([...this.#dirPath, this.#info.name], offset, bytes);
      }

      const length = bytes.length;
      let i = 0;
      let fileStart = 0;

      for (const file of this.#info.files) {
        const fileEnd = fileStart + file.length;
        if (fileEnd >= offset) {
          const nBytes = Math.min(fileEnd - offset - i, length - i);
          const fileOffset = Math.max(0, offset - fileStart);

          const success = await action(
            [...this.#dirPath, ...file.path],
            fileOffset,
            bytes.subarray(i, i + nBytes),
          );
          if (!success) {
            return false;
          }

          i += nBytes;
          if (i === length) {
            return true;
          }
        }

        fileStart = fileEnd;
      }
    } catch {
      // TODO log error
      return false;
    }

    // TODO log error
    return false;
  }
}

async function mkdirAndOpen(path: string) {
  try {
    return await Deno.open(path, OPEN_OPTIONS);
  } catch {
    await Deno.mkdir(dirname(path), { recursive: true });
    return Deno.open(path, OPEN_OPTIONS);
  }
}

export const fsStorage: StorageMethod = {
  async get(
    path: string[],
    offset: number,
    length: number,
  ): Promise<Uint8Array | null> {
    const resolvedPath = join(...path);
    let f: Deno.FsFile | null = null;
    try {
      f = await Deno.open(resolvedPath, OPEN_OPTIONS);
      f.seek(offset, Deno.SeekMode.Start);
      const bytes = await readN(f, length);
      f.close();
      return bytes;
    } catch {
      // TODO log error properly
      try {
        f?.close();
      } catch {
        // do nothing
      }
      return null;
    }
  },

  async set(
    path: string[],
    offset: number,
    bytes: Uint8Array,
  ): Promise<boolean> {
    const resolvedPath = join(...path);
    let f: Deno.FsFile | null = null;
    try {
      f = await mkdirAndOpen(resolvedPath);
      f.seek(offset, Deno.SeekMode.Start);
      await writeAll(f, bytes);
      f.close();
      return true;
    } catch {
      // TODO log error
      try {
        f?.close();
      } catch {
        // do nothing
      }
      return false;
    }
  },

  async exists(path: string[]): Promise<boolean> {
    try {
      await Deno.stat(join(...path));
      return true;
    } catch {
      return false;
    }
  },
};
