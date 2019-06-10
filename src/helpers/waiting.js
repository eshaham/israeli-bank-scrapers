import readline from 'readline';

function timeoutPromise(ms, promise, description) {
  const timeout = new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error({ timeout: true, errorMessage: description }));
    }, ms);
  });

  return Promise.race([
    promise,
    timeout,
  ]);
}

function waitUntil(asyncTest, description = null, timeout = 10000, interval = 100) {
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

export default waitUntil;

export function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}
