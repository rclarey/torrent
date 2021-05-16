// Copyright (C) 2021 Russell Clarey. All rights reserved. MIT license.

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
    const to = setTimeout(
      () => reject(new TimeoutError()),
      timeout,
    );
    func().then((r) => {
      clearTimeout(to);
      resolve(r);
    });
  });
}
