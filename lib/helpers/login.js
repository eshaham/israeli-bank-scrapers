import { waitForRedirect, waitForUrls } from './navigation';
import { waitUntilElementFound, fillInput, clickButton } from './elements-interactions';

const LOGIN_RESULT = {
  SUCCESS: 'success',
  INVALID_PASSWORD: 'invalidPassword',
  CHANGE_PASSWORD: 'changePassword',
};

async function fillInputAsync(page, field) {
  return fillInput(page, field.id, field.value);
}

async function login(page, loginUrl, fields, submitButtonId, loggingInNotifier) {
  await page.open(loginUrl);
  await waitUntilElementFound(page, submitButtonId);

  await Promise.all(fields.map((field) => {
    return fillInputAsync(page, field);
  }));

  await clickButton(page, submitButtonId);
  loggingInNotifier();

  await waitForRedirect(page);
}

async function analyzeLogin(page, possibleUrls) {
  let loginResult;
  try {
    loginResult = await waitForUrls(page, possibleUrls);
  } catch (e) {
    loginResult = e.timeout ? 'timeout' : 'generic';
  }

  return loginResult;
}

export { login, analyzeLogin, LOGIN_RESULT };
