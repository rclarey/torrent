import { createFileStorage } from "./storage.ts";
import { assertEquals } from "https://deno.land/std@0.96.0/testing/asserts.ts#^";
import type { SingleFileInfoDict } from "./metainfo.ts";

const baseSingle = {
  pieceLength: 1024,
  pieces: [],
  private: 0,
  name: "__test.txt",
  length: 0,
};

const baseMulti = {
  pieceLength: 1024,
  pieces: [],
  private: 0,
  name: "__test",
  files: [{ path: ["__test.txt"], length: 4 }],
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
  "FileStorage - get() - file exists",
  withTemp(async (info) => {
    const storage = await createFileStorage(info, Deno.cwd());
    const bytes = await storage.get(2, 4);
    assertEquals(bytes!.toString(), "3,4,5,6");
  }),
);

Deno.test("FileStorage - get() - file doesn't exist", async () => {
  const storage = await createFileStorage(baseSingle, Deno.cwd());
  const bytes = await storage.get(2, 4);
  assertEquals(bytes, null);
});

Deno.test(
  "FileStorage - get() - reading fails",
  withTemp(async (info) => {
    const storage = await createFileStorage(info, Deno.cwd());
    const bytes = await storage.get(7, 4);
    assertEquals(bytes, null);
  }),
);

Deno.test(
  "FileStorage - set() - file exists",
  withTemp(async (info) => {
    const storage = await createFileStorage(info, Deno.cwd());
    const result = await storage.set(2, Uint8Array.from([0, 1, 0, 1]));

    assertEquals(result, true);
    assertEquals(
      (await Deno.readFile(info.name)).toString(),
      "1,2,0,1,0,1,7,8",
    );
  }),
);

Deno.test("FileStorage - set() - file doesn't exist", async () => {
  const storage = await createFileStorage(baseSingle, Deno.cwd());
  const result = await storage.set(2, Uint8Array.from([2, 1, 2, 1]));
  assertEquals(result, true);
  assertEquals(
    (await Deno.readFile(baseSingle.name)).toString(),
    "0,0,2,1,2,1",
  );
  await Deno.remove(baseSingle.name);
});

Deno.test(
  "FileStorage - set() - writing fails",
  withTemp(async (info) => {
    const storage = await createFileStorage(info, Deno.cwd());

    const seek = Deno.File.prototype.seek;
    Deno.File.prototype.seek = () => {
      throw new Error();
    };

    const result = await storage.set(2, Uint8Array.from([0, 1, 0, 1]));
    assertEquals(result, false);

    Deno.File.prototype.seek = seek;
  }),
);

Deno.test("MultiFileStorage - get() - inside one file", async () => {
  const storage = await createFileStorage(baseMulti, Deno.cwd());
  await Deno.writeFile("__test/__test.txt", Uint8Array.from([1, 2, 3, 4]), {
    create: true,
  });

  const bytes = await storage.get(2, 2);
  assertEquals(bytes!.toString(), "3,4");

  await Deno.remove("__test/__test.txt", { recursive: true });
});

Deno.test("MultiFileStorage - get() - across files", async () => {
  const storage = await createFileStorage(
    {
      ...baseMulti,
      files: [
        { path: ["__test1.txt"], length: 4 },
        { path: ["dir1", "__test2.txt"], length: 4 },
      ],
    },
    Deno.cwd(),
  );
  await Deno.writeFile("__test/__test1.txt", Uint8Array.from([1, 2, 3, 4]), {
    create: true,
  });
  await Deno.writeFile(
    "__test/dir1/__test2.txt",
    Uint8Array.from([9, 8, 7, 6]),
    { create: true },
  );

  const bytes = await storage.get(3, 4);
  assertEquals(bytes!.toString(), "4,9,8,7");

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - get() - file doesn't exist", async () => {
  const storage = await createFileStorage(baseMulti, Deno.cwd());
  const bytes = await storage.get(2, 2);
  assertEquals(bytes, null);
});

Deno.test("MultiFileStorage - get() - reading fails", async () => {
  const storage = await createFileStorage(baseMulti, Deno.cwd());
  await Deno.writeFile("__test/__test.txt", Uint8Array.from([1, 2, 3, 4]), {
    create: true,
  });

  const bytes = await storage.get(3, 4);
  assertEquals(bytes, null);

  await Deno.remove("__test/__test.txt", { recursive: true });
});

Deno.test("MultiFileStorage - set() - inside one file", async () => {
  const storage = await createFileStorage(baseMulti, Deno.cwd());
  await Deno.writeFile("__test/__test.txt", Uint8Array.from([1, 2, 3, 4]), {
    create: true,
  });

  const result = await storage.set(2, Uint8Array.from([9, 8]));

  assertEquals(result, true);
  assertEquals(
    (await Deno.readFile("__test/__test.txt")).toString(),
    "1,2,9,8",
  );

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - set() - across files", async () => {
  const storage = await createFileStorage(
    {
      ...baseMulti,
      files: [
        { path: ["__test1.txt"], length: 4 },
        { path: ["dir1", "__test2.txt"], length: 4 },
      ],
    },
    Deno.cwd(),
  );

  await Deno.writeFile("__test/__test1.txt", Uint8Array.from([1, 2, 3, 4]), {
    create: true,
  });
  await Deno.writeFile(
    "__test/dir1/__test2.txt",
    Uint8Array.from([9, 8, 7, 6]),
    { create: true },
  );

  const result = await storage.set(2, Uint8Array.from([0, 0, 0]));

  assertEquals(result, true);
  assertEquals(
    (await Deno.readFile("__test/__test1.txt")).toString(),
    "1,2,0,0",
  );
  assertEquals(
    (await Deno.readFile("__test/dir1/__test2.txt")).toString(),
    "0,8,7,6",
  );

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - set() - file doesn't exist", async () => {
  const storage = await createFileStorage(baseMulti, Deno.cwd());
  await storage.set(2, Uint8Array.from([9, 8]));
  assertEquals(
    (await Deno.readFile("__test/__test.txt")).toString(),
    "0,0,9,8",
  );

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - set() - writing fails", async () => {
  const storage = await createFileStorage(baseMulti, Deno.cwd());
  await Deno.writeFile("__test/__test.txt", Uint8Array.from([1, 2, 3, 4]), {
    create: true,
  });

  const seek = Deno.File.prototype.seek;
  Deno.File.prototype.seek = () => {
    throw new Error();
  };

  const result = await storage.set(2, Uint8Array.from([9, 8]));
  assertEquals(result, false);
  await Deno.remove("__test", { recursive: true });

  Deno.File.prototype.seek = seek;
});
