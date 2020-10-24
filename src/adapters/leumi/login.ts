import {
  fillInputs, clickButton, waitUntilElementFound, pageEvalAll,
} from '@core/helpers/elements-interactions';
import { navigateTo, getCurrentUrl } from '@core/helpers/navigation';
import { Page } from 'puppeteer';
import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '@core/constants';
import {
  parseLoginResult, isValidCredentials, LoginResults, PossibleLoginResults,
} from '@core/helpers/login';
import { RunnerAdapter, RunnerAdapterContext } from '@core/runner';
import { BASE_URL } from './definitions';
import { ScraperCredentials } from '../../scrapers/base-scraper';

const SCRAPER_ID = 'leumi';
const ACCOUNT_BLOCKED_MSG = 'המנוי חסום';
const CHANGE_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים.';
const submitButtonSelector = '#enter';


function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: '#wtr_uid', value: credentials.username },
    { selector: '#wtr_password', value: credentials.password },
  ];
}

async function waitForPostLogin(page: Page): Promise<void> {
  // TODO check for condition to provide new password
  await Promise.race([
    waitUntilElementFound(page, 'div.leumi-container', true),
    waitUntilElementFound(page, '#BodyContent_ctl00_loginErrMsg', true),
    waitUntilElementFound(page, '.ErrMsg', true),
  ]);
}

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [/ebanking\/SO\/SPA.aspx/i];

  // TODO [sakal] check which is the latest one
  // urls[LoginResults.InvalidPassword] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];

  urls[LoginResults.InvalidPassword] = [async (options) => {
    if (!options || !options.page) {
      throw new Error('missing page options argument');
    }
    const errorMessage = await pageEvalAll(options.page, '.errHeader', [], (label) => {
      return (label[0] as HTMLElement).innerText;
    });

    return errorMessage === CHANGE_PASSWORD_MSG;
  }];
  urls[LoginResults.AccountBlocked] = [async (options) => {
    if (!options || !options.page) {
      throw new Error('missing page options argument');
    }
    const errorMessage = await pageEvalAll(options.page, '.errHeader', [], (label) => {
      return (label[0] as HTMLElement).innerText;
    });

    return errorMessage.startsWith(ACCOUNT_BLOCKED_MSG);
  }];
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}

interface LoginAdapterOptions {
  credentials: Record<string, string>;
}

export function loginAdapter(options: LoginAdapterOptions): RunnerAdapter {
  return {
    name: `login(${SCRAPER_ID})`,
    validate: (context: RunnerAdapterContext) => {
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
        await navigateTo(page, BASE_URL);
        await waitUntilElementFound(page, submitButtonSelector);
        await fillInputs(page, fields);
        await clickButton(page, submitButtonSelector);
        context.notifyProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);
        await waitForPostLogin(page);
        const loginValue = await getCurrentUrl(page, true);
        const possibleLoginResults = getPossibleLoginResults();
        const result = await parseLoginResult({
          possibleLoginResults,
          loginValue,
          page,
        });
        if (result.errorType) {
          context.notifyProgress(result.errorType);
        } else {
          context.notifyProgress(LoginResults.Success);
        }
        return result;
      } catch (error) {
        return {
          success: false,
          errorMessage: error.message,
          errorType: LOGIN_RESULT.UNKNOWN_ERROR,
        };
      }
    },
  };
}
