// Copyright (C) 2021 Russell Clarey. All rights reserved. MIT license.

export type Validator<T> = (x: unknown) => x is T;

type ExtractParam<U> = U extends Validator<infer T> ? T : never;

export function obj<T extends Record<string, Validator<unknown>>>(
  shape: T,
): Validator<{ [key in keyof T]: ExtractParam<T[key]> }> {
  return (x): x is { [key in keyof T]: ExtractParam<T[key]> } => {
    if (typeof x !== "object" || x === null) {
      return false;
    }
    for (const key of Object.keys(shape)) {
      if (!shape[key](x[key as keyof typeof x])) {
        return false;
      }
    }

    return true;
  };
}

export function arr<T>(arrType: Validator<T>): Validator<T[]> {
  return (x): x is T[] => {
    if (!Array.isArray(x)) {
      return false;
    }
    return x.every(arrType);
  };
}

type Constructor<T> = new (...args: unknown[]) => T;

export function inst<T>(ctor: Constructor<T>): Validator<T> {
  return (x): x is T => {
    return x instanceof ctor;
  };
}

export function or<A, B>(a: Validator<A>, b: Validator<B>): Validator<A | B> {
  return (x): x is A | B => a(x) || b(x);
}

export const num: Validator<number> = (x): x is number => typeof x === "number";
export const undef: Validator<undefined> = (x): x is undefined =>
  x === undefined;
