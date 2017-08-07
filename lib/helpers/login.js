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
}

export { login, LOGIN_RESULT };
