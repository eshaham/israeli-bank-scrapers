import { Page } from 'puppeteer';
import { ScaperScrapingResult, ScraperErrorTypes } from '../scrapers/base-scraper';
import { SCRAPERS } from '../definitions';

enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR'
}

const {
  Timeout, Generic, General, ...rest
} = ScraperErrorTypes;
export const LoginResults = {
  ...rest,
  ...LoginBaseResults,
};

export type LoginResults = Exclude<ScraperErrorTypes,
ScraperErrorTypes.Timeout
| ScraperErrorTypes.Generic
| ScraperErrorTypes.General> | LoginBaseResults;


export function isValidCredentials(scraperId: string, credentials: Record<string, string>) {
  if (!scraperId || typeof credentials !== 'object') {
    return false;
  }

  const scraperDefinitions = SCRAPERS[scraperId];

  if (!scraperDefinitions || !scraperDefinitions.loginFields) {
    return false;
  }

  const hasMissingField = scraperDefinitions.loginFields.some((field) => typeof credentials[field] === 'undefined');

  return !hasMissingField;
}

export type PossibleLoginResults = {
  [key in LoginResults]?: (string | RegExp | ((options?: { page?: Page}) => Promise<boolean>))[]
};

async function getLoginResult(possibleLoginResults: PossibleLoginResults, value: string, page: Page): Promise<LoginResults> {
  const keys = Object.keys(possibleLoginResults);
  for (const key of keys) {
    // @ts-ignore
    const conditions = possibleLoginResults[key];

    for (const condition of conditions) {
      let result = false;

      if (condition instanceof RegExp) {
        result = condition.test(value);
      } else if (typeof condition === 'function') {
        result = await condition({ page, value });
      } else {
        result = value.toLowerCase() === condition.toLowerCase();
      }

      if (result) {
        // @ts-ignore
        return Promise.resolve(key);
      }
    }
  }

  return Promise.resolve(LoginResults.UnknownError);
}

export async function parseLoginResult(options: {
  possibleLoginResults: PossibleLoginResults;
  loginValue: string;
  page: Page;
}): Promise<{ success: boolean, errorType?: ScraperErrorTypes, errorMessage?: string}> {
  const loginResult: LoginResults = await getLoginResult(options.possibleLoginResults,
    options.loginValue,
    options.page);
  switch (loginResult) {
    case LoginResults.Success:
      return { success: true };
    case LoginResults.InvalidPassword:
    case LoginResults.UnknownError:
      return {
        success: false,
        errorType: loginResult === LoginResults.InvalidPassword ? ScraperErrorTypes.InvalidPassword :
          ScraperErrorTypes.General,
        errorMessage: `Login failed with ${loginResult} error`,
      };
    case LoginResults.ChangePassword:
      return {
        success: false,
        errorType: ScraperErrorTypes.ChangePassword,
      };
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }
}

export function createGeneralError(): ScaperScrapingResult {
  return {
    success: false,
    errorType: ScraperErrorTypes.General,
  };
}
