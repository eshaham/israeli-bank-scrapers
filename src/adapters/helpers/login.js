import { LOGIN_RESULT, SCRAPE_PROGRESS_TYPES } from '../../constants';

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

export default handleLoginResult;
