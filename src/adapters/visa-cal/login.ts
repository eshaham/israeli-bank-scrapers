import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '@core/constants';
import { isValidCredentials, parseLoginResult } from '@core/helpers/login';
import { fetchPost } from '@core/helpers/fetch';
import { HEADER_SITE } from './definitions';
import {RunnerAdapter} from "@core/runner";

const SCRAPER_ID = 'visaCal';

export const PASSWORD_EXPIRED_MSG = 'תוקף הסיסמא פג';
export const INVALID_CREDENTIALS = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const AUTH_URL = 'https://connect.cal-online.co.il/api/authentication/login';

export interface LoginAdapterOptions {
    credentials: Record<string, string>
}

export function loginAdapter(options: LoginAdapterOptions) : RunnerAdapter {
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
                    return parseLoginResult(LOGIN_RESULT.CHANGE_PASSWORD, context.notifyProgress);
                }

                if (authResponse === INVALID_CREDENTIALS) {
                    return parseLoginResult(LOGIN_RESULT.INVALID_PASSWORD, context.notifyProgress);
                }

                if (!authResponse || !authResponse.token) {
                    const result = parseLoginResult(LOGIN_RESULT.UNKNOWN_ERROR, context.notifyProgress);
                    return {
                        ...result,
                        errorMessage: JSON.stringify(authResponse) || 'No token found in authResponse',
                    };
                }

                const authHeader = `CALAuthScheme ${authResponse.token}`;
                context.setSessionData('visaCal.authHeader', authHeader);

                return parseLoginResult(LOGIN_RESULT.SUCCESS, context.notifyProgress);
            } catch (error) {
                return {
                    success: false,
                    errorType: LOGIN_RESULT.UNKNOWN_ERROR,
                };
            }
        },
    };
}
