import { readN } from "./_bytes.ts";

export interface Storage {
  get(offset: number, length: number): Promise<Uint8Array>;
  set(offset: number, bytes: Uint8Array): Promise<void>;
}

interface SingleInfoDict {
  /** the filename */
  name: string;
  /** length of the file in bytes */
  length: number;
  /** number of bytes in each piece */
  pieceLength: number;
  /* the 20-byte SHA1 hash values for each piece */
  pieces: Uint8Array[];
}

interface MultiFileInfo {
  /** length of the file in bytes */
  length: number;
  /** array representing the path and filename */
  path: string[];
}

interface MultiInfoDict {
  /** the name of the directory in which to store all the files */
  name: string;
  /** info for each file in the torrent */
  files: MultiFileInfo[];
  /** number of bytes in each piece */
  pieceLength: number;
  /* the 20-byte SHA1 hash values for each piece */
  pieces: Uint8Array[];
}

type InfoDict = SingleInfoDict | MultiInfoDict;

export type StorageFactory = (info: InfoDict) => Storage | Promise<Storage>;

const OPEN_OPTIONS = {
  read: true,
  write: true,
  create: true,
};

export class FileStorage implements Storage {
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

export class MultiFileStorage implements Storage {
  constructor(public dir: string, public files: MultiFileInfo[]) {
  }

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
