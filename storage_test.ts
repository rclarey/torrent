import * as sinon from "https://cdn.skypack.dev/sinon@v13.0.1?dts#^";
import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.96.0/testing/asserts.ts#^";
import { BLOCK_SIZE, fsStorage, Storage } from "./storage.ts";
import type { SingleFileInfoDict } from "./metainfo.ts";

const baseSingle = {
  pieceLength: 1024,
  pieces: [new Uint8Array(20)],
  private: 0,
  name: "__test.txt",
  length: 8,
};

const baseMulti = {
  pieceLength: 32 * 1024,
  pieces: [new Uint8Array(20)],
  private: 0,
  name: "__test",
  length: 32 * 1024 - 1,
  files: [
    { path: ["__test1.txt"], length: 16 * 1024 + 10 },
    { path: ["__test2.txt"], length: 16 * 1024 - 11 },
  ],
};

function withTemp(f: (info: SingleFileInfoDict) => Promise<void>) {
  return async () => {
    await Deno.writeFile(
      baseSingle.name,
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      { create: true },
    );
    await f(baseSingle);
    await Deno.remove(baseSingle.name);
  };
}

Deno.test(
  "fsStorage - get() - file exists",
  withTemp(async (info) => {
    const bytes = await fsStorage.get([info.name], 2, 4);
    assertEquals(bytes!.toString(), "3,4,5,6");
  }),
);

Deno.test("fsStorage - get() - file doesn't exist", async () => {
  const bytes = await fsStorage.get([baseSingle.name], 2, 4);
  assertEquals(bytes, null);
});

Deno.test(
  "fsStorage - get() - reading fails",
  withTemp(async (info) => {
    const bytes = await fsStorage.get([info.name], 7, 4);
    assertEquals(bytes, null);
  }),
);

Deno.test(
  "fsStorage - set() - file exists",
  withTemp(async (info) => {
    const result = await fsStorage.set(
      [info.name],
      2,
      Uint8Array.from([0, 1, 0, 1]),
    );

    assertEquals(result, true);
    assertEquals(
      (await Deno.readFile(info.name)).toString(),
      "1,2,0,1,0,1,7,8",
    );
  }),
);

Deno.test("fsStorage - set() - file doesn't exist", async () => {
  const result = await fsStorage.set(
    [baseSingle.name],
    2,
    Uint8Array.from([2, 1, 2, 1]),
  );
  assertEquals(result, true);
  assertEquals(
    (await Deno.readFile(baseSingle.name)).toString(),
    "0,0,2,1,2,1",
  );
  await Deno.remove(baseSingle.name);
});

Deno.test(
  "fsStorage - set() - writing fails",
  withTemp(async (info) => {
    const seek = Deno.FsFile.prototype.seek;
    Deno.FsFile.prototype.seek = () => {
      throw new Error();
    };

    const result = await fsStorage.set(
      [info.name],
      2,
      Uint8Array.from([0, 1, 0, 1]),
    );
    assertEquals(result, false);

    Deno.FsFile.prototype.seek = seek;
  }),
);

Deno.test(
  "fsStorage - set() - creates directory structure when missing",
  async () => {
    await assertThrowsAsync(() => Deno.stat("__test"), Deno.errors.NotFound);

    await fsStorage.set(
      [baseMulti.name, ...baseMulti.files[0].path],
      0,
      new Uint8Array(BLOCK_SIZE),
    );
    const result = await Deno.stat("__test");
    assertEquals(!!result, true);

    await Deno.remove("__test", { recursive: true });
  },
);

Deno.test(
  "fsStorage - exists() - file exists",
  withTemp(async (info) => {
    const result = await fsStorage.exists([info.name]);
    assertEquals(result, true);
  }),
);

Deno.test("fsStorage - exists() - file doesn't exist", async () => {
  const result = await fsStorage.exists([baseSingle.name]);
  assertEquals(result, false);
});

