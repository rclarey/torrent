// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

export function assert(cond: boolean) {
  if (!cond) {
    throw new Error("assertion failed");
  }
}

/** An error thrown when a request times out */
export class TimeoutError extends Error {
  constructor() {
    super("request timed out");
  }
}

export function withTimeout<T>(
  func: () => Promise<T>,
  timeout: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new TimeoutError()), timeout);
    resolve(
      func().then((r) => {
        clearTimeout(to);
        return r;
      }),
    );
  });
}
