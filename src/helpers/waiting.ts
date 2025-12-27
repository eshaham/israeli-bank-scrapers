import type { Falsy } from 'utility-types';

export class TimeoutError extends Error {}

export const SECOND = 1000;

type WaitUntilReturn<T> = T extends Falsy ? never : Promise<NonNullable<T>>;

function timeoutPromise<T>(ms: number, promise: Promise<T>, description: string): Promise<T> {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      const error = new TimeoutError(description);
      reject(error);
    }, ms);
  });

  return Promise.race([
    promise,
    // casting to avoid type error- safe since this promise will always reject
    timeout as Promise<T>,
  ]);
}

/**
 * Wait until a promise resolves with a truthy value or reject after a timeout
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  timeout = 10000,
  interval = 100,
): WaitUntilReturn<T> {
  const promise = new Promise<NonNullable<T>>((resolve, reject) => {
    function wait() {
      asyncTest()
        .then(value => {
          if (value) {
            resolve(value);
          } else {
            setTimeout(wait, interval);
          }
        })
        .catch(() => {
          reject();
        });
    }
    wait();
  });
  return timeoutPromise(timeout, promise, description) as WaitUntilReturn<T>;
}

export function raceTimeout(ms: number, promise: Promise<any>) {
  return timeoutPromise(ms, promise, 'timeout').catch(err => {
    if (!(err instanceof TimeoutError)) throw err;
  });
}

export function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]> {
  return actions.reduce((m, a) => m.then(async x => [...x, await a()]), Promise.resolve<T[]>(new Array<T>()));
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Add random human-like delay
 */
export function randomDelay(min: number = 500, max: number = 2000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}
