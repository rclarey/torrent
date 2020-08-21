import { FileStorage, MultiFileStorage } from "./storage.ts";
import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.64.0/testing/asserts.ts#^";

function withTemp(f: (name: string) => Promise<void>) {
  return async () => {
    const name = "__test.txt";
    await Deno.writeFile(
      name,
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      { create: true },
    );
    await f(name);
    await Deno.remove(name);
  };
}

Deno.test(
  "FileStorage - get() - file exists",
  withTemp(async (name) => {
    const storage = new FileStorage(name);
    const bytes = await storage.get(2, 4);
    assertEquals(bytes.toString(), "3,4,5,6");
  }),
);

Deno.test(
  "FileStorage - get() - file doesn't exist",
  async () => {
    const storage = new FileStorage("__test.txt");
    await assertThrowsAsync(() => storage.get(2, 4), Error, "reached EOF");
    await Deno.remove("__test.txt");
  },
);

Deno.test(
  "FileStorage - set() - file exists",
  withTemp(async (name) => {
    const storage = new FileStorage(name);
    await storage.set(2, Uint8Array.from([0, 1, 0, 1]));
    assertEquals((await Deno.readFile(name)).toString(), "1,2,0,1,0,1,7,8");
  }),
);

Deno.test(
  "FileStorage - set() - file doesn't exist",
  async () => {
    const storage = new FileStorage("__test.txt");
    await storage.set(2, Uint8Array.from([2, 1, 2, 1]));
    assertEquals(
      (await Deno.readFile("__test.txt")).toString(),
      "0,0,2,1,2,1",
    );
    await Deno.remove("__test.txt");
  },
);

Deno.test("MultiFileStorage - get() - inside one file", async () => {
  const storage = new MultiFileStorage(
    "__test",
    [{ path: ["__test.txt"], length: 4 }],
  );
  await storage.ensurePaths();
  await Deno.writeFile(
    "__test/__test.txt",
    Uint8Array.from([1, 2, 3, 4]),
    { create: true },
  );

  const bytes = await storage.get(2, 2);
  assertEquals(bytes.toString(), "3,4");

  await Deno.remove("__test/__test.txt", { recursive: true });
});

Deno.test("MultiFileStorage - get() - across files", async () => {
  const storage = new MultiFileStorage(
    "__test",
    [
      { path: ["__test1.txt"], length: 4 },
      { path: ["dir1", "__test2.txt"], length: 4 },
    ],
  );
  await storage.ensurePaths();
  await Deno.writeFile(
    "__test/__test1.txt",
    Uint8Array.from([1, 2, 3, 4]),
    { create: true },
  );
  await Deno.writeFile(
    "__test/dir1/__test2.txt",
    Uint8Array.from([9, 8, 7, 6]),
    { create: true },
  );

  const bytes = await storage.get(3, 4);
  assertEquals(bytes.toString(), "4,9,8,7");

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - get() - file doesn't exist", async () => {
  const storage = new MultiFileStorage(
    "__test",
    [{ path: ["__test.txt"], length: 4 }],
  );
  await storage.ensurePaths();

  await assertThrowsAsync(() => storage.get(2, 2), Error, "reached EOF");

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - set() - inside one file", async () => {
  const storage = new MultiFileStorage(
    "__test",
    [{ path: ["__test.txt"], length: 4 }],
  );
  await storage.ensurePaths();
  await Deno.writeFile(
    "__test/__test.txt",
    Uint8Array.from([1, 2, 3, 4]),
    { create: true },
  );

  await storage.set(2, Uint8Array.from([9, 8]));
  assertEquals(
    (await Deno.readFile("__test/__test.txt")).toString(),
    "1,2,9,8",
  );

  await Deno.remove("__test", { recursive: true });
});

Deno.test("MultiFileStorage - set() - across files", async () => {
  const storage = new MultiFileStorage(
    "__test",
    [
      { path: ["__test1.txt"], length: 4 },
      { path: ["dir1", "__test2.txt"], length: 4 },
    ],
  );
  await storage.ensurePaths();
  await Deno.writeFile(
    "__test/__test1.txt",
    Uint8Array.from([1, 2, 3, 4]),
    { create: true },
  );
  await Deno.writeFile(
    "__test/dir1/__test2.txt",
    Uint8Array.from([9, 8, 7, 6]),
    { create: true },
  );

  const bytes = await storage.set(2, Uint8Array.from([0, 0, 0]));
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
  const storage = new MultiFileStorage(
    "__test",
    [{ path: ["__test.txt"], length: 4 }],
  );
  await storage.ensurePaths();

  await storage.set(2, Uint8Array.from([9, 8]));
  assertEquals(
    (await Deno.readFile("__test/__test.txt")).toString(),
    "0,0,9,8",
  );

  await Deno.remove("__test", { recursive: true });
});
