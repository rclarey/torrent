// Copyright (C) 2020 Russell Clarey. All rights reserved. MIT license.

import { InfoDict, MultiFileFields } from "./metainfo.ts";
import { readN } from "./_bytes.ts";

export interface Storage {
  get(offset: number, length: number): Promise<Uint8Array>;
  set(offset: number, bytes: Uint8Array): Promise<void>;
}

const OPEN_OPTIONS = {
  read: true,
  write: true,
  create: true,
};

class FileStorage implements Storage {
  constructor(public path: string) {}

  async get(offset: number, length: number): Promise<Uint8Array> {
    const f = await Deno.open(this.path, OPEN_OPTIONS);
    try {
      f.seek(offset, Deno.SeekMode.Start);
      const bytes = await readN(f, length);
      return bytes;
    } finally {
      f.close();
    }
  }

  async set(offset: number, bytes: Uint8Array): Promise<void> {
    const f = await Deno.open(this.path, OPEN_OPTIONS);
    try {
      f.seek(offset, Deno.SeekMode.Start);
      await Deno.writeAll(f, bytes);
    } finally {
      f.close();
    }
  }
}

class MultiFileStorage implements Storage {
  constructor(public dir: string, public files: MultiFileFields[]) {}

  async ensurePaths(): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true });
    for (const { path } of this.files) {
      if (path.length > 1) {
        await Deno.mkdir(
          [this.dir, ...path.slice(0, -1)].join("/"),
          { recursive: true },
        );
      }
    }
  }

  private async findAndDo(
    name: string,
    offset: number,
    bytes: Uint8Array,
    action: (file: Deno.File, arr: Uint8Array) => Promise<void>,
  ): Promise<void> {
    const length = bytes.length;
    let i = 0;
    let fileStart = 0;
    for (const file of this.files) {
      const fileEnd = fileStart + file.length;
      if (fileEnd >= offset) {
        const nBytes = Math.min(fileEnd - offset - i, length - i);
        const fileOffset = Math.max(offset - fileStart, 0);

        const fd = await Deno.open(
          [this.dir, ...file.path].join("/"),
          OPEN_OPTIONS,
        );
        try {
          await fd.seek(fileOffset, Deno.SeekMode.Start);
          await action(fd, bytes.subarray(i, i + nBytes));
        } finally {
          fd.close();
        }

        i += nBytes;
        if (i === length) {
          return;
        }
      }

      fileStart = fileEnd;
    }

    throw Error(
      `error: failed to ${name} bytes ${offset} to ${offset + length -
        1} for ${this.dir}`,
    );
  }

  async get(offset: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    await this.findAndDo(
      "get",
      offset,
      bytes,
      async (file, arr) => {
        await readN(file, arr.length, arr);
      },
    );
    return bytes;
  }

  async set(offset: number, bytes: Uint8Array): Promise<void> {
    return await this.findAndDo(
      "set",
      offset,
      bytes,
      (file, arr) => Deno.writeAll(file, arr),
    );
  }
}

export async function createFileStorage(
  info: InfoDict,
  dirPath: string,
): Promise<Storage> {
  const topLevelPath = `${dirPath}/${info.name}`;
  if ("length" in info) {
    return new FileStorage(topLevelPath);
  }

  const storage = new MultiFileStorage(topLevelPath, info.files);
  await storage.ensurePaths();
  return storage;
}
