
export class TimeoutError extends Error {

}

export const SECOND = 1000;

function timeoutPromise(ms: number, promise: Promise<any>, description: string) {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      const error = new TimeoutError(description);
      reject(error);
    }, ms);
  });

  return Promise.race([
    promise,
    timeout,
  ]);
}

export function waitUntil(asyncTest: () => Promise<any>, description = '', timeout = 10000, interval = 100) {
  const promise = new Promise((resolve, reject) => {
    function wait() {
      asyncTest().then((value) => {
        if (value === true) {
          resolve();
        } else {
          setTimeout(wait, interval);
        }
      }).catch(() => {
        reject();
      });
    }
    wait();
  });
  return timeoutPromise(timeout, promise, description);
}

export function raceTimeout(ms: number, promise: Promise<any>) {
  return timeoutPromise(ms, promise, 'timeout').catch((err) => {
    if (!(err instanceof TimeoutError)) throw err;
  });
}
