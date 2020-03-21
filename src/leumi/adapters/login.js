import { fillInputs, clickButton, waitUntilElementFound } from '../../helpers/elements-interactions';
import { navigateTo, getCurrentUrl } from '../../helpers/navigation';
import { BASE_URL } from '../definitions';
import getKeyByValue from '../../helpers/filters';
import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '../../constants';
import { handleLoginResult, isValidCredentials } from '../../helpers/login';

const SCRAPER_ID = 'leumi';

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
  urls[LOGIN_RESULT.SUCCESS] = [/ebanking\/SO\/SPA.aspx/i];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}


export function loginAdapter(options) {
  return {
    name: `login(${SCRAPER_ID})`,
    validate: (context) => {
      const result = [];

      if (!isValidCredentials(SCRAPER_ID, options.credentials)) {
        result.push('expected credentials object with userCode and password');
      }

      if (!context.hasSessionData('puppeteer.page')) {
        result.push('expected puppeteer page to be provided by prior adapter');
      }

      return result;
    },
    action: async (context) => {
      try {
        const page = context.getSessionData('puppeteer.page');
        const fields = createLoginFields(options.credentials);
        const possibleLoginResults = getPossibleLoginResults();

        await navigateTo(page, BASE_URL);
        await waitUntilElementFound(page, submitButtonSelector);
        await fillInputs(page, fields);
        await clickButton(page, submitButtonSelector);
        context.notifyProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);
        await waitForPostLogin(page);
        const current = await getCurrentUrl(page, true);
        const loginResult = getKeyByValue(possibleLoginResults, current);
        return handleLoginResult(loginResult,
          (status) => context.notifyProgress(status));
      } catch (error) {
        return {
          success: false,
          errorType: LOGIN_RESULT.UNKNOWN_ERROR,
        };
      }
    },
  };
}
