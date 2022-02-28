// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import { writeAll } from "https://deno.land/std@0.96.0/io/util.ts#^";

import type { InfoDict, MultiFileFields } from "./metainfo.ts";
import { readN } from "./_bytes.ts";

/** Abstraction of the different ways to persist the downloaded files */
export interface Storage {
  get(offset: number, length: number): Promise<Uint8Array | null>;
  /** return value indicates whether the call was successful or not */
  set(offset: number, bytes: Uint8Array): Promise<boolean>;
  /** Returns true if the file or files exist already */
  exists(): Promise<boolean>;
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
      await writeAll(f, bytes);
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

  async exists(): Promise<boolean> {
    try {
      await Deno.stat(this.path);
      return true;
    } catch {
      return false;
    }
  }
}

class MultiFileStorage implements Storage {
  constructor(public dir: string, public files: MultiFileFields[]) {}

  private async ensurePaths(): Promise<void> {
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
    retry = false,
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
    } catch (e) {
      if (!retry && e instanceof Deno.errors.NotFound) {
        await this.ensurePaths();
        return this.findAndDo(offset, bytes, action, true);
      }

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
      (file, arr) => writeAll(file, arr),
    );
  }

  async exists(): Promise<boolean> {
    for (const file of this.files) {
      try {
        await Deno.stat([this.dir, ...file.path].join("/"));
        return true;
      } catch {
        // do nothing
      }
    }

    return false;
  }
}

export function createFileStorage(info: InfoDict, dirPath: string): Storage {
  const topLevelPath = `${dirPath}/${info.name}`;
  if ("length" in info) {
    return new FileStorage(topLevelPath);
  }
  return new MultiFileStorage(topLevelPath, info.files);
}
