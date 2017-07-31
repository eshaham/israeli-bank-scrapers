function timeoutPromise(ms, promise) {
  const timeout = new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject({ timeout: true });
    }, ms);
  });

  return Promise.race([
    promise,
    timeout,
  ]);
}

function waitUntil(asyncTest, timeout = 10000, interval = 100) {
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
  return timeoutPromise(timeout, promise);
}

export default waitUntil;
