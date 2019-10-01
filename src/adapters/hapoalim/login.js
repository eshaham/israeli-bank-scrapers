import { fillInputs, clickButton, waitUntilElementFound } from '../../helpers/elements-interactions';
import { navigateTo, getCurrentUrl, waitForRedirect } from '../../helpers/navigation';
import { BASE_URL, LOGIN_URL } from './definitions';
import getKeyByValue from '../../helpers/filters';
import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '../../constants';
import { handleLoginResult, isValidCredentials } from '../../helpers/login';

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

function loginAdapter(options) {
  return {
    name: 'scrapeTransactions(hapoalim)',
    validate: (context) => {
      const result = [];
      if (!context.hasSessionData('puppeteer.page')) {
        result.push('expected puppeteer page to be provided by prior adapter');
      }

      if (!isValidCredentials(SCRAPER_ID, options.credentials)) {
        result.push('expected credentials object with userCode and password');
      }

      return result;
    },
    action: async (context) => {
      const page = context.getSessionData('puppeteer.page');

      const fields = createLoginFields(options.credentials);
      const possibleLoginResults = getPossibleLoginResults();

      context.notifyProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);

      await navigateTo(page, LOGIN_URL);
      await waitUntilElementFound(page, submitButtonSelector);
      await fillInputs(page, fields);
      await clickButton(page, submitButtonSelector);
      context.notifyProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);
      await waitForRedirect(page);
      const current = await getCurrentUrl(page, true);
      const loginResult = getKeyByValue(possibleLoginResults, current);
      return handleLoginResult(loginResult,
        (status) => context.notifyProgress(status));
    },
  };
}

export default loginAdapter;
