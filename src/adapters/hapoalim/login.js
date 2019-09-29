import { fillInputs, clickButton, waitUntilElementFound } from '../../helpers/elements-interactions';
import { noop } from '../../helpers/scraping';
import { navigateTo, getCurrentUrl, waitForRedirect } from '../../helpers/navigation';
import { BASE_URL, LOGIN_URL } from './definitions';
import getKeyByValue from '../../helpers/filters';
import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '../../constants';
import { isValidCredentials } from '../../definitions';

const SCRAPER_ID = 'hapoalim';

const submitButtonSelector = '#inputSend';

function createLoginFields(credentials) {
  return [
    { selector: '#userID', value: credentials.userCode },
    { selector: '#userPassword', value: credentials.password },
  ];
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [`${BASE_URL}/portalserver/HomePage`, `${BASE_URL}/ng-portals-bt/rb/he/homepage`, `${BASE_URL}/ng-portals/rb/he/homepage`];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = [
    `${BASE_URL}/MCP/START?flow=MCP&state=START&expiredDate=null`,
    /\/ABOUTTOEXPIRE\/START/i,
  ];
  return urls;
}

// TODO sakal move to shared logic
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

/**
 * login to bank hapoalim
 * @param page a puppeteer page
 * @param options login options
 * @param [noop] options.emitProgress emit method to notify login progress
 * @param {Object} options.credentials credentials for bank hapoalim
 * @returns {Promise<{success: boolean, errorType: string}>}
 */
async function login(page, options) {
  try {
    if (!page || !options || !isValidCredentials(SCRAPER_ID, options.credentials)) {
      return {
        success: false,
        errorType: LOGIN_RESULT.INVALID_OPTIONS,
      };
    }

    const emitProgress = options.emitProgress || noop;
    const fields = createLoginFields(options.credentials);
    const possibleLoginResults = getPossibleLoginResults();

    emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);

    await navigateTo(page, LOGIN_URL);
    await waitUntilElementFound(page, submitButtonSelector);
    await fillInputs(page, fields);
    await clickButton(page, submitButtonSelector);
    emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);
    await waitForRedirect(page);
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

export default login;