Deno.test("Storage - get() - single file", async () => {
  const values = crypto.getRandomValues(new Uint8Array(baseSingle.length));
  const mockStorageMethod = {
    get: sinon.fake.resolves(values),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  const result = await storage.get(0, baseSingle.length);
  assertEquals(result, values);
  assertEquals(mockStorageMethod.get.callCount, 1);
  assertEquals(mockStorageMethod.get.lastCall.args, [
    [baseSingle.name],
    0,
    baseSingle.length,
  ]);
});

Deno.test("Storage - get() - multi file, inside one file", async () => {
  const values = crypto.getRandomValues(new Uint8Array(16 * 1024));
  const mockStorageMethod = {
    get: sinon.fake.resolves(values),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  const result = await storage.get(0, 16 * 1024);
  assertEquals(result, values);
  assertEquals(mockStorageMethod.get.callCount, 1);
  assertEquals(mockStorageMethod.get.lastCall.args, [
    baseMulti.files[0].path,
    0,
    16 * 1024,
  ]);
});

Deno.test("Storage - get() - multi file, across files", async () => {
  const values = crypto.getRandomValues(new Uint8Array(16 * 1024 - 1));
  const mockStorageMethod = {
    get: sinon.stub()
      .onCall(0).resolves(values.slice(0, 10))
      .onCall(1).resolves(values.slice(10)),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  const result = await storage.get(16 * 1024, 16 * 1024 - 1);
  assertEquals(result, values);
  assertEquals(mockStorageMethod.get.callCount, 2);
  assertEquals(mockStorageMethod.get.firstCall.args, [
    baseMulti.files[0].path,
    16 * 1024,
    10,
  ]);
  assertEquals(mockStorageMethod.get.lastCall.args, [
    baseMulti.files[1].path,
    0,
    16 * 1024 - 11,
  ]);
});

Deno.test("Storage - get() - fails if method fails", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  const result = await storage.get(0, baseSingle.length);
  assertEquals(result, null);
});

Deno.test("Storage - get() - fails if method throws", async () => {
  const mockStorageMethod = {
    get: sinon.fake.rejects(new Error()),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  const result = await storage.get(0, baseSingle.length);
  assertEquals(result, null);
});

Deno.test("Storage - get() - checks block offset", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  await assertThrowsAsync(
    () => storage.get(1, baseSingle.length),
    Error,
    "invalid block offset",
  );
});

Deno.test("Storage - get() - checks block length", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  await assertThrowsAsync(
    () => storage.get(0, 1024),
    Error,
    "invalid block length",
  );
});

Deno.test("Storage - get() - checks last block length", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  await assertThrowsAsync(
    () => storage.get(16 * 1024, 16 * 1024),
    Error,
    "invalid last block length",
  );
});

Deno.test("Storage - set() - single file", async () => {
  const values = crypto.getRandomValues(new Uint8Array(baseSingle.length));
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  const result = await storage.set(0, values);
  assertEquals(result, true);
  assertEquals(mockStorageMethod.set.callCount, 1);
  assertEquals(mockStorageMethod.set.lastCall.args, [
    [baseSingle.name],
    0,
    values,
  ]);
});

Deno.test("Storage - set() - multi file, inside one file", async () => {
  const values = crypto.getRandomValues(new Uint8Array(16 * 1024));
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  const result = await storage.set(0, values);
  assertEquals(result, true);
  assertEquals(mockStorageMethod.set.callCount, 1);
  assertEquals(mockStorageMethod.set.lastCall.args, [
    baseMulti.files[0].path,
    0,
    values,
  ]);
});

Deno.test("Storage - set() - multi file, across files", async () => {
  const values = crypto.getRandomValues(new Uint8Array(16 * 1024 - 1));
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  const result = await storage.set(16 * 1024, values);
  assertEquals(result, true);
  assertEquals(mockStorageMethod.set.callCount, 2);
  assertEquals(mockStorageMethod.set.firstCall.args, [
    baseMulti.files[0].path,
    16 * 1024,
    values.slice(0, 10),
  ]);
  assertEquals(mockStorageMethod.set.lastCall.args, [
    baseMulti.files[1].path,
    0,
    values.slice(10),
  ]);
});

Deno.test("Storage - set() - fails if method fails", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(false),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  const result = await storage.set(0, new Uint8Array(baseSingle.length));
  assertEquals(result, false);
});

Deno.test("Storage - set() - fails if method throws", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.rejects(new Error()),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  const result = await storage.set(0, new Uint8Array(baseSingle.length));
  assertEquals(result, false);
});

Deno.test("Storage - set() - checks block offset", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseSingle, Deno.cwd());
  await assertThrowsAsync(
    () => storage.set(1, new Uint8Array(baseSingle.length)),
    Error,
    "invalid block offset",
  );
});

Deno.test("Storage - set() - checks block length", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  await assertThrowsAsync(
    () => storage.set(0, new Uint8Array(1024)),
    Error,
    "invalid block length",
  );
});

Deno.test("Storage - set() - checks last block length", async () => {
  const mockStorageMethod = {
    get: sinon.fake.resolves(null),
    set: sinon.fake.resolves(true),
    exists: sinon.fake.resolves(true),
  };

  const storage = new Storage(mockStorageMethod, baseMulti, Deno.cwd());
  await assertThrowsAsync(
    () => storage.set(16 * 1024, new Uint8Array(16 * 1024)),
    Error,
    "invalid last block length",
  );
});
