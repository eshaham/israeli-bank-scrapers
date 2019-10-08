import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '../../constants';
import { isValidCredentials, handleLoginResult } from '../../helpers/login';
import { fetchPost } from '../../helpers/fetch';
import { HEADER_SITE } from './definitions';

const SCRAPER_ID = 'visaCal';

export const PASSWORD_EXPIRED_MSG = 'תוקף הסיסמא פג';
export const INVALID_CREDENTIALS = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const AUTH_URL = 'https://connect.cal-online.co.il/api/authentication/login';


function loginAdapter(options) {
  return {
    name: `login(${SCRAPER_ID})`,
    validate: () => {
      const result = [];

      if (!isValidCredentials(SCRAPER_ID, options.credentials)) {
        result.push('expected credentials object with userCode and password');
      }

      return result;
    },
    action: async (context) => {
      try {
        const { credentials } = options;

        const authRequest = {
          username: credentials.username,
          password: credentials.password,
          rememberMe: null,
        };

        context.notifyProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);

        const authResponse = await fetchPost(AUTH_URL, authRequest, HEADER_SITE);
        if (authResponse === PASSWORD_EXPIRED_MSG) {
          return handleLoginResult(LOGIN_RESULT.CHANGE_PASSWORD, context.notifyProgress);
        }

        if (authResponse === INVALID_CREDENTIALS) {
          return handleLoginResult(LOGIN_RESULT.INVALID_PASSWORD, context.notifyProgress);
        }

        if (!authResponse || !authResponse.token) {
          const result = handleLoginResult(LOGIN_RESULT.UNKNOWN_ERROR, context.notifyProgress);
          return {
            ...result,
            errorMessage: JSON.stringify(authResponse) || 'No token found in authResponse',
          };
        }

        const authHeader = `CALAuthScheme ${authResponse.token}`;
        context.setSessionData('visaCal.authHeader', authHeader);

        return handleLoginResult(LOGIN_RESULT.SUCCESS, context.notifyProgress);
      } catch (error) {
        return {
          success: false,
          errorType: LOGIN_RESULT.UNKNOWN_ERROR,
        };
      }
    },
  };
}
export default loginAdapter;
