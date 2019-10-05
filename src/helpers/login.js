import { SCRAPERS } from '../definitions';
import { LOGIN_RESULT, SCRAPE_PROGRESS_TYPES } from '../constants';

function isValidCredentials(scraperId, credentials) {
  if (!scraperId || typeof credentials !== 'object') {
    return false;
  }

  const scraperDefinitions = SCRAPERS[scraperId];

  if (!scraperDefinitions || !scraperDefinitions.loginFields) {
    return false;
  }

  const hasMissingField = scraperDefinitions.loginFields.some(field => typeof credentials[field] === 'undefined');

  return !hasMissingField;
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

export { handleLoginResult, isValidCredentials };
