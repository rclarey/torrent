// Copyright (C) 2021 Russell Clarey. All rights reserved. MIT license.

import type { InfoDict, MultiFileFields } from "./metainfo.ts";
import { readN } from "./_bytes.ts";

export interface Storage {
  get(offset: number, length: number): Promise<Uint8Array | null>;
  /* return value indicates whether the call was successful or not */
  set(offset: number, bytes: Uint8Array): Promise<boolean>;
}

const OPEN_OPTIONS = {
  read: true,
  write: true,
  create: true,
};

class FileStorage implements Storage {
  constructor(public path: string) {}

  async get(offset: number, length: number): Promise<Uint8Array | null> {
    let f: Deno.File | null = null;
    try {
      f = await Deno.open(this.path, OPEN_OPTIONS);
      f.seek(offset, Deno.SeekMode.Start);
      const bytes = await readN(f, length);
      f.close();
      return bytes;
    } catch {
      try {
        f?.close();
      } catch {
        // do nothing
      }
      return null;
    }
  }

  async set(offset: number, bytes: Uint8Array): Promise<boolean> {
    let f: Deno.File | null = null;
    try {
      f = await Deno.open(this.path, OPEN_OPTIONS);
      f.seek(offset, Deno.SeekMode.Start);
      await Deno.writeAll(f, bytes);
      f.close();
      return true;
    } catch {
      try {
        f?.close();
      } catch {
        // do nothing
      }
      return false;
    }
  }
}

class MultiFileStorage implements Storage {
  constructor(public dir: string, public files: MultiFileFields[]) {}

  async ensurePaths(): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true });
    for (const { path } of this.files) {
      if (path.length > 1) {
        await Deno.mkdir([this.dir, ...path.slice(0, -1)].join("/"), {
          recursive: true,
        });
      }
    }
  }

  private async findAndDo(
    offset: number,
    bytes: Uint8Array,
    action: (file: Deno.File, arr: Uint8Array) => Promise<void>,
  ): Promise<boolean> {
    const length = bytes.length;
    let f: Deno.File | null = null;
    let i = 0;
    let fileStart = 0;

    try {
      for (const file of this.files) {
        const fileEnd = fileStart + file.length;
        if (fileEnd >= offset) {
          const nBytes = Math.min(fileEnd - offset - i, length - i);
          const fileOffset = Math.max(offset - fileStart, 0);

          f = await Deno.open([this.dir, ...file.path].join("/"), OPEN_OPTIONS);
          await f.seek(fileOffset, Deno.SeekMode.Start);
          await action(f, bytes.subarray(i, i + nBytes));
          f.close();

          i += nBytes;
          if (i === length) {
            return true;
          }
        }

        fileStart = fileEnd;
      }
    } catch {
      try {
        f?.close();
      } catch {
        // do nothing
      }
    }

    return false;
  }

  async get(offset: number, length: number): Promise<Uint8Array | null> {
    const bytes = new Uint8Array(length);
    const success = await this.findAndDo(offset, bytes, async (file, arr) => {
      await readN(file, arr.length, arr);
    });
    return success ? bytes : null;
  }

  async set(offset: number, bytes: Uint8Array): Promise<boolean> {
    return await this.findAndDo(
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
