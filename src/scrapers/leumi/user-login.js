import { fillInputs, clickButton, waitUntilElementFound } from '../../helpers/elements-interactions';
import { noop } from '../../helpers/scraping';
import { navigateTo, getCurrentUrl } from '../../helpers/navigation';
import { BASE_URL } from './definitions';
import getKeyByValue from '../../helpers/filters';
import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '../../constants';

const submitButtonSelector = '#enter';

function createLoginFields(credentials) {
  return [
    { selector: '#wtr_uid', value: credentials.username },
    { selector: '#wtr_password', value: credentials.password },
  ];
}

async function waitForPostLogin(page) {
  // TODO check for condition to provide new password
  return Promise.race([
    waitUntilElementFound(page, 'div.leumi-container', true),
    waitUntilElementFound(page, '#loginErrMsg', true),
  ]);
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [/ebanking\/SO\/SPA.aspx/];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}

function handleLoginResult(loginResult, emitProgress) {
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
      return { success: true };
    case LOGIN_RESULT.INVALID_PASSWORD:
      emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_FAILED);
      return {
        success: false,
        errorType: loginResult,
      };
    case LOGIN_RESULT.CHANGE_PASSWORD:
      emitProgress(SCRAPE_PROGRESS_TYPES.CHANGE_PASSWORD);
      return {
        success: false,
        errorType: loginResult,
      };
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }
}

async function userLogin(page, options) {
  try {
    if (!page || !options || !options.credentials) {
      return {
        success: false,
        errorType: LOGIN_RESULT.INVALID_OPTIONS,
      };
    }

    const emitProgress = options.emitProgress || noop;
    const fields = createLoginFields(options.credentials);
    const possibleLoginResults = getPossibleLoginResults();

    emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);
    await navigateTo(page, BASE_URL);
    await waitUntilElementFound(page, submitButtonSelector);
    await fillInputs(page, fields);
    await clickButton(page, submitButtonSelector);
    emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);
    await waitForPostLogin(page);
    const current = await getCurrentUrl(page, true);
    const loginResult = getKeyByValue(possibleLoginResults, current);
    return handleLoginResult(loginResult, emitProgress);
  } catch (error) {
    return {
      success: false,
      errorType: LOGIN_RESULT.UNKNOWN_ERROR,
    };
  }
}

export default userLogin;
